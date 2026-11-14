package products

import (
	"encoding/json"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestFormattedGTINIsValidatedAfterRemovingSeparators(t *testing.T) {
	defaults := store.WorkspaceDefaults{Currency: "CHF"}
	for _, tt := range []struct{ formatted, digits string }{{"400 6381 33393-1", "4006381333931"}, {"100 1234 56789-02", "10012345678902"}} {
		t.Run(tt.formatted, func(t *testing.T) {
			var body map[string]json.RawMessage
			if err := json.Unmarshal([]byte(`{"name":"Widget","unit_price":"10.00","type":"product","gtin":"`+tt.formatted+`"}`), &body); err != nil {
				t.Fatal(err)
			}
			p := newProduct(defaults)
			if err := apply(&p, body, defaults, true); err != nil {
				t.Fatalf("valid formatted GTIN rejected: %v", err)
			}
			if p.GTIN == nil || *p.GTIN != tt.digits {
				t.Fatalf("GTIN was not normalized: %v", p.GTIN)
			}
		})
	}
}

func TestCurrencyTwoDecimalsOnly(t *testing.T) {
	tests := []struct {
		in, want, msg string
	}{
		{"chf", "CHF", ""}, {"EUR", "EUR", ""}, {"JPY", "", "two decimals"}, {"BHD", "", "two decimals"}, {"XXX", "", "x"},
	}
	for _, tt := range tests {
		got, msg := twoDecimalCurrency(tt.in)
		if tt.msg == "" && (got != tt.want || msg != "") || tt.msg != "" && msg == "" {
			t.Errorf("%s: %q %q", tt.in, got, msg)
		}
	}
}

func TestProductRefusesThreeDecimalCurrency(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.fails(b, "POST", "/api/v1/products", map[string]any{"name": "A", "unit_price": "1", "currency": "KWD"}, 422,
		"validation_failed", "currency")
	e.create(b, map[string]any{"name": "B", "unit_price": "1", "currency": "usd"})
}
