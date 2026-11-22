package invoices

import (
	"net/http"
	"testing"
)

func TestNextNumbers(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	read := func() nextNumbersJSON {
		var got struct{ Data nextNumbersJSON }
		e.do(b, "GET", "/api/v1/invoice-settings/next-numbers", nil, http.StatusOK, &got)
		return got.Data
	}
	got := read()
	for _, kind := range []string{"invoice", "credit_note", "proforma", "self_billed"} {
		if c := got.Series[kind]; c.Year != 1 || c.Ever != 1 {
			t.Fatalf("%s before any issue: %+v", kind, c)
		}
	}
	if got.Quote != 1 {
		t.Fatalf("quote before any: %d", got.Quote)
	}
	e.issued(b, clientID, nil)
	got = read()
	if c := got.Series["invoice"]; c.Year != 2 || c.Ever != 1 {
		t.Fatalf("invoice after one issue: %+v", c)
	}
	if c := got.Series["credit_note"]; c.Year != 1 {
		t.Fatalf("credit notes count apart: %+v", c)
	}
}
