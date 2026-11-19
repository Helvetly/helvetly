package engagements

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

var inputKeys = []string{"client_id", "title", "description", "product_id", "unit", "quantity", "billing", "price_basis",
	"unit_price", "overage_unit_price", "currency", "vat_category", "vat_rate", "start_date", "recurrence", "interval",
	"end_date", "reference", "document_id", "rollover", "auto_invoice", "invoice_detail"}

var units = []string{"hour", "day", "piece", "month", "km", "flat"}

const (
	maxPrice    = 10_000_000_000 // 100'000'000.00 in cents, as on invoice lines
	maxQuantity = 1_000_000_000  // 1'000'000 in thousandths
	minDate     = "2000-01-01"   // bounds the periods a weekly engagement can open at once
	maxDate     = "2100-12-31"
	// descriptionMax matches products' descriptions; older engagements may keep a longer one while it is unchanged.
	descriptionMax = 1000
)

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
		map[string]any{"fields": fields})
}

func badRequest(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

// newEngagement: an engagement with the defaults, before its input is applied.
func newEngagement(d store.WorkspaceDefaults, c store.Client, today string) store.Engagement {
	e := store.Engagement{Billing: "advance", PriceBasis: "net", Currency: d.Currency, VATCategory: "O", StartDate: today,
		Recurrence: "none", Interval: 1, InvoiceDetail: "summary"}
	if c.Currency != nil {
		e.Currency = *c.Currency
	}
	if d.VATRegistered {
		e.VATCategory, e.VATRate = "S", d.DefaultVATRate
	}
	return e
}

// apply sets the EngagementInput fields in body on e and validates the result. client_id is only read (into e.ClientID);
// whether the client, product and document exist is the handler's check.
func apply(e *store.Engagement, body map[string]json.RawMessage, d store.WorkspaceDefaults, create bool) error {
	if err := knownKeys(body); err != nil {
		return err
	}
	if invalid := applyFields(e, body, d, create); len(invalid) > 0 {
		return validationFailed(invalid)
	}
	return nil
}

func knownKeys(body map[string]json.RawMessage) error {
	for _, k := range slices.Sorted(maps.Keys(body)) {
		if !slices.Contains(inputKeys, k) {
			return badRequest(fmt.Sprintf("Unknown field %q.", k))
		}
	}
	return nil
}

// applyFields is apply on a body of known fields: a message per invalid field.
func applyFields(e *store.Engagement, body map[string]json.RawMessage, d store.WorkspaceDefaults, create bool) map[string]string {
	invalid := map[string]string{}
	fail := func(k, msg string) {
		if invalid[k] == "" {
			invalid[k] = msg
		}
	}
	for _, k := range inputKeys {
		raw, ok := body[k]
		if !ok {
			continue
		}
		switch k {
		case "client_id":
			if v := text(k, raw, 100, nil, fail); v != nil {
				e.ClientID = *v
			} else {
				fail(k, "Choose a client.")
			}
		case "title":
			if v := text(k, raw, 200, nil, fail); v != nil {
				e.Title = *v
			} else {
				fail(k, "Enter a title.")
			}
		case "description":
			limit := descriptionMax
			if e.Description != nil && sameText(raw, *e.Description) { // a longer one from before the limit, unchanged
				limit = utf8.RuneCountInString(*e.Description)
			}
			e.Description = text(k, raw, limit, nil, fail)
		case "product_id":
			e.ProductID = text(k, raw, 100, nil, fail)
		case "unit":
			e.Unit = text(k, raw, 10, oneOf(units...), fail)
		case "quantity":
			n, ok := invoicecalc.ParseQuantity(literal(raw))
			if !ok || n <= 0 || n > maxQuantity {
				fail(k, "Enter a quantity above 0 and up to 1'000'000 with at most three decimals.")
			}
			e.Quantity = n
		case "billing":
			if v := text(k, raw, 10, oneOf("advance", "arrears"), fail); v != nil {
				e.Billing = *v
			} else {
				fail(k, "Choose advance or arrears.")
			}
		case "price_basis":
			if v := text(k, raw, 10, oneOf("net", "gross"), fail); v != nil {
				e.PriceBasis = *v
			} else {
				fail(k, "Choose net or gross.")
			}
		case "unit_price":
			n, ok := invoicecalc.ParseMoney(literal(raw))
			if !ok || n > maxPrice {
				fail(k, "Enter a price from 0 to 100'000'000.00 with at most two decimals.")
			}
			e.UnitPrice = n
		case "overage_unit_price":
			e.OverageUnitPrice = nil
			if string(raw) != "null" {
				n, ok := invoicecalc.ParseMoney(literal(raw))
				if !ok || n > maxPrice {
					fail(k, "Enter a price from 0 to 100'000'000.00 with at most two decimals.")
				}
				e.OverageUnitPrice = &n
			}
		case "currency":
			if v := text(k, raw, 3, clients.NormaliseCurrency, fail); v != nil {
				e.Currency = *v
			} else {
				fail(k, "Choose a currency.")
			}
		case "vat_category":
			v := text(k, raw, 2, oneOf(invoicecalc.Categories...), fail)
			switch {
			case v == nil:
				fail(k, "Choose a VAT category.")
			case *v != "S":
				e.VATCategory, e.VATRate = *v, 0
			case e.VATCategory != "S":
				e.VATCategory, e.VATRate = "S", d.DefaultVATRate
			}
		case "start_date":
			if v := date(k, raw, fail); v != nil {
				e.StartDate = *v
			} else {
				fail(k, "Enter a start date.")
			}
		case "recurrence":
			if v := text(k, raw, 10, oneOf("none", "weekly", "monthly", "quarterly", "yearly"), fail); v != nil {
				e.Recurrence = *v
			} else {
				fail(k, "Choose how it repeats.")
			}
		case "interval":
			var n int
			if json.Unmarshal(raw, &n) != nil || n < 1 || n > 12 {
				fail(k, "Enter a whole number from 1 to 12.")
			}
			e.Interval = n
		case "end_date":
			e.EndDate = date(k, raw, fail)
		case "reference":
			e.Reference = text(k, raw, 100, nil, fail)
		case "document_id":
			e.DocumentID = text(k, raw, 100, nil, fail)
		case "rollover", "auto_invoice":
			var b bool
			if json.Unmarshal(raw, &b) != nil {
				fail(k, "Enter true or false.")
			}
			if k == "rollover" {
				e.Rollover = b
			} else {
				e.AutoInvoice = b
			}
		case "invoice_detail":
			if v := text(k, raw, 10, oneOf("summary", "per_entry"), fail); v != nil {
				e.InvoiceDetail = *v
			} else {
				fail(k, "Choose summary or per_entry.")
			}
		}
	}
	if raw, ok := body["vat_rate"]; ok { // after the category, which may reset it
		r, ok := invoicecalc.ParsePercent(literal(raw))
		if !ok {
			fail("vat_rate", "Enter a VAT rate from 0 to 100 with at most two decimals.")
		}
		e.VATRate = r
	}
	if create {
		for k, msg := range map[string]string{"client_id": "Choose a client.", "title": "Enter a title.",
			"quantity": "Enter a quantity.", "unit_price": "Enter a price."} {
			if body[k] == nil {
				fail(k, msg)
			}
		}
	}
	switch {
	case e.VATCategory == "S" && e.VATRate == 0:
		fail("vat_rate", "A standard-rated item needs a rate above 0 (or choose zero-rated, Z).")
	case e.VATCategory != "S" && e.VATRate != 0:
		fail("vat_rate", "Only standard-rated (S) items have a VAT rate.")
	}
	switch {
	case e.Recurrence == "none" && e.EndDate == nil:
		fail("end_date", "Enter the last day.")
	case e.EndDate != nil && *e.EndDate < e.StartDate:
		fail("end_date", "The end cannot be before the start.")
	}
	if e.Rollover && (e.Billing != "advance" || e.Recurrence == "none") {
		fail("rollover", "Rollover needs advance billing and a recurring schedule.")
	}
	if e.AutoInvoice && e.UnitPrice == 0 {
		fail("auto_invoice", "Set a price to create invoice drafts automatically.")
	}
	return invalid
}

// sameText: raw is the JSON string s, as text stores it (trimmed, \r\n as \n).
func sameText(raw json.RawMessage, s string) bool {
	var v string
	return json.Unmarshal(raw, &v) == nil && strings.TrimSpace(strings.ReplaceAll(v, "\r\n", "\n")) == s
}

// literal: a decimal as given, from a JSON string ("12.50") or number (12.5, never read as a float).
func literal(raw json.RawMessage) string {
	s := string(raw)
	if u, err := strconv.Unquote(s); err == nil {
		return u
	}
	return s
}

// date: a civil YYYY-MM-DD within 2000..2100, null meaning nil.
func date(key string, raw json.RawMessage, fail func(k, msg string)) *string {
	if string(raw) == "null" {
		return nil
	}
	var v string
	if json.Unmarshal(raw, &v) != nil {
		fail(key, "Enter a date as YYYY-MM-DD.")
		return nil
	}
	if _, ok := parseDate(v); !ok || v < minDate || v > maxDate {
		fail(key, "Enter a date as YYYY-MM-DD between 2000 and 2100.")
		return nil
	}
	return &v
}

// text: trimmed, blank meaning nil, at most max characters, then normalised (when normalise is set).
func text(key string, raw json.RawMessage, max int, normalise func(string) (string, string), fail func(k, msg string)) *string {
	if string(raw) == "null" {
		return nil
	}
	var v string
	if json.Unmarshal(raw, &v) != nil {
		fail(key, "Enter text.")
		return nil
	}
	if v = strings.TrimSpace(strings.ReplaceAll(v, "\r\n", "\n")); v == "" {
		return nil
	}
	if utf8.RuneCountInString(v) > max {
		fail(key, fmt.Sprintf("Use at most %d characters.", max))
		return nil
	}
	if normalise != nil {
		var msg string
		if v, msg = normalise(v); msg != "" {
			fail(key, msg)
			return nil
		}
	}
	return &v
}

func oneOf(values ...string) func(string) (string, string) {
	return func(v string) (string, string) {
		if !slices.Contains(values, v) {
			return "", "Choose one of " + strings.Join(values, ", ") + "."
		}
		return v, ""
	}
}
