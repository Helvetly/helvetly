package billing

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// TestARefusedAutomationWaitsWhileItStillWouldNotFit: a limit refused to a workspace holds back the automatic actions
// that need it while the refused amount still does not fit; a new month, a bigger cap (override or plan) or a
// reservation given back ends the wait, a change that leaves the cap as it was does not, and another limit's refusal
// or another workspace's holds back nothing.
func TestARefusedAutomationWaitsWhileItStillWouldNotFit(t *testing.T) {
	email := []string{store.AutomationActions, store.EmailRecipients}
	for _, tc := range []struct {
		name   string
		refuse Limit
		change func(e *env, ws string)
		limits []string
		wait   bool
	}{
		{name: "nothing refused", limits: email},
		{name: "actions refused, same month and cap", refuse: AutomationActions, limits: []string{store.AutomationActions}, wait: true},
		{name: "actions refused, an email action", refuse: AutomationActions, limits: email, wait: true},
		{name: "emails refused, an action without email", refuse: Emails, limits: []string{store.AutomationActions}},
		{name: "emails refused, an email action", refuse: Emails, limits: email, wait: true},
		{name: "a new month", refuse: AutomationActions, limits: email,
			change: func(e *env, ws string) {
				next := midMonthOf(store.UsagePeriodStart(time.Now()).AddDate(0, 1, 0))
				e.svc.now = func() time.Time { return next }
				// the plan still runs then, with the same cap: only the month changed
				e.exec(`UPDATE workspace_billing SET plan_expires_at = $2 WHERE workspace_id = $1`, ws, next.AddDate(0, 1, 0))
				if PlanOf(e.billing(ws), next) == "" || e.cap(ws, AutomationActions) != 1500 {
					e.t.Fatal("the plan lapsed or its cap moved in the next month")
				}
			}},
		{name: "an override raises the cap", refuse: AutomationActions, limits: email,
			change: func(e *env, ws string) { e.override(ws, AutomationActions, StateLimited, n64(2000), nil) }},
		{name: "an override keeps the cap", refuse: AutomationActions, limits: email, wait: true,
			change: func(e *env, ws string) { e.override(ws, AutomationActions, StateLimited, n64(1500), nil) }},
		{name: "a reservation given back", refuse: AutomationActions, limits: email,
			change: func(e *env, ws string) {
				if err := e.st.ReleaseAutomation(context.Background(), ws, "held"); err != nil {
					e.t.Fatal(err)
				}
			}},
		{name: "an upgrade", refuse: Emails, limits: email,
			change: func(e *env, ws string) { e.subscribe(ws, "price_xm") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			e, ws := planned(t, "price_pm")
			now := midMonthOf(time.Now())
			e.svc.now = func() time.Time { return now }
			switch tc.refuse {
			case AutomationActions:
				e.automated(ws, store.UsagePeriod(now), e.cap(ws, AutomationActions)-1)
				if err := e.st.ReserveAutomation(ctx, ws, "held", now); err != nil { // the last one, its outcome pending
					t.Fatal(err)
				}
				if err := e.st.ReserveAutomation(ctx, ws, "dunning:inv:1", now); !denied(err) {
					t.Fatalf("over the cap: %v", err)
				}
			case Emails:
				if _, err := e.svc.ReserveEmail(ctx, ws, e.cap(ws, Emails)+1, 0); !denied(err) {
					t.Fatalf("over the cap: %v", err)
				}
			}
			if tc.change != nil {
				tc.change(e, ws)
			}
			for range 2 { // the second answer is the same: a refusal past its month or cap stays forgotten
				if wait, err := e.svc.AutomationWaits(ctx, ws, tc.limits...); err != nil || wait != tc.wait {
					t.Fatalf("waits %v (%v), want %v", wait, err, tc.wait)
				}
			}
			if other := e.workspace().workspace; tc.wait {
				if wait, err := e.svc.AutomationWaits(ctx, other, tc.limits...); err != nil || wait {
					t.Fatalf("another workspace waits: %v (%v)", wait, err)
				}
			}
		})
	}
}

// midMonthOf is the middle of at's UTC month.
func midMonthOf(at time.Time) time.Time { return store.UsagePeriodStart(at).AddDate(0, 0, 14) }
