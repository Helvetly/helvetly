package billing

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestAITokensFollowThePlan(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	b := e.workspace()
	allowance := func(e *env, ws string) int64 {
		t.Helper()
		n, err := e.svc.AITokens(ctx, e.st.Q, ws)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := allowance(e, b.workspace); n != 0 {
		t.Fatalf("no plan: %d", n)
	}
	e.subscribe(b.workspace, "price_bm")
	if n := allowance(e, b.workspace); n != 0 { // Basic has neither Heidi nor the AI import
		t.Fatalf("basic: %d", n)
	}
	e.subscribe(b.workspace, "price_pm")
	if n := allowance(e, b.workspace); n != 10_000_000 { // 5M for each of Pro's 2 included people
		t.Fatalf("pro: %d", n)
	}
	// The month's model usage is what the limit counts.
	e.exec(`INSERT INTO heidi_usage (workspace_id, pool, period, tokens_used, updated_at) VALUES ($1, 'heidi', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 1234, now()),
		($1, 'heidi', '2001-01', 99, now())`, b.workspace)
	now := time.Now()
	u, err := e.st.WorkspaceUsage(ctx, store.Workspace{ID: b.workspace, Timezone: "UTC"}, store.UsagePeriod(now), now)
	if err != nil || used(u, AITokens) != 1234 {
		t.Fatalf("usage %d %v", used(u, AITokens), err)
	}

	t.Run("billing off", func(t *testing.T) {
		off := newEnv(t, false)
		if n := allowance(off, off.workspace().workspace); n != Unlimited {
			t.Fatalf("billing off: %d", n)
		}
	})
}

// TestAICostFollowsTheOffer: the cost guard is the offer's ai_cost_usd_micros pooled by paid seats, none without a
// plan and unlimited without billing; a pack adds tokens, never cost.
func TestAICostFollowsTheOffer(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	b := e.workspace()
	cost := func(e *env, ws string) int64 {
		t.Helper()
		n, err := e.svc.AICost(ctx, e.st.Q, ws)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := cost(e, b.workspace); n != 0 {
		t.Fatalf("no plan: %d", n)
	}
	e.subscribe(b.workspace, "price_pm")
	e.exec(`UPDATE workspace_billing SET per_seat = true, seats = 2 WHERE workspace_id = $1`, b.workspace)
	if n := cost(e, b.workspace); n != 6_000_000 {
		t.Fatalf("pro × 2: %d", n)
	}
	t.Run("billing off", func(t *testing.T) {
		off := newEnv(t, false)
		if n := cost(off, off.workspace().workspace); n != Unlimited {
			t.Fatalf("billing off: %d", n)
		}
	})
}

// TestAIPoolsAreSeparateAllowances: Heidi's pool and the automation pool (AI import, filing) each have their plan
// values pooled by paid seats, count only their own usage, and both stop while a payment is overdue.
func TestAIPoolsAreSeparateAllowances(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_pm")
	e.exec(`UPDATE workspace_billing SET per_seat = true, seats = 2 WHERE workspace_id = $1`, b.workspace)
	e.exec(`INSERT INTO heidi_usage (workspace_id, pool, period, tokens_used, updated_at) VALUES
		($1, 'heidi', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 1234, now()),
		($1, 'automation', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 777, now())`, b.workspace)
	now := time.Now()
	u, err := e.st.WorkspaceUsage(ctx, store.Workspace{ID: b.workspace, Timezone: "UTC"}, store.UsagePeriod(now), now)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name         string
		tokens, cost func(context.Context, store.Q, string) (int64, error)
		limit        Limit
		wantT, wantC int64
		wantUsed     int64
	}{
		{"Heidi", e.svc.AITokens, e.svc.AICost, AITokens, 10_000_000, 6_000_000, 1234},
		{"AI import and filing", e.svc.AIAutomationTokens, e.svc.AIAutomationCost, AIAutomationTokens, 10_000_000, 6_000_000, 777},
	} {
		tokens, errT := tc.tokens(ctx, e.st.Q, b.workspace)
		cost, errC := tc.cost(ctx, e.st.Q, b.workspace)
		if errT != nil || errC != nil || tokens != tc.wantT || cost != tc.wantC || used(u, tc.limit) != tc.wantUsed {
			t.Fatalf("%s: %d tokens, %d cost, %d used (%v %v); want %d, %d, %d", tc.name, tokens, cost, used(u, tc.limit), errT, errC,
				tc.wantT, tc.wantC, tc.wantUsed)
		}
	}
	e.exec(`UPDATE workspace_billing SET status = 'past_due' WHERE workspace_id = $1`, b.workspace)
	for _, a := range []func(context.Context, store.Q, string) (int64, error){e.svc.AIAutomationTokens, e.svc.AIAutomationCost} {
		if n, err := a(ctx, e.st.Q, b.workspace); err != nil || n != 0 {
			t.Fatalf("past due: %d %v, want no automation spend", n, err)
		}
	}
}
