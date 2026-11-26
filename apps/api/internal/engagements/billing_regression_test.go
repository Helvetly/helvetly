package engagements

import (
	"context"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestIncrementalOverage(t *testing.T) {
	e := newEnv(t)
	realDrafts(e)
	b := e.workspace()
	eng := e.create(b, input(e.client(b), nil))
	root := "/api/v1/engagements/" + eng.ID
	emit := root + "/periods/" + eng.CurrentPeriod.ID + "/invoice"
	for _, v := range []struct{ q, d string }{{"20", "2026-11-02"}, {"15", "2026-11-05"}} {
		e.do(b, "POST", root+"/entries", map[string]any{"quantity": v.q, "date": v.d}, 201, nil)
	}
	var first invoiceOut
	e.do(b, "POST", emit, map[string]any{"kind": "usage"}, 201, &first)
	e.do(b, "POST", root+"/entries", map[string]any{"quantity": "4", "date": "2026-11-06"}, 201, nil)
	var second invoiceOut
	e.do(b, "POST", emit, map[string]any{"kind": "usage", "detail": "per_entry"}, 201, &second)
	if first.Data.Period.InvoicedQuantity != "5" || second.Data.Period.InvoicedQuantity != "9" || !strings.Contains(e.lines(second.Data.InvoiceID)[0], "|4000|") {
		t.Fatal(first.Data.Period, second.Data.Period)
	}
	e.fails(b, "POST", emit, map[string]any{"kind": "usage"}, 409, "nothing_to_invoice")
}
func TestEngagementCurrency(t *testing.T) {
	e := newEnv(t)
	realDrafts(e)
	b := e.workspace()
	client := e.client(b)
	if _, err := e.pool.Exec(context.Background(), "UPDATE clients SET currency='USD' WHERE id=$1", client); err != nil {
		t.Fatal(err)
	}
	if err := e.st.PutInvoiceSettings(context.Background(), b.workspace, map[string]any{"currency": "CHF", "iban": "CH9300762011623852957", "qr_bill_enabled": true}, fixedNow); err != nil {
		t.Fatal(err)
	}
	for _, currency := range []string{"EUR", "CHF", "USD"} {
		eng := e.create(b, input(client, map[string]any{"currency": currency}))
		var out invoiceOut
		e.do(b, "POST", "/api/v1/engagements/"+eng.ID+"/periods/"+eng.CurrentPeriod.ID+"/invoice", map[string]any{"kind": "advance"}, 201, &out)
		var a, bill string
		var qr bool
		if err := e.pool.QueryRow(context.Background(), "SELECT e.currency, i.currency, i.pay_qr_bill FROM engagements e, invoices i WHERE e.id=$1 AND i.id=$2", eng.ID, out.Data.InvoiceID).Scan(&a, &bill, &qr); err != nil {
			t.Fatal(err)
		}
		if a != currency || bill != a || qr != (currency != "USD") {
			t.Fatalf("%s %s", a, bill)
		}
	}
}

func TestDeletedProductAllowsExistingAgreementEdits(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	ctx := context.Background()
	p := store.Product{ID: "prd_audit", Type: "service", Name: "Service", PriceBasis: "net", UnitPrice: 10000, Currency: "CHF", VATCategory: "Z", CreatedAt: fixedNow}
	if err := e.st.CreateProduct(ctx, b.workspace, p); err != nil {
		t.Fatal(err)
	}
	eng := e.create(b, input(e.client(b), map[string]any{"product_id": p.ID}))
	if _, err := e.st.DeleteProducts(ctx, b.workspace, []string{p.ID}, fixedNow); err != nil {
		t.Fatal(err)
	}
	e.do(b, "PATCH", "/api/v1/engagements/"+eng.ID, map[string]any{"title": "New title"}, 200, nil)
}
