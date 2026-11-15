package billing

import (
	"context"
	"testing"
	"time"
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
	if n := allowance(e, b.workspace); n != 250_000 {
		t.Fatalf("basic: %d", n)
	}
	// The month's model usage is what the limit counts.
	e.exec(`INSERT INTO heidi_usage (workspace_id, period, tokens_used, updated_at) VALUES ($1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 1234, now()),
		($1, '2001-01', 99, now())`, b.workspace)
	now := time.Now()
	u, err := e.st.WorkspaceUsage(ctx, b.workspace, monthStart(now, time.UTC), now) // the workspace's zone
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
