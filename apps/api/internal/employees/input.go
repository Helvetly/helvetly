package employees

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/employment"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
		map[string]any{"fields": fields})
}

func badRequest(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

func conflict(code, msg string) error { return auth.Error(http.StatusConflict, code, msg, nil) }

// fields collects one message per invalid field, the first one wins.
type fields map[string]string

func (f fields) fail(k, msg string) {
	if f[k] == "" {
		f[k] = msg
	}
}

// known refuses keys outside allowed, so a typo is an error instead of a silently ignored field.
func known(body map[string]json.RawMessage, allowed []string) error {
	for _, k := range slices.Sorted(maps.Keys(body)) {
		if !slices.Contains(allowed, k) {
			return badRequest(fmt.Sprintf("Unknown field %q.", k))
		}
	}
	return nil
}

// text: trimmed, blank meaning nil, at most max characters, then checked (when check is set).
func (f fields) text(key string, raw json.RawMessage, max int, check func(string) (string, string)) *string {
	if string(raw) == "null" {
		return nil
	}
	var v string
	if json.Unmarshal(raw, &v) != nil {
		f.fail(key, "Enter text.")
		return nil
	}
	if v = strings.TrimSpace(strings.ReplaceAll(v, "\r\n", "\n")); v == "" {
		return nil
	}
	if utf8.RuneCountInString(v) > max {
		f.fail(key, fmt.Sprintf("Use at most %d characters.", max))
		return nil
	}
	if check != nil {
		var msg string
		if v, msg = check(v); msg != "" {
			f.fail(key, msg)
			return nil
		}
	}
	return &v
}

// required is text that must be present.
func (f fields) required(key string, raw json.RawMessage, max int, msg string) string {
	v := f.text(key, raw, max, nil)
	if v == nil {
		f.fail(key, msg)
		return ""
	}
	return *v
}

func (f fields) flag(key string, raw json.RawMessage) bool {
	var v bool
	if json.Unmarshal(raw, &v) != nil {
		f.fail(key, "Choose yes or no.")
	}
	return v
}

func oneOf(values ...string) func(string) (string, string) {
	return func(v string) (string, string) {
		if !slices.Contains(values, v) {
			return "", "Choose one of " + strings.Join(values, ", ") + "."
		}
		return v, ""
	}
}

var countryCode = regexp.MustCompile(`^[A-Z]{2}$`)

func country(v string) (string, string) {
	v = strings.ToUpper(v)
	if !countryCode.MatchString(v) {
		return "", "Choose a country (two-letter ISO code)."
	}
	return v, ""
}

// date: a calendar date YYYY-MM-DD (no time, no zone) between 1900 and 2200.
func date(v string) (string, string) {
	t, err := time.Parse(time.DateOnly, v)
	if err != nil || t.Year() < 1900 || t.Year() > 2200 {
		return "", "Enter a date as YYYY-MM-DD."
	}
	return v, ""
}

func email(v string) (string, string) {
	v = strings.ToLower(v)
	at := strings.LastIndexByte(v, '@')
	if at < 1 || at == len(v)-1 || strings.ContainsAny(v, " ,;<>") {
		return "", "Enter an email address."
	}
	return v, ""
}

// otherMinorUnits are ISO 4217 currencies without two minor units: none (JPY, ISK, KRW…) or three (KWD, BHD…).
var otherMinorUnits = strings.Fields("BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF BHD IQD JOD KWD LYD OMR TND")

// currency: an ISO 4217 code with two minor units, as amounts are kept in hundredths (invoicecalc.Money); one with
// another number of minor units is refused by name, as it would need its own scale.
func currency(v string) (string, string) {
	if c := strings.ToUpper(strings.TrimSpace(v)); slices.Contains(otherMinorUnits, c) {
		return "", c + " has no cents, or three decimals: amounts are kept with two decimals, so record pay in a currency such as CHF, EUR or USD."
	}
	c, msg := clients.NormaliseCurrency(v)
	if msg == "" && !store.TwoDecimalCurrency(c) {
		msg = "Choose a currency with two decimals, such as CHF, EUR or USD."
	}
	return c, msg
}

// literal: a decimal as given, from a JSON string ("12.50") or number (12.5, never read as a float).
func literal(raw json.RawMessage) string {
	s := string(raw)
	if u, err := strconv.Unquote(s); err == nil {
		return u
	}
	return s
}

const maxAmount = 10_000_000_000 // 100'000'000.00, as on invoice lines

// money: an amount in hundredths from 0 to maxAmount; nil for null or an empty string, which stays missing (never 0).
func (f fields) money(key string, raw json.RawMessage) *invoicecalc.Money {
	if string(raw) == "null" || string(raw) == `""` {
		return nil
	}
	m, ok := invoicecalc.ParseMoney(strings.TrimSpace(literal(raw)))
	if !ok || m < 0 || m > maxAmount {
		f.fail(key, "Enter an amount from 0 to 100'000'000.00 with at most two decimals.")
		return nil
	}
	return &m
}

// hours: weekly working hours, above 0 and up to 168, with at most three decimals.
func (f fields) hours(key string, raw json.RawMessage) *invoicecalc.Quantity {
	if string(raw) == "null" || string(raw) == `""` {
		return nil
	}
	h, ok := invoicecalc.ParseQuantity(strings.TrimSpace(literal(raw)))
	if !ok || h <= 0 || h > 168_000 {
		f.fail(key, "Enter the weekly hours, above 0 and up to 168.")
		return nil
	}
	return &h
}

// canton: a Swiss canton's two-letter code.
func canton(v string) (string, string) {
	v = strings.ToUpper(v)
	if c, ok := employment.CountryOf("CH"); !ok {
		return "", "Choose a canton."
	} else if _, ok := c.RegionOf(v); !ok {
		return "", "Choose a canton."
	}
	return v, ""
}

// percent: 0.01 to 100 with at most two decimals.
func (f fields) percent(key string, raw json.RawMessage) *invoicecalc.Percent {
	if string(raw) == "null" {
		return nil
	}
	p, ok := invoicecalc.ParsePercent(literal(raw))
	if !ok || p <= 0 || p > invoicecalc.Hundred {
		f.fail(key, "Enter a percentage above 0 and up to 100.")
		return nil
	}
	return &p
}
