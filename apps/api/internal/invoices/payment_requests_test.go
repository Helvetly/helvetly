package invoices

import (
	"context"
	"testing"
)

func TestPaymentRequestRetriesAndIndependentPayments(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	inv := e.issued(b, c, nil)
	route := path(inv.ID, "payments")
	body := map[string]any{"request_id": "payment-1", "amount": "50", "method": "cash"}
	if got := e.statuses(b, 6, "POST", route, func(int) any { return body }); got[201] != 6 {
		t.Fatal(got)
	}
	after := e.invoice(b, "POST", route, body, 201)
	if after.AmountDue != "166.20" || len(after.Payments) != 1 {
		t.Fatal(after)
	}
	firstID := after.Payments[0].ID
	body["amount"] = "51"
	e.fails(b, "POST", route, body, 409, "request_id_conflict")
	body["amount"] = "50.00"
	body["request_id"] = "payment-2"
	after = e.invoice(b, "POST", route, body, 201)
	if after.AmountDue != "116.20" || len(after.Payments) != 2 {
		t.Fatal(after)
	}
	body["amount"] = "116.20"
	body["request_id"] = "payment-3"
	e.invoice(b, "POST", route, body, 201)
	after = e.invoice(b, "POST", route, body, 201)
	if after.Status != "paid" || len(after.Payments) != 3 {
		t.Fatal(after)
	}
	var count int
	if err := e.raw.QueryRow(context.Background(), "SELECT count(*) FROM financial_events WHERE subject_id=$1 AND kind='payment.added'", inv.ID).Scan(&count); err != nil || count != 3 {
		t.Fatalf("events %d, %v", count, err)
	}
	e.do(b, "DELETE", route+"/"+firstID, nil, 204, nil)
	body["request_id"] = "payment-1"
	body["amount"] = "50"
	after = e.invoice(b, "POST", route, body, 201)
	if after.AmountDue != "50.00" || len(after.Payments) != 2 {
		t.Fatal(after)
	}
	if ok, broken, err := e.st.VerifyChain(context.Background(), b.workspace); err != nil || !ok {
		t.Fatalf("financial chain at %d: %v", broken, err)
	}

}
