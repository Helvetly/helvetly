package instalments

import (
	"context"
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

// actions: the workspace's automatic actions in every month, used and still reserved.
func (e *env) actions(b *browser) store.PeriodUsage {
	e.t.Helper()
	u, err := e.st.UsageInPeriods(context.Background(), b.workspace, store.AutomationActions, "2000-01", "9999-12")
	if err != nil {
		e.t.Fatal(err)
	}
	return u
}

// leaveActions seeds the month of at with usage so that left actions remain of the workspace's allowance.
func (e *env) leaveActions(svc *billing.Service, b *browser, at time.Time, left int64) {
	e.t.Helper()
	r, err := svc.Entitlements(context.Background(), e.st.Q, b.workspace)
	if err != nil {
		e.t.Fatal(err)
	}
	limit, err := r.Cap(billing.AutomationActions)
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period,
			reserved, consumed, created_at, settled_at)
		SELECT $1, $2, 'seed:' || i, '', $3, 0, 1, now(), now() FROM generate_series(1, $4::int) AS i`,
		b.workspace, store.AutomationActions, store.UsagePeriod(at), limit-left); err != nil {
		e.t.Fatal(err)
	}
}

// remindedPlan: item 1 falls due in 20 days and is issued (and sent) today; reminders 5 days before and 3 after.
func (e *env) remindedPlan(b *browser, autoSend bool) viewedPlan {
	return e.plan(b, e.client(b, "ap@kunde.ch"), map[string]any{"first_due_date": days(20).In(zone).Format(time.DateOnly),
		"lead_days": 20, "auto_send": autoSend})
}

// TestAutomationIssueSendAndTwoRemindersAreFour: issuing, the automatic send and each reminder count once; repeated
// and empty ticks count nothing more.
func TestAutomationIssueSendAndTwoRemindersAreFour(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.remindedPlan(b, true)
	for _, step := range []struct{ at, want int }{{0, 2}, {0, 2}, {16, 3}, {16, 3}, {23, 4}, {24, 4}} {
		e.tick(days(step.at))
		if u := e.actions(b); u.Consumed != int64(step.want) || u.Reserved != 0 {
			t.Fatalf("day %d: %+v, want %d used", step.at, u, step.want)
		}
	}
	if n := len(e.mail.with("Zahlungserinnerung")); n != 2 || len(e.mail.with(""))-n != 1 {
		t.Fatalf("%d reminders of %d mails", n, len(e.mail.with("")))
	}
}

// TestAutomationFailedSendKeepsTheIssueAndItsReservation: the issue stays counted; the send's reservation is held
// (its outcome unknown) and the retry sends without issuing again or counting twice.
func TestAutomationFailedSendKeepsTheIssueAndItsReservation(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.plan(b, e.client(b, "ap@kunde.ch"), nil) // item 1 due now, auto_send
	e.mail.fail = true
	e.tick(time.Now())
	e.mail.fail = false
	if u := e.actions(b); u.Consumed != 1 || u.Reserved != 1 {
		t.Fatalf("after the failed send: %+v", u)
	}
	e.tick(time.Now())
	if u := e.actions(b); u.Consumed != 2 || u.Reserved != 0 || e.partials(b) != 1 || len(e.mail.with("")) != 1 {
		t.Fatalf("after the retry: %+v, %d partials, %d mails", u, e.partials(b), len(e.mail.with("")))
	}
}

// TestAutomationLastActionIssuesAndTheSendWaits: with one action left the item is issued and its send waits; after
// the upgrade the send goes and the item is not issued again.
func TestAutomationLastActionIssuesAndTheSendWaits(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	svc := billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	now := time.Now()
	e.leaveActions(svc, b, now, 1)
	p := e.plan(b, e.client(b, "ap@kunde.ch"), nil)
	e.tick(now)
	before := e.actions(b)
	if e.partials(b) != 1 || len(e.mail.with("")) != 0 || e.get(b, p.ID).Items[0].InvoiceID == nil {
		t.Fatalf("at the limit: %d partials, %d mails", e.partials(b), len(e.mail.with("")))
	}
	e.tick(now)
	if len(e.mail.with("")) != 0 || e.actions(b) != before {
		t.Fatalf("a second tick at the limit: %d mails, %+v", len(e.mail.with("")), e.actions(b))
	}
	billingtest.On(t, e.st, b.workspace, billing.Business)
	e.tick(now)
	if u := e.actions(b); e.partials(b) != 1 || len(e.mail.with("")) != 1 || u.Consumed != before.Consumed+1 || u.Reserved != 0 {
		t.Fatalf("after the upgrade: %d partials, %d mails, %+v", e.partials(b), len(e.mail.with("")), u)
	}
}

// TestAutomationPausedReminderOfAPaidInvoiceNeverGoes: a reminder that waited at the limit is not sent once the
// invoice is paid, even with room again, and counts nothing.
func TestAutomationPausedReminderOfAPaidInvoiceNeverGoes(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	svc := billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	p := e.remindedPlan(b, false)
	e.tick(time.Now())
	invoiceID := *e.get(b, p.ID).Items[0].InvoiceID
	e.leaveActions(svc, b, days(16), 0)
	before := e.actions(b)
	e.tick(days(16))
	if n := len(e.mail.with("Zahlungserinnerung")); n != 0 || e.actions(b) != before {
		t.Fatalf("at the limit: %d reminders, %+v", n, e.actions(b))
	}
	e.do(b, "POST", "/api/v1/invoices/"+invoiceID+"/mark-paid", map[string]any{}, http.StatusOK, nil)
	billingtest.On(t, e.st, b.workspace, billing.Business)
	e.tick(days(16))
	e.tick(days(23))
	if n := len(e.mail.with("Zahlungserinnerung")); n != 0 || e.actions(b) != before {
		t.Fatalf("after payment and upgrade: %d reminders, %+v", n, e.actions(b))
	}
}

// TestAutomationCancelKeepsWhatWasDone: a cancelled plan's issued item stays counted and no item is issued after it;
// the issued partial stays open, so its own reminders still count.
func TestAutomationCancelKeepsWhatWasDone(t *testing.T) {
	e := newEnv(t)
	b := e.ready()
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	p := e.plan(b, e.client(b, "ap@kunde.ch"), map[string]any{"auto_send": false})
	e.tick(time.Now())
	if u := e.actions(b); u.Consumed != 1 || u.Reserved != 0 {
		t.Fatalf("issued: %+v", u)
	}
	e.do(b, "POST", "/api/v1/instalment-plans/"+p.ID+"/cancel", nil, http.StatusOK, nil)
	e.tick(days(35))
	e.tick(days(70))
	reminders := int64(len(e.mail.with("Zahlungserinnerung")))
	if u := e.actions(b); u.Consumed != 1+reminders || u.Reserved != 0 || e.partials(b) != 1 {
		t.Fatalf("after cancel: %+v, %d partials, %d reminders", u, e.partials(b), reminders)
	}
}
