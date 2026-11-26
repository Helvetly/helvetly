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

func TestPartialPaymentReplayAfterBulkSettlement(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": "CH93 0076 2011 6238 5295 7"}, 200, nil)
	inv := e.issued(b, c, map[string]any{"currency": "EUR", "vat_mode": "inclusive", "lines": []any{line("1", "17.43")}})
	route := path(inv.ID, "payments")
	request := map[string]any{"request_id": "partial", "amount": "5.10", "method": "cash"}
	partial := e.invoice(b, "POST", route, request, 201)
	if partial.AmountDue != "12.33" || len(partial.Payments) != 1 {
		t.Fatalf("partial payment: %+v", partial)
	}
	batch := map[string]any{"action": "mark_paid", "ids": []string{inv.ID, inv.ID}}
	var out struct{ Data []bulkResult }
	e.do(b, "POST", "/api/v1/invoices/bulk", batch, 200, &out)
	if len(out.Data) != 1 || !out.Data[0].OK || out.Data[0].ID != inv.ID {
		t.Fatalf("bulk settlement: %+v", out.Data)
	}
	after := e.invoice(b, "POST", route, request, 201)
	if after.Status != "paid" || after.Currency != "EUR" || after.AmountPaid != "17.43" || after.AmountDue != "0.00" || len(after.Payments) != 2 {
		t.Fatalf("partial payment replay: %+v", after)
	}
	for _, pay := range after.Payments {
		want := "12.33"
		if pay.ID == partial.Payments[0].ID {
			want = "5.10"
		}
		if pay.Amount != want {
			t.Fatalf("payment %s: got %s, want %s", pay.ID, pay.Amount, want)
		}
	}
	e.fails(b, "POST", path(inv.ID, "mark-paid"), map[string]any{}, 409, "invalid_state")
	request["amount"] = "12.33"
	e.fails(b, "POST", route, request, 409, "request_id_conflict")
	var events int
	if err := e.raw.QueryRow(context.Background(), "SELECT count(*) FROM financial_events WHERE subject_id=$1 AND kind='payment.added'", inv.ID).Scan(&events); err != nil || events != 2 {
		t.Fatalf("payment events %d, %v", events, err)
	}
}
