package invoices

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// confirmations sends what is queued and answers the confirmations that went to the workspace's clients since the last
// call (the invoice's own emails left out).
func (e *env) confirmations(b *browser) []mail.Message {
	e.t.Helper()
	before := len(e.mail.sent)
	if err := e.svc.SendPaymentConfirmations(context.Background()); err != nil {
		e.t.Fatal(err)
	}
	var out []mail.Message
	for _, m := range e.mail.sent[before:] {
		if m.Workspace == b.workspace && m.Tone == mail.Positive {
			out = append(out, m)
		}
	}
	return out
}

func (e *env) deliveries(b *browser, id string) []store.Delivery {
	e.t.Helper()
	var out struct{ Data []store.Delivery }
	e.do(b, "GET", path(id, "deliveries"), nil, http.StatusOK, &out)
	return out.Data
}

func pay(amount string, extra ...any) map[string]any {
	body := map[string]any{"amount": amount, "method": "bank_transfer"}
	for i := 0; i+1 < len(extra); i += 2 {
		body[extra[i].(string)] = extra[i+1]
	}
	return body
}

func TestPaymentConfirmationPartialThenFull(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	inv := e.issued(b, c, nil) // CHF 216.20, in German
	e.invoice(b, "POST", path(inv.ID, "payments"), pay("50", "paid_on", "2026-01-15"), http.StatusCreated)
	got := e.confirmations(b)
	if len(got) != 1 || got[0].To[0] != "ap@kunde.ch" || got[0].Eyebrow != "Zahlung erhalten" || got[0].Subject != "Zahlung erhalten: Rechnung "+*inv.Number {
		t.Fatalf("partial: %+v", got)
	}
	for _, want := range []string{"CHF 50.00", "15.01.2026", "Offener Betrag: CHF 166.20", "billing@muster.ch"} {
		if !strings.Contains(got[0].Text+got[0].ReplyTo, want) {
			t.Errorf("partial: no %q in %s", want, got[0].Text)
		}
	}
	if strings.Contains(got[0].Text, "Vollständig bezahlt") || strings.Contains(got[0].Text, "Nächste Rate") {
		t.Errorf("partial: %s", got[0].Text)
	}
	e.invoice(b, "POST", path(inv.ID, "mark-paid"), map[string]any{}, http.StatusOK)
	got = e.confirmations(b)
	if len(got) != 1 || !strings.Contains(got[0].Text, "CHF 166.20") || !strings.Contains(got[0].Text, "Status: Vollständig bezahlt") ||
		strings.Contains(got[0].Text, "Offener Betrag") {
		t.Fatalf("full: %+v", got)
	}
	if again := e.confirmations(b); len(again) != 0 {
		t.Fatalf("sent twice: %d", len(again))
	}
	d := e.deliveries(b, inv.ID)
	if len(d) != 2 || d[0].Kind != "payment_confirmation" || d[1].Kind != "payment_confirmation" || d[0].To[0] != "ap@kunde.ch" || d[0].SentBy == nil {
		t.Fatalf("deliveries: %+v", d)
	}
	// A confirmation is not the invoice going out: a mark as sent can still be taken back.
	e.do(b, "POST", path(inv.ID, "send"), map[string]any{"email": false}, http.StatusOK, nil)
	e.do(b, "POST", path(inv.ID, "send"), map[string]any{"email": false, "sent": false}, http.StatusOK, nil)
	if e.sentAt(b, inv.ID) != nil {
		t.Fatal("still sent")
	}
}

func TestPaymentConfirmationNextInstalment(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	inv := e.issuedSchedule(b, c)
	first, second := inv.Instalments.Items[0], inv.Instalments.Items[1]
	e.invoice(b, "POST", path(inv.ID, "payments"), pay(first.Amount.String()), http.StatusCreated)
	got := e.confirmations(b)
	if len(got) != 1 {
		t.Fatalf("got %d", len(got))
	}
	for _, want := range []string{"Nächste Rate: CHF " + second.Amount.Swiss("'"), "Zahlbar bis: " + swissDate(second.DueDate)} {
		if !strings.Contains(got[0].Text, want) {
			t.Errorf("no %q in %s", want, got[0].Text)
		}
	}
}

func TestPaymentConfirmationControls(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	// asked not to
	inv := e.issued(b, c, nil)
	e.invoice(b, "POST", path(inv.ID, "payments"), pay("10", "notify_client", false), http.StatusCreated)
	e.invoice(b, "POST", path(inv.ID, "mark-paid"), map[string]any{"notify_client": false}, http.StatusOK)
	if got := e.confirmations(b); len(got) != 0 {
		t.Fatalf("notify_client false: %d sent", len(got))
	}
	// the setting off: nothing unless asked
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"payment_confirmation": false}, http.StatusOK, nil)
	if e.settings(b).PaymentConfirmation {
		t.Fatal("setting not saved")
	}
	inv = e.issued(b, c, nil)
	e.invoice(b, "POST", path(inv.ID, "payments"), pay("10"), http.StatusCreated)
	var out struct{ Data []bulkResult }
	e.do(b, "POST", "/api/v1/invoices/bulk", map[string]any{"action": "mark_paid", "ids": []string{inv.ID}}, http.StatusOK, &out)
	if got := e.confirmations(b); len(got) != 0 || !out.Data[0].OK {
		t.Fatalf("setting off: %d sent, %+v", len(got), out.Data)
	}
	inv = e.issued(b, c, nil)
	e.invoice(b, "POST", path(inv.ID, "payments"), pay("10", "notify_client", true), http.StatusCreated)
	if got := e.confirmations(b); len(got) != 1 {
		t.Fatalf("setting off, asked: %d sent", len(got))
	}
	// no address: nothing goes, nothing is recorded
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"payment_confirmation": true}, http.StatusOK, nil)
	inv = e.issued(b, e.client(b, map[string]any{"email": nil}), nil)
	e.invoice(b, "POST", path(inv.ID, "mark-paid"), map[string]any{}, http.StatusOK)
	if got := e.confirmations(b); len(got) != 0 || len(e.deliveries(b, inv.ID)) != 0 {
		t.Fatalf("no address: %d sent", len(got))
	}
	// a credit note takes no payment
	src := e.issued(b, c, nil)
	cn := e.invoice(b, "POST", path(src.ID, "credit-note"), map[string]any{}, http.StatusCreated)
	cn = e.invoice(b, "POST", path(cn.ID, "issue"), nil, http.StatusOK)
	e.fails(b, "POST", path(cn.ID, "payments"), pay("1"), http.StatusConflict, "invalid_state")
	// an invoice issued elsewhere is never emailed
	sess, docID := e.importSession(b)
	imported, err := importOnce(e, sess, c, importData(t, map[string]any{"number": "ALT-9"}), &docID)
	if err != nil {
		t.Fatal(err)
	}
	e.invoice(b, "POST", path(imported, "payments"), pay("100", "notify_client", true), http.StatusCreated)
	if got := e.confirmations(b); len(got) != 0 {
		t.Fatalf("credit note or imported: %d sent", len(got))
	}
}

func TestPaymentConfirmationOncePerPayment(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	inv := e.issued(b, c, nil)
	body := pay("20", "request_id", "retry-1")
	for range 3 {
		e.invoice(b, "POST", path(inv.ID, "payments"), body, http.StatusCreated)
	}
	if got := e.confirmations(b); len(got) != 1 {
		t.Fatalf("retried request: %d sent", len(got))
	}
	// a refused send is tried again, and goes once
	e.invoice(b, "POST", path(inv.ID, "payments"), pay("20"), http.StatusCreated)
	e.mail.fail = errors.New("421 try later")
	if got := e.confirmations(b); len(got) != 0 {
		t.Fatalf("refused: %d", len(got))
	}
	e.mail.fail = nil
	if got := e.confirmations(b); len(got) != 0 {
		t.Fatalf("retried at once: %d sent", len(got))
	}
	now := e.svc.now()
	e.svc.now = func() time.Time { return now.Add(2 * time.Minute) }
	if got := e.confirmations(b); len(got) != 1 {
		t.Fatalf("after a refusal: %d sent", len(got))
	}
	// a deleted payment is never confirmed
	after := e.invoice(b, "POST", path(inv.ID, "payments"), pay("20"), http.StatusCreated)
	e.do(b, "DELETE", path(inv.ID, "payments", after.Payments[len(after.Payments)-1].ID), nil, http.StatusNoContent, nil)
	if got := e.confirmations(b); len(got) != 0 {
		t.Fatalf("deleted payment: %d sent", len(got))
	}
	// several invoices at once: one each
	ids := []string{e.issued(b, c, nil).ID, e.issued(b, c, nil).ID, e.issued(b, c, nil).ID}
	e.do(b, "POST", "/api/v1/invoices/bulk", map[string]any{"action": "mark_paid", "ids": ids}, http.StatusOK, nil)
	if got := e.confirmations(b); len(got) != 3 {
		t.Fatalf("bulk: %d sent", len(got))
	}
	if d := e.deliveries(b, inv.ID); len(d) != 2 {
		t.Fatalf("deliveries: %d", len(d))
	}
}

func TestPaymentConfirmationWorkspaceIsolation(t *testing.T) {
	e := newEnv(t)
	a, ca := e.ready()
	b, cb := e.ready()
	e.client(b, map[string]any{"email": "other@kunde.ch"})
	invA, invB := e.issued(a, ca, nil), e.issued(b, cb, nil)
	e.invoice(a, "POST", path(invA.ID, "mark-paid"), map[string]any{}, http.StatusOK)
	e.fails(b, "POST", path(invA.ID, "payments"), pay("1"), http.StatusNotFound, "not_found")
	if got := e.confirmations(b); len(got) != 0 {
		t.Fatalf("other workspace: %d", len(got))
	}
	if len(e.deliveries(a, invA.ID)) != 1 || len(e.deliveries(b, invB.ID)) != 0 {
		t.Fatal("deliveries leaked")
	}
	e.fails(b, "GET", path(invA.ID, "deliveries"), nil, http.StatusNotFound, "not_found")
	for _, m := range e.mail.sent {
		if m.Workspace != a.workspace || m.Brand != nil {
			t.Fatalf("sent as %s: %+v", m.Workspace, m)
		}
	}
}
