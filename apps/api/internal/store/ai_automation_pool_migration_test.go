package store

import (
	"context"
	"testing"
)

// TestAIAutomationPoolMigration: 00018 splits each month's model usage by the kind of its calls (import into the
// automation pool, Heidi's left alone), keeps a month blocked only in the pool whose call is uncertain, gives every
// earlier offer the automation limits at Heidi's values and publishes helvetly-v1.2; Down merges the pools again.
func TestAIAutomationPoolMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 17); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	count := func(sql string, args ...any) int64 {
		t.Helper()
		var n int64
		if err := pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}
	exec(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_ai', 'A', now())`)
	// 1000 Heidi tokens from before ai_calls, then one settled Heidi call, one settled and one uncertain import.
	exec(`INSERT INTO heidi_usage (workspace_id, period, tokens_used, tokens_reserved, cost_micros, cost_reserved_micros, uncertain, updated_at)
		VALUES ('ws_ai', '2026-11', 1000 + 200 + 300, 50, 20 + 30, 7, true, now())`)
	exec(`INSERT INTO ai_calls (id, workspace_id, period, kind, operation, step, status, rate_card, model, tier, region,
			reserved_tokens, reserved_micros, total_tokens, cost_micros, created_at) VALUES
		('c_heidi', 'ws_ai', '2026-11', 'heidi', 't', 'a', 'settled', 'r', 'm', 't', 'r', 400, 40, 200, 20, now()),
		('c_import', 'ws_ai', '2026-11', 'import', 'f', '0', 'settled', 'r', 'm', 't', 'r', 400, 40, 300, 30, now()),
		('c_lost', 'ws_ai', '2026-11', 'import', 'f', '1', 'uncertain', 'r', 'm', 't', 'r', 50, 7, NULL, NULL, now())`)
	if _, err := p.UpTo(ctx, 18); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		pool                      string
		used, reserved, cost, res int64
		uncertain                 bool
	}{{"heidi", 1200, 0, 20, 0, false}, {"automation", 300, 50, 30, 7, true}} {
		var used, reserved, cost, res int64
		var uncertain bool
		if err := pool.QueryRow(ctx, `SELECT tokens_used, tokens_reserved, cost_micros, cost_reserved_micros, uncertain
			FROM heidi_usage WHERE workspace_id = 'ws_ai' AND period = '2026-11' AND pool = $1`, c.pool).Scan(&used, &reserved, &cost, &res, &uncertain); err != nil {
			t.Fatal(c.pool, err)
		}
		if used != c.used || reserved != c.reserved || cost != c.cost || res != c.res || uncertain != c.uncertain {
			t.Fatalf("%s: %d used, %d reserved, %d cost, %d cost reserved, uncertain %v; want %+v", c.pool, used, reserved, cost, res, uncertain, c)
		}
	}
	if n := count(`SELECT count(*) FROM ai_calls WHERE pool = 'automation' AND kind = 'import'`); n != 2 {
		t.Fatalf("%d import calls in the automation pool", n)
	}
	for _, offer := range []string{"helvetly-v1", "helvetly-v1.1", "helvetly-v1.2"} {
		if n := count(`SELECT count(*) FROM limit_plans a JOIN limit_plans b USING (offer_id, plan_id, state, per_additional_paid_seat)
			WHERE a.offer_id = $1 AND a.value IS NOT DISTINCT FROM b.value AND (
				(a.limit_key = 'ai_tokens_per_month' AND b.limit_key = 'ai_automation_tokens_per_month') OR
				(a.limit_key = 'ai_cost_usd_micros' AND b.limit_key = 'ai_automation_cost_usd_micros'))`, offer); n != 2*3 {
			t.Fatalf("%s: %d automation values at Heidi's", offer, n)
		}
	}
	if n := count(`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1.2' AND document->>'offer_id' = id
		AND jsonb_array_length(document->'records') = 68 AND published_at > (SELECT published_at FROM offer_versions WHERE id = 'helvetly-v1.1')`); n != 1 {
		t.Fatal("helvetly-v1.2 is not published as the latest with the two records")
	}
	if _, err := p.DownTo(ctx, 17); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT tokens_used FROM heidi_usage WHERE workspace_id = 'ws_ai'`); n != 1500 {
		t.Fatalf("%d tokens after Down, want the pools merged", n)
	}
	if n := count(`SELECT count(*) FROM limits WHERE key LIKE 'ai_automation%'`); n != 0 {
		t.Fatal("automation limits left after Down")
	}
	if _, err := p.UpTo(ctx, 18); err != nil {
		t.Fatalf("Up again: %v", err)
	}
}
