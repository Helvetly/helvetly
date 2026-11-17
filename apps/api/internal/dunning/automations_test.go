package dunning

import (
	"context"
	"net/http"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

// actions is the workspace's automatic actions in the month of the job's clock.
func (e *env) actions(ws string) store.PeriodUsage {
	e.t.Helper()
	p := store.UsagePeriod(e.svc.now())
	u, err := e.st.UsageInPeriods(context.Background(), ws, store.AutomationActions, p, p)
	if err != nil {
		e.t.Fatal(err)
	}
	return u
}

// useActions spends all but left of Pro's 1500 actions in the month of at.
func (e *env) useActions(ws string, at time.Time, left int) {
	e.t.Helper()
	if _, err := e.pool.Exec(context.Background(), `INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period,
			reserved, consumed, created_at, settled_at)
		SELECT $1, $2, 'seed:' || i, '', $3, 0, 1, now(), now() FROM generate_series(1, $4::int) AS i`,
		ws, store.AutomationActions, store.UsagePeriod(at), 1500-left); err != nil {
		e.t.Fatal(err)
	}
}

// TestEachNoticeIsOneAction: every notice sent counts one action, by the job or by "Send now"; repeated and empty
// ticks count nothing, sending the invoice by hand is no automation, and a failed send keeps its reservation for the
// retry, which counts it once.
func TestEachNoticeIsOneAction(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	id := e.invoice(b, nil)
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Pro)

	e.tickAt(5) // nothing due
	if u := e.actions(b.workspace); u.Total() != 0 {
		t.Fatalf("an empty tick counted %+v", u)
	}
	e.mail.fail = true
	e.tickAt(10)
	if u := e.actions(b.workspace); u.Consumed != 0 || u.Reserved != 1 {
		t.Fatalf("a failed send: %+v", u)
	}
	e.mail.fail = false
	e.tickAt(10)
	e.tickAt(11)
	if u := e.actions(b.workspace); u.Consumed != 1 || u.Reserved != 0 {
		t.Fatalf("the retry: %+v", u)
	}
	e.do(b, "POST", "/api/v1/invoices/"+id+"/dunning/send", nil, http.StatusOK, nil)
	if u := e.actions(b.workspace); u.Consumed != 2 {
		t.Fatalf("Send now runs the automation: %+v", u)
	}
	e.do(b, "POST", "/api/v1/invoices/"+id+"/send", map[string]any{}, http.StatusOK, nil)
	if u := e.actions(b.workspace); u.Consumed != 2 || len(e.mail.subjects()) != 3 {
		t.Fatalf("sending the invoice by hand is no automation: %+v", u)
	}
}

// TestRemindersPauseAtTheLimitAndNeverChaseAPaidInvoice: with no action left the due notice waits (nothing sent,
// nothing recorded) and "Send now" is refused as a spent allowance; the invoice is paid meanwhile, so after the upgrade
// no reminder goes for it, while another open invoice's does.
func TestRemindersPauseAtTheLimitAndNeverChaseAPaidInvoice(t *testing.T) {
	e := newEnv(t)
	b := e.ready(nil)
	paid := e.invoice(b, nil)
	open := e.invoice(b, nil)
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, b.workspace, billing.Pro)
	e.useActions(b.workspace, time.Now().AddDate(0, 0, 20), 0)

	e.tickAt(10)
	if got := e.mail.subjects(); len(got) != 0 {
		t.Fatalf("sent at the limit: %v", got)
	}
	if st := e.status(b, open); len(st.Notices) != 0 || st.Next == nil {
		t.Fatalf("the paused notice: %+v", st)
	}
	e.fails(b, "POST", "/api/v1/invoices/"+open+"/dunning/send", http.StatusPaymentRequired, "limit_reached")

	e.do(b, "POST", "/api/v1/invoices/"+paid+"/mark-paid", map[string]any{}, http.StatusOK, nil)
	billingtest.On(t, e.st, b.workspace, billing.Basic)
	e.tickAt(11)
	billingtest.On(t, e.st, b.workspace, billing.Business)
	e.tickAt(12)
	if got := e.mail.subjects(); len(got) != 1 {
		t.Fatalf("after the upgrade: %v", got)
	}
	if st := e.status(b, paid); len(st.Notices) != 0 {
		t.Fatalf("a paid invoice was reminded: %+v", st.Notices)
	}
	if st := e.status(b, open); len(st.Notices) != 1 {
		t.Fatalf("the open invoice: %+v", st.Notices)
	}
	if u := e.actions(b.workspace); u.Total() != 1501 {
		t.Fatalf("used %+v", u)
	}
}

// TestTheJobLeavesAWaitingNoticeAlone: while billing says the workspace's action or email limits wait, the job neither
// renders, reserves nor sends the due notice, and asks for the limits a notice needs; once the wait ends the next
// tick sends it. "Send now" does not ask: a person gets the limit's answer.
func TestTheJobLeavesAWaitingNoticeAlone(t *testing.T) {
	for _, tc := range []struct {
		name string
		wait bool
		sent int
	}{{"waiting", true, 0}, {"not waiting", false, 1}} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			b := e.ready(nil)
			e.invoice(b, nil)
			var asked []string
			e.st.SetAutomationWait(func(_ context.Context, ws string, limits ...string) (bool, error) {
				if ws != b.workspace {
					t.Errorf("asked about workspace %s", ws)
				}
				asked = limits
				return tc.wait, nil
			})
			e.tickAt(10)
			if got := e.mail.subjects(); len(got) != tc.sent {
				t.Fatalf("sent %v", got)
			}
			if u := e.actions(b.workspace); u.Total() != 0 && tc.wait {
				t.Fatalf("a waiting notice reserved %+v", u)
			}
			if !slices.Equal(asked, []string{store.AutomationActions, store.EmailRecipients}) {
				t.Fatalf("asked for %v", asked)
			}
			if tc.wait {
				e.st.SetAutomationWait(nil)
				e.tickAt(11)
				if got := e.mail.subjects(); len(got) != 1 {
					t.Fatalf("after the wait: %v", got)
				}
			}
		})
	}
}
