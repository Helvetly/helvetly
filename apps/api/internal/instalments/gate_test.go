package instalments

import (
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
)

// TestDueItemWaitsForAPlanWithInstalments: on Basic a due plan item is neither issued nor sent; after the upgrade to
// Pro the next tick issues and sends it.
func TestDueItemWaitsForAPlanWithInstalments(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	p := e.plan(b, e.client(b, "ap@kunde.ch"), nil) // item 1 due now
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Basic)

	e.tick(time.Now())
	if n := e.partials(b); n != 0 || len(e.mail.with("")) != 0 {
		t.Fatalf("Basic: %d partials, %d mails", n, len(e.mail.with("")))
	}
	if got := e.get(b, p.ID); got.Items[0].Status != "scheduled" {
		t.Fatalf("Basic: plan %+v", got)
	}

	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.tick(time.Now())
	if n := e.partials(b); n != 1 || len(e.mail.with("")) != 1 {
		t.Fatalf("Pro: %d partials, %d mails", n, len(e.mail.with("")))
	}
}

// TestInstalmentRemindersWaitForAPlanWithInstalments: an issued partial's due reminder is not sent or logged on
// Basic; on Pro the next tick sends it.
func TestInstalmentRemindersWaitForAPlanWithInstalments(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	p := e.plan(b, e.client(b, "ap@kunde.ch"), map[string]any{"first_due_date": days(20).In(zone).Format(time.DateOnly),
		"lead_days": 20, "auto_send": false})
	e.tick(time.Now())
	invoiceID := *e.get(b, p.ID).Items[0].InvoiceID
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Basic)
	logged := func() int { return e.count(`SELECT count(*) FROM reminder_log WHERE target_id = $1`, invoiceID) }

	e.tick(days(16))
	if n := len(e.mail.with("Zahlungserinnerung")); n != 0 || logged() != 0 {
		t.Fatalf("Basic: %d reminders, %d logged", n, logged())
	}
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.tick(days(16))
	if n := len(e.mail.with("Zahlungserinnerung")); n != 1 || logged() != 1 {
		t.Fatalf("Pro: %d reminders, %d logged", n, logged())
	}
}
