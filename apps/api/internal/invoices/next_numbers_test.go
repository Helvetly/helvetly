package invoices

import (
	"context"
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
	if got.Quote != 1 || got.Contract != 1 {
		t.Fatalf("quote and contract before any: %d, %d", got.Quote, got.Contract)
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

func TestContractNumber(t *testing.T) {
	e := newEnv(t)
	b, _ := e.ready()
	ctx := context.Background()
	for _, tc := range []struct{ format, want string }{
		{"{YYYY}-{NNN}", "C-2026-007"},        // no type printed: the default
		{"{TYPE}-{NNNN}", "C-2026-007"},       // no year: contracts count per year
		{"{YYYY}/{TYPE}/{NNN}", "2026/C/007"}, // the workspace's format, like quotes
		{"{TYPE}{YY}.{MM}.{NN}", "C26.03.07"},
	} {
		e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"number_format": tc.format}, http.StatusOK, nil)
		got, err := e.svc.ContractNumber(ctx, e.st.Q, b.workspace, "2026-03-01", 7)
		if err != nil || got != tc.want {
			t.Errorf("%s: %q, %v; want %q", tc.format, got, err, tc.want)
		}
	}
}
