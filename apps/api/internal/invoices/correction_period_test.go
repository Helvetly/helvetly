package invoices

import (
	"context"
	"net/http"
	"testing"
	"time"
)

// A correction takes over its original's payments. One dated in a closed month must stay where it is: moving it
// would change that month's figures (the VAT return on the received basis prices a payment by its invoice).
func TestCorrectionRefusedWhileOriginalHasClosedMonthPayment(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	ctx := context.Background()
	today, _ := time.Parse(time.DateOnly, e.today())
	lastMonth := time.Date(today.Year(), today.Month()-1, 1, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
	orig := e.issued(b, clientID, map[string]any{"issue_date": lastMonth, "due_date": e.today()})
	e.invoice(b, "POST", path(orig.ID, "payments"), map[string]any{"amount": "100.00", "paid_on": lastMonth, "method": "cash"},
		http.StatusCreated)
	if _, err := e.st.ClosePeriod(ctx, b.workspace, lastMonth[:7], nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	fix := e.derived(b, orig.ID, "corrected", nil)
	e.fails(b, "POST", path(fix, "issue"), nil, http.StatusConflict, "period_closed")
	if got := e.invoice(b, "GET", path(orig.ID), nil, http.StatusOK); got.Status != "open" || got.AmountPaid != "100.00" {
		t.Fatalf("original after the refused correction: status %s paid %s", got.Status, got.AmountPaid)
	}

	if _, err := e.st.ReopenPeriod(ctx, b.workspace, lastMonth[:7]); err != nil {
		t.Fatal(err)
	}
	if got := e.invoice(b, "POST", path(fix, "issue"), nil, http.StatusOK); got.AmountPaid != "100.00" {
		t.Fatalf("correction in an open period: paid %s", got.AmountPaid)
	}
}
