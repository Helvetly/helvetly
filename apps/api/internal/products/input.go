package products

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

var inputKeys = []string{"type", "name", "description", "sku", "gtin", "unit", "price_basis", "unit_price", "currency",
	"vat_category", "vat_rate"}

var units = []string{"hour", "day", "piece", "month", "km", "flat"}

const maxPrice = 10_000_000_000 // 100'000'000.00 in cents, as on invoice lines

var skuPattern = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
		map[string]any{"fields": fields})
}

func badRequest(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

// newProduct: an item with the workspace defaults, before its input is applied.
func newProduct(d store.WorkspaceDefaults) store.Product {
	p := store.Product{Type: "service", PriceBasis: "net", Currency: d.Currency, VATCategory: "O"}
	if d.VATRegistered {
		p.VATCategory, p.VATRate = "S", d.DefaultVATRate
	}
	return p
}

// apply sets the ProductInput fields in body on p and validates the result. create requires name and unit_price.
func apply(p *store.Product, body map[string]json.RawMessage, d store.WorkspaceDefaults, create bool) error {
	for _, k := range slices.Sorted(maps.Keys(body)) {
		if !slices.Contains(inputKeys, k) {
			return badRequest(fmt.Sprintf("Unknown field %q.", k))
		}
	}
	if invalid := check(p, body, d, create); len(invalid) > 0 {
		return validationFailed(invalid)
	}
	p.Derive()
	return nil
}

// CheckCreate applies the create rules to an item input of known fields, on a new item with the workspace defaults:
// the item (prices derived when valid) and a message per invalid field. AI import uses it before creating an item.
func CheckCreate(body map[string]json.RawMessage, d store.WorkspaceDefaults) (store.Product, map[string]string) {
	p := newProduct(d)
	invalid := check(&p, body, d, true)
	if len(invalid) == 0 {
		p.Derive()
	}
	return p, invalid
}

func check(p *store.Product, body map[string]json.RawMessage, d store.WorkspaceDefaults, create bool) map[string]string {
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
		case "type":
			if v := text(k, raw, 10, oneOf("product", "service"), fail); v != nil {
				p.Type = *v
			} else {
				fail(k, "Choose product or service.")
			}
		case "name":
			if v := text(k, raw, 200, nil, fail); v != nil {
				p.Name = *v
			} else {
				fail(k, "Enter a name.")
			}
		case "description":
			p.Description = text(k, raw, 1000, nil, fail)
		case "sku":
			p.SKU = text(k, raw, 64, sku, fail)
		case "gtin":
			p.GTIN = text(k, raw, 14, gtin, fail)
		case "unit":
			p.Unit = text(k, raw, 10, oneOf(units...), fail)
		case "price_basis":
			if v := text(k, raw, 10, oneOf("net", "gross"), fail); v != nil {
				p.PriceBasis = *v
			} else {
				fail(k, "Choose net or gross.")
			}
		case "unit_price":
			n, ok := invoicecalc.ParseMoney(literal(raw))
			if !ok || n > maxPrice {
				fail(k, "Enter a price from 0 to 100'000'000.00 with at most two decimals.")
			}
			p.UnitPrice = n
		case "currency":
			if v := text(k, raw, 3, twoDecimalCurrency, fail); v != nil {
				p.Currency = *v
			} else {
				fail(k, "Choose a currency.")
			}
		case "vat_category":
			v := text(k, raw, 2, oneOf(invoicecalc.Categories...), fail)
			switch {
			case v == nil:
				fail(k, "Choose a VAT category.")
			case *v != "S":
				p.VATCategory, p.VATRate = *v, 0
			case p.VATCategory != "S":
				p.VATCategory, p.VATRate = "S", d.DefaultVATRate
			}
		}
	}
	if raw, ok := body["vat_rate"]; ok { // after the category, which may reset it
		r, ok := invoicecalc.ParsePercent(literal(raw))
		if !ok {
			fail("vat_rate", "Enter a VAT rate from 0 to 100 with at most two decimals.")
		}
		p.VATRate = r
	}
	if create && body["name"] == nil {
		fail("name", "Enter a name.")
	}
	if create && body["unit_price"] == nil {
		fail("unit_price", "Enter a price.")
	}
	switch {
	case p.VATCategory == "S" && p.VATRate == 0:
		fail("vat_rate", "A standard-rated item needs a rate above 0 (or choose zero-rated, Z).")
	case p.VATCategory != "S" && p.VATRate != 0:
		fail("vat_rate", "Only standard-rated (S) items have a VAT rate.")
	}
	if p.GTIN != nil && p.Type == "service" {
		fail("gtin", "Only products have a GTIN.")
	}
	return invalid
}

// literal: a decimal as given, from a JSON string ("12.50") or number (12.5, never read as a float).
func literal(raw json.RawMessage) string {
	s := string(raw)
	if u, err := strconv.Unquote(s); err == nil {
		return u
	}
	return s
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
	if normalise != nil {
		var msg string
		if v, msg = normalise(v); msg != "" {
			fail(key, msg)
			return nil
		}
	}
	if utf8.RuneCountInString(v) > max {
		fail(key, fmt.Sprintf("Use at most %d characters.", max))
		return nil
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

func sku(v string) (string, string) {
	if !skuPattern.MatchString(v) {
		return "", "Use letters, digits and . _ - / only, no spaces."
	}
	return v, ""
}

// gtin: GTIN-8, -12, -13 or -14 (spaces and dashes ignored) whose last digit is the GS1 mod-10 check digit.
func gtin(v string) (string, string) {
	v = strings.NewReplacer(" ", "", "-", "").Replace(v)
	if n := len(v); (n != 8 && n != 12 && n != 13 && n != 14) || strings.Trim(v, "0123456789") != "" {
		return "", "Enter a GTIN of 8, 12, 13 or 14 digits."
	}
	sum := 0
	for i := len(v) - 2; i >= 0; i-- { // weights 3, 1, 3, … from the right, check digit excluded
		d := int(v[i] - '0')
		if (len(v)-2-i)%2 == 0 {
			d *= 3
		}
		sum += d
	}
	if (10-sum%10)%10 != int(v[len(v)-1]-'0') {
		return "", "This GTIN's check digit is wrong: check its digits."
	}
	return v, ""
}

// twoDecimalCurrency: an ISO 4217 code with exactly two minor units (prices are kept in hundredths).
func twoDecimalCurrency(v string) (string, string) {
	c, msg := clients.NormaliseCurrency(v)
	if msg == "" && !store.TwoDecimalCurrency(c) {
		msg = "Choose a currency with two decimals, such as CHF or EUR."
	}
	return c, msg
}
