package invoices

import (
	"encoding/json"
	"net/http"
	"testing"
)

// The RON rate is kept on the draft, frozen on issue, and the buyer snapshot carries the client's county.
func TestRONRateAndBuyerCounty(t *testing.T) {
	e := newEnv(t)
	b, _ := e.ready()
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": "CH93 0076 2011 6238 5295 7"}, http.StatusOK, nil) // EUR needs a normal IBAN
	clientID := e.client(b, map[string]any{"name": "Client SRL", "street": "Strada Memorandumului", "street_number": "28",
		"zip": "400114", "city": "Cluj-Napoca", "country": "RO", "region": "RO-CJ", "vat_number": "RO14399840"})
	draft := e.draft(b, clientID, map[string]any{"currency": "EUR"})

	for _, bad := range []any{"0", "0.000000", "-4.97", "4.1234567", "abc", 4.97} {
		e.fails(b, "PATCH", "/api/v1/invoices/"+draft.ID, map[string]any{"tax_currency_rate": bad},
			http.StatusUnprocessableEntity, "validation_failed", "tax_currency_rate")
	}
	e.do(b, "PATCH", "/api/v1/invoices/"+draft.ID, map[string]any{"tax_currency_rate": "4.977100"}, http.StatusOK, nil)
	issued := e.invoice(b, "POST", "/api/v1/invoices/"+draft.ID+"/issue", nil, http.StatusOK)

	var raw struct {
		Data struct {
			Rate  *string `json:"tax_currency_rate"`
			Buyer struct {
				Region *string `json:"region"`
			} `json:"buyer"`
		} `json:"data"`
	}
	_, body := e.send(b, "GET", "/api/v1/invoices/"+issued.ID, nil)
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatal(err)
	}
	if raw.Data.Rate == nil || *raw.Data.Rate != "4.9771" || raw.Data.Buyer.Region == nil || *raw.Data.Buyer.Region != "RO-CJ" {
		t.Fatalf("issued: rate %v, buyer region %v; want 4.9771 and RO-CJ", raw.Data.Rate, raw.Data.Buyer.Region)
	}
	e.fails(b, "PATCH", "/api/v1/invoices/"+issued.ID, map[string]any{"tax_currency_rate": "5"},
		http.StatusConflict, "invoice_locked")
}
