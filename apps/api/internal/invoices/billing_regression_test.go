package invoices

import (
	"bytes"
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/store"
)

func TestMailAfterPaymentAndVoid(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	inv := e.issued(b, c, nil)
	original, err := e.st.Invoice(context.Background(), b.workspace, inv.ID, e.today(), false)
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := e.svc.files.Get(context.Background(), *original.PDFKey)
	if err != nil {
		t.Fatal(err)
	}
	e.do(b, "POST", path(inv.ID, "payments"), map[string]any{"amount": "16.20", "method": "card"}, 201, nil)
	e.do(b, "POST", path(inv.ID, "send"), map[string]any{"expected_amount_due": "216.20", "message": "stale amount"}, 409, nil)
	for _, status := range []string{"partly paid", "paid", "void"} {
		switch status {
		case "paid":
			e.do(b, "POST", path(inv.ID, "mark-paid"), map[string]any{}, 200, nil)
		case "void":
			inv = e.issued(b, c, nil)
			e.do(b, "POST", path(inv.ID, "void"), map[string]any{"reason": "Falscher Kunde"}, 200, nil)
			e.do(b, "POST", path(inv.ID, "send"), map[string]any{}, 409, nil)
			continue
		}
		e.do(b, "POST", path(inv.ID, "send"), map[string]any{}, 200, nil)
		m := e.mail.sent[len(e.mail.sent)-1]
		want := "200.00"
		if status == "paid" {
			want = "0.00"
		}
		if !strings.Contains(m.Text, "216.20") || !strings.Contains(m.Text, "Zu bezahlen: CHF "+want) || len(m.Attachments) != 1 || !bytes.Equal(m.Attachments[0].Data, pdf) || !strings.Contains(m.HTML, want) {
			t.Fatalf("%s %s", status, m.Text)
		}
	}
}

func TestHistoricalRefund(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	day := func(n int) string { return time.Now().In(zone).AddDate(0, 0, n).Format(time.DateOnly) }
	inv := e.issued(b, c, map[string]any{"issue_date": day(-10), "due_date": day(-4)})
	e.do(b, "POST", path(inv.ID, "mark-paid"), map[string]any{"paid_on": day(-10)}, 200, nil)
	for _, n := range []int{-8, -2} {
		cn := e.invoice(b, "POST", path(inv.ID, "credit-note"), map[string]any{"lines": []any{line("1", "50.00")}}, 201)
		e.do(b, "PATCH", path(cn.ID), map[string]any{"issue_date": day(n)}, 200, nil)
		e.do(b, "POST", path(cn.ID, "issue"), nil, 200, nil)
	}
	e.do(b, "POST", path(inv.ID, "refunds"), map[string]any{"amount": "10", "refunded_on": day(-6), "method": "bank_transfer"}, 201, nil)
	// The earlier day had 54.05, but the existing 10.00 refund must remain funded the next day.
	e.fails(b, "POST", path(inv.ID, "refunds"), map[string]any{"amount": "45", "refunded_on": day(-7), "method": "bank_transfer"}, 422, "validation_failed", "amount")
}

func TestClientSummaryForeignOnly(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": "CH93 0076 2011 6238 5295 7"}, 200, nil)
	e.issued(b, c, map[string]any{"currency": "EUR", "payment_methods": map[string]any{"qr_bill": false, "revolut": false}})
	var summary struct{ Data store.InvoiceSummary }
	e.do(b, "GET", "/api/v1/invoices/summary?client_id="+c, nil, 200, &summary)
	balances := summary.Data.OpenBalances
	if len(balances) != 1 || balances[0].Currency != "EUR" || balances[0].Outstanding.Amount != 21620 {
		t.Fatal(balances)
	}
}

func TestPartialEntryReleasedByDraftDeletionAndVoid(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	engagements.New(e.st, e.svc.auth, e.svc, e.svc.log).Register(e.srv.Config.Handler.(*http.ServeMux))
	day := func(offset int) string { return time.Now().In(zone).AddDate(0, 0, offset).Format(time.DateOnly) }
	var eng struct {
		Data struct {
			ID            string
			CurrentPeriod struct{ ID string } `json:"current_period"`
		}
	}
	e.do(b, "POST", "/api/v1/engagements", map[string]any{"client_id": c, "title": "Consulting", "quantity": "30", "unit_price": "100", "unit": "hour", "start_date": day(-10), "recurrence": "monthly", "vat_category": "S", "vat_rate": "8.1"}, 201, &eng)
	root := "/api/v1/engagements/" + eng.Data.ID
	emit := func(qty string) string {
		t.Helper()
		var result struct {
			Data struct {
				ID string `json:"invoice_id"`
			}
		}
		e.do(b, "POST", root+"/periods/"+eng.Data.CurrentPeriod.ID+"/invoice", map[string]any{"kind": "usage"}, 201, &result)
		var draft struct{ Data store.Invoice }
		e.do(b, "GET", path(result.Data.ID), nil, 200, &draft)
		if len(draft.Data.Lines) != 1 || draft.Data.Lines[0].Quantity.String() != qty {
			t.Fatal(draft.Data.Lines)
		}
		return result.Data.ID
	}
	e.do(b, "POST", root+"/entries", map[string]any{"date": day(-3), "quantity": "35"}, 201, nil)
	first := emit("5")
	e.do(b, "POST", path(first, "issue"), nil, 200, nil)
	// An older delivery increases the overage; the latest entry now has two live allocations.
	e.do(b, "POST", root+"/entries", map[string]any{"date": day(-5), "quantity": "4"}, 201, nil)
	second := emit("4")
	e.do(b, "DELETE", path(second), nil, 204, nil)
	emit("4")
	e.do(b, "POST", path(first, "void"), map[string]any{"reason": "Cancelled"}, 200, nil)
	emit("5")
}
