package billing

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// automated records n automatic actions already used by ws in period.
func (e *env) automated(ws, period string, n int64) {
	e.t.Helper()
	e.exec(`INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at, settled_at)
		SELECT $1, $2, 'seed:' || $3 || ':' || i, '', $3, 0, 1, now(), now() FROM generate_series(1, $4::int) AS i`,
		ws, store.AutomationActions, period, n)
}

func (e *env) actionsIn(ws, period string) store.PeriodUsage {
	e.t.Helper()
	u, err := e.st.UsageInPeriods(context.Background(), ws, store.AutomationActions, period, period)
	if err != nil {
		e.t.Fatal(err)
	}
	return u
}

func refusedWith(t *testing.T, err error, code string) {
	t.Helper()
	if _, got, _, _ := auth.Describe(err); !denied(err) || got != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

// TestAutomationActionsAtTheCap: the pooled allowance of the paid seats, at least the plan's included people, admits
// its last action and refuses the next, on Pro (2 included) and Business (5); Basic has no automations at all, however
// many seats it pays for.
func TestAutomationActionsAtTheCap(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		price string
		seats int
		cap   int64
	}{{"price_pm", 1, 3000}, {"price_xm", 1, 30000}, {"price_pm", 5, 7500}, {"price_xm", 6, 36000}} {
		t.Run(fmt.Sprint(tc.price, tc.seats), func(t *testing.T) {
			e := usageEnv(t)
			ws := e.workspace().workspace
			e.subscribe(ws, tc.price)
			e.exec(`UPDATE workspace_billing SET per_seat = true, seats = $2 WHERE workspace_id = $1`, ws, tc.seats)
			now := time.Now()
			e.automated(ws, store.UsagePeriod(now), tc.cap-2)
			for i, want := range []bool{true, true, false} { // cap-1, cap, cap+1
				err := e.st.CountAutomation(ctx, ws, fmt.Sprint("test:", i), now)
				if want != (err == nil) {
					t.Fatalf("action %d of %d: %v", tc.cap-1+int64(i), tc.cap, err)
				}
				if !want {
					refusedWith(t, err, "limit_reached")
				}
			}
			if u := e.actionsIn(ws, store.UsagePeriod(now)); u.Total() != tc.cap {
				t.Fatalf("used %+v of %d", u, tc.cap)
			}
		})
	}
	t.Run("basic", func(t *testing.T) {
		e := usageEnv(t)
		ws := e.workspace().workspace
		e.subscribe(ws, "price_bm")
		e.exec(`UPDATE workspace_billing SET per_seat = true, seats = 25 WHERE workspace_id = $1`, ws)
		refusedWith(t, e.st.CountAutomation(ctx, ws, "test:1", time.Now()), "feature_not_in_plan")
		refusedWith(t, e.st.ReserveAutomation(ctx, ws, "test:2", time.Now()), "feature_not_in_plan")
	})
}

// TestTwentyActionsForTheLastOneAdmitOne: twenty different actions racing for the last unit admit one; twenty
// attempts of the same action reserve it once.
func TestTwentyActionsForTheLastOneAdmitOne(t *testing.T) {
	ctx := context.Background()
	e := usageEnv(t)
	ws := e.workspace().workspace
	e.subscribe(ws, "price_pm")
	now := time.Now()
	e.automated(ws, store.UsagePeriod(now), 2999) // Pro: 1500 for each of its 2 included people
	race := func(id func(int) string, act func(string) error) int {
		var wg sync.WaitGroup
		start := make(chan struct{})
		won := make(chan bool, 20)
		for i := range 20 {
			wg.Go(func() {
				<-start
				err := act(id(i))
				if err != nil && !denied(err) {
					t.Errorf("action %d: %v", i, err)
				}
				won <- err == nil
			})
		}
		close(start)
		wg.Wait()
		close(won)
		n := 0
		for w := range won {
			if w {
				n++
			}
		}
		return n
	}
	count := func(id string) error { return e.st.CountAutomation(ctx, ws, id, now) }
	if n := race(func(i int) string { return fmt.Sprint("dunning:inv", i, ":1") }, count); n != 1 {
		t.Fatalf("%d of 20 admitted for the last action", n)
	}
	if u := e.actionsIn(ws, store.UsagePeriod(now)); u.Total() != 3000 {
		t.Fatalf("used %+v", u)
	}

	e.subscribe(ws, "price_xm")
	reserve := func(id string) error { return e.st.ReserveAutomation(ctx, ws, id, now) }
	if n := race(func(int) string { return "dunning:same:1" }, reserve); n != 20 { // one reservation, nineteen replays
		t.Fatalf("%d of 20 attempts of one action went through", n)
	}
	if u := e.actionsIn(ws, store.UsagePeriod(now)); u.Consumed != 3000 || u.Reserved != 1 {
		t.Fatalf("one action reserved %+v", u)
	}
}

// TestAnActionCountsOnceAcrossRetriesAndMonths: a retry, settling twice and the next month count nothing more; a
// released reservation gives its unit back and can be reserved again; a settled one is not given back.
func TestAnActionCountsOnceAcrossRetriesAndMonths(t *testing.T) {
	ctx := context.Background()
	e := usageEnv(t)
	ws := e.workspace().workspace
	e.subscribe(ws, "price_pm")
	now := time.Now()
	lastMonth := store.UsagePeriodStart(now).Add(-time.Second)
	for _, at := range []time.Time{lastMonth, lastMonth, now} {
		if err := e.st.ReserveAutomation(ctx, ws, "instalments.send:inv1", at); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := e.st.SettleAutomation(ctx, ws, "instalments.send:inv1", now); err != nil {
			t.Fatal(err)
		}
	}
	if err := e.st.ReleaseAutomation(ctx, ws, "instalments.send:inv1"); err != nil {
		t.Fatal(err)
	}
	if u, cur := e.actionsIn(ws, store.UsagePeriod(lastMonth)), e.actionsIn(ws, store.UsagePeriod(now)); u.Consumed != 1 || u.Reserved != 0 || cur.Total() != 0 {
		t.Fatalf("reserved last month, sent this month: then %+v, now %+v", u, cur)
	}

	e.automated(ws, store.UsagePeriod(now), 2999) // Pro: 1500 for each of its 2 included people
	if err := e.st.ReserveAutomation(ctx, ws, "dunning:inv2:1", now); err != nil {
		t.Fatal(err)
	}
	refusedWith(t, e.st.ReserveAutomation(ctx, ws, "dunning:inv3:1", now), "limit_reached")
	if err := e.st.ReleaseAutomation(ctx, ws, "dunning:inv2:1"); err != nil { // the invoice was paid meanwhile
		t.Fatal(err)
	}
	if err := e.st.ReserveAutomation(ctx, ws, "dunning:inv3:1", now); err != nil {
		t.Fatalf("the released unit: %v", err)
	}
}

// TestTrialHasProActionsForItsWholeLife: the trial's 1500 (Pro's) are shared by its two people and do not restart
// with the month.
func TestTrialHasProActionsForItsWholeLife(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	e.st.SetAdmission(e.svc.AllowResource)
	ws := e.workspace().workspace
	e.join(ws, "member")
	now := time.Now().UTC()
	month := store.UsagePeriodStart(now)
	e.trialing(ws, "fp_1", month.Add(-48*time.Hour))
	e.automated(ws, store.UsagePeriod(month.Add(-time.Hour)), 1480)
	e.automated(ws, store.UsagePeriod(now), 19)
	if err := e.st.CountAutomation(ctx, ws, "test:1500", now); err != nil {
		t.Fatalf("the 1500th: %v", err)
	}
	refusedWith(t, e.st.CountAutomation(ctx, ws, "test:1501", now), "limit_reached")
}

// TestPlanChangesNeitherResetNorDropActions: Business→Pro keeps the month's usage against Pro's smaller pool, Basic
// refuses automations as a missing module, and Business again admits them.
func TestPlanChangesNeitherResetNorDropActions(t *testing.T) {
	ctx := context.Background()
	e := usageEnv(t)
	ws := e.workspace().workspace
	e.subscribe(ws, "price_xm")
	now := time.Now()
	e.automated(ws, store.UsagePeriod(now), 3100) // above Pro's 3000 (1500 for each of its 2 included people)
	e.subscribe(ws, "price_pm")
	refusedWith(t, e.st.CountAutomation(ctx, ws, "test:a", now), "limit_reached")
	e.subscribe(ws, "price_bm")
	refusedWith(t, e.st.CountAutomation(ctx, ws, "test:a", now), "feature_not_in_plan")
	e.subscribe(ws, "price_xm")
	if err := e.st.CountAutomation(ctx, ws, "test:a", now); err != nil {
		t.Fatalf("back on Business: %v", err)
	}
	if u := e.actionsIn(ws, store.UsagePeriod(now)); u.Total() != 3101 {
		t.Fatalf("used %+v", u)
	}
}
