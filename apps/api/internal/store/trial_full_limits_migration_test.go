package store

import (
	"context"
	"testing"
)

// TestTrialFullLimitsMigration: 00017 publishes helvetly-v1.1 (helvetly-v1 with no trial overrides, the same plan
// values) as the offer on sale, moves the trialing workspace with its own limit values and leaves the paying one on
// helvetly-v1; Down puts everything back.
func TestTrialFullLimitsMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 16); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	count := func(sql string, args ...any) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}
	exec(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_trial', 'T', now()), ('ws_paid', 'P', now())`)
	exec(`INSERT INTO workspace_billing (workspace_id, status, plan, updated_at, offer_id)
		VALUES ('ws_trial', 'trialing', 'pro', now(), 'helvetly-v1'), ('ws_paid', 'active', 'pro', now(), 'helvetly-v1')`)
	exec(`INSERT INTO limit_workspaces (workspace_id, offer_id, limit_key, state, value, reason, set_by)
		VALUES ('ws_trial', 'helvetly-v1', 'clients', 'limited', 40, 'pilot', 'op'), ('ws_paid', 'helvetly-v1', 'clients', 'limited', 50, 'pilot', 'op')`)
	if _, err := p.UpTo(ctx, 17); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1.1' AND document->'trial'->'overrides' = '{}'::jsonb
		AND document->>'offer_id' = id AND published_at > (SELECT published_at FROM offer_versions WHERE id = 'helvetly-v1')`); n != 1 {
		t.Fatalf("helvetly-v1.1 is not published as the latest without overrides: %d", n)
	}
	if n := count(`SELECT count(*) FROM limit_plans a JOIN limit_plans b USING (plan_id, limit_key, state, per_additional_paid_seat)
		WHERE a.offer_id = 'helvetly-v1' AND b.offer_id = 'helvetly-v1.1' AND a.value IS NOT DISTINCT FROM b.value`); n != 66*3 {
		t.Fatalf("%d plan values copied unchanged", n)
	}
	if n := count(`SELECT count(*) FROM workspace_billing WHERE workspace_id = 'ws_trial' AND offer_id = 'helvetly-v1.1'`); n != 1 {
		t.Fatal("the trialing workspace did not move")
	}
	if n := count(`SELECT count(*) FROM workspace_billing WHERE workspace_id = 'ws_paid' AND offer_id = 'helvetly-v1'`); n != 1 {
		t.Fatal("the paying workspace moved")
	}
	if n := count(`SELECT count(*) FROM limit_workspaces WHERE workspace_id = 'ws_trial' AND offer_id = 'helvetly-v1.1' AND value = 40`); n != 1 {
		t.Fatal("the trialing workspace lost its own limit")
	}
	if n := count(`SELECT count(*) FROM offer_audit WHERE actor = 'migration 00017'`); n != 2 {
		t.Fatalf("%d audit rows, want the publication and one move", n)
	}
	if _, err := p.DownTo(ctx, 16); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM offer_versions`); n != 1 {
		t.Fatalf("%d offers after Down", n)
	}
	if n := count(`SELECT count(*) FROM workspace_billing WHERE offer_id = 'helvetly-v1'`); n != 2 {
		t.Fatal("workspaces not back on helvetly-v1")
	}
	if _, err := p.UpTo(ctx, 17); err != nil {
		t.Fatalf("Up again: %v", err)
	}
}
