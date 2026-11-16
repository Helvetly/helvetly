package store

import (
	"context"
	"strings"
	"testing"
)

// TestOffersMigration: 00007 publishes offer v2 with every plan's value of its 66 keys, moves a workspace's own
// values onto it (unlimited and features as states, members dropped) and assigns the workspace; published rows and
// the audit refuse changes; Down restores the earlier limits with the workspace's values, and Up runs again.
func TestOffersMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 6); err != nil {
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
	exec(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_1', 'One', now())`)
	exec(`INSERT INTO workspace_billing (workspace_id, status, plan, updated_at) VALUES ('ws_1', 'active', 'pro', now())`)
	exec(`INSERT INTO limit_workspaces (limit_key, workspace_id, value, note) VALUES
		('clients', 'ws_1', 40, 'pilot'), ('api_access', 'ws_1', 1, ''), ('storage_bytes', 'ws_1', -1, 'big'),
		('members', 'ws_1', 3, 'flat')`)
	if _, err := p.UpTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM limits`); n != 66 {
		t.Fatalf("%d definitions", n)
	}
	if n := count(`SELECT count(*) FROM limit_plans WHERE offer_id = 'helvetly-2026-11-v2'`); n != 66*3 {
		t.Fatalf("%d plan values", n)
	}
	if n := count(`SELECT count(*) FROM workspace_billing WHERE offer_id = 'helvetly-2026-11-v2'`); n != 1 {
		t.Fatalf("workspace not assigned: %d", n)
	}
	if n := count(`SELECT count(*) FROM offer_audit WHERE action = 'offer.publish' AND target = 'helvetly-2026-11-v2'`); n != 1 {
		t.Fatalf("publication not audited: %d", n)
	}
	for _, c := range []struct {
		key, state string
		value      *int64
		reason     string
	}{{"clients", "limited", ptr[int64](40), "pilot"}, {"api_access", "enabled", nil, "set before offer v2"}, {"storage_bytes", "unlimited", nil, "big"}} {
		var state, reason string
		var value *int64
		if err := pool.QueryRow(ctx, `SELECT state, value, reason FROM limit_workspaces WHERE workspace_id = 'ws_1'
			AND offer_id = 'helvetly-2026-11-v2' AND limit_key = $1`, c.key).Scan(&state, &value, &reason); err != nil {
			t.Fatalf("%s: %v", c.key, err)
		}
		if state != c.state || (value == nil) != (c.value == nil) || (value != nil && *value != *c.value) || reason != c.reason {
			t.Fatalf("%s: %s %v %q", c.key, state, value, reason)
		}
	}
	if n := count(`SELECT count(*) FROM limit_workspaces WHERE limit_key = 'members'`); n != 0 {
		t.Fatalf("members kept: %d", n)
	}
	for _, sql := range []string{
		`UPDATE limit_plans SET value = 1 WHERE limit_key = 'clients'`,
		`DELETE FROM limit_plans WHERE limit_key = 'clients'`,
		`INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value) VALUES ('helvetly-2026-11-v2', 'basic', 'clients', 'limited', 1)`,
		`UPDATE offer_versions SET checksum = 'x'`,
		`DELETE FROM offer_versions`,
		`TRUNCATE limit_plans`,
		`UPDATE offer_audit SET reason = 'x'`,
		`DELETE FROM offer_audit`,
	} {
		if _, err := pool.Exec(ctx, sql); err == nil || !strings.Contains(err.Error(), "immutable") && !strings.Contains(err.Error(), "append-only") && !strings.Contains(err.Error(), "duplicate key") {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	if _, err := p.DownTo(ctx, 6); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM limits`); n != 10 {
		t.Fatalf("%d limits after Down", n)
	}
	if n := count(`SELECT value FROM limit_plans WHERE limit_key = 'clients' AND plan_id = 'pro'`); n != 1000 {
		t.Fatalf("pro clients after Down: %d", n)
	}
	for key, want := range map[string]int{"clients": 40, "api_access": 1, "storage_bytes": -1} {
		if n := count(`SELECT value FROM limit_workspaces WHERE workspace_id = 'ws_1' AND limit_key = $1`, key); n != want {
			t.Fatalf("%s after Down: %d", key, n)
		}
	}
	if _, err := p.UpTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
}

// TestOfferFlattenedToV1: 00013 folds offer v2 into helvetly-v1, the one published offer, with the Employees module on
// Business only: the workspace, its own values and its Checkout move to v1, v2's rows go and the change is audited;
// Down brings v2 back without the module, and Up runs again.
func TestOfferFlattenedToV1(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 12); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	count := func(sql string) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}
	exec(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_1', 'One', now())`)
	exec(`INSERT INTO workspace_billing (workspace_id, status, plan, updated_at, offer_id)
		VALUES ('ws_1', 'active', 'business', now(), 'helvetly-2026-11-v2')`)
	exec(`INSERT INTO limit_workspaces (limit_key, workspace_id, offer_id, state, value, set_by, reason, updated_at)
		VALUES ('clients', 'ws_1', 'helvetly-2026-11-v2', 'limited', 400, 'support', 'pilot', now())`)
	exec(`INSERT INTO billing_checkouts (id, workspace_id, offer_id, plan, billing_interval, currency, price_id, seats, trial,
		created_by, created_at) VALUES ('co_1', 'ws_1', 'helvetly-2026-11-v2', 'business', 'month', 'chf', 'price_1', 1, false, 'usr_1', now())`)
	// v2 as 00007 published it, which Down must give back exactly.
	v2 := func() (doc, plans string) {
		t.Helper()
		if err := pool.QueryRow(ctx, `SELECT document::text, (SELECT string_agg(concat_ws(' ', plan_id, limit_key, state, value,
			per_additional_paid_seat), ',' ORDER BY plan_id, limit_key) FROM limit_plans WHERE offer_id = 'helvetly-2026-11-v2')
			FROM offer_versions WHERE id = 'helvetly-2026-11-v2'`).Scan(&doc, &plans); err != nil {
			t.Fatal(err)
		}
		return doc, plans
	}
	doc, plans := v2()

	for round := range 2 { // Up, then Down and Up again; the append-only audit keeps every publication
		if _, err := p.UpTo(ctx, 13); err != nil {
			t.Fatal(err)
		}
		for sql, want := range map[string]int{
			`SELECT count(*) FROM offer_versions`: 1,
			`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1' AND document->>'offer_id' = 'helvetly-v1'
				AND checksum = '0fb3ff825f1707c36ebb02e15669544a2f95c9838498677d3844682d9601b52a'`: 1,
			`SELECT count(*) FROM limit_plans WHERE offer_id = 'helvetly-v1'`:                                               67 * 3,
			`SELECT count(*) FROM limit_plans WHERE limit_key = 'employees' AND state = 'enabled'`:                          1,
			`SELECT count(*) FROM limit_plans WHERE limit_key = 'employees' AND plan_id = 'business' AND state = 'enabled'`: 1,
			// The AI import from Pro up; Basic, without Heidi or the import, has no AI tokens or AI cost budget.
			`SELECT count(*) FROM limit_plans WHERE limit_key = 'ai_import' AND state = 'enabled' AND plan_id <> 'basic'`: 2,
			`SELECT count(*) FROM limit_plans WHERE plan_id = 'basic' AND (limit_key = 'ai_import' AND state = 'disabled'
				OR limit_key IN ('ai_tokens_per_month', 'ai_cost_usd_micros') AND value = 0 AND per_additional_paid_seat = 0)`: 3,
			`SELECT count(*) FROM limits WHERE key = 'ai_tokens_per_month' AND requires_features = '{ai_import}'`:           1,
			`SELECT count(*) FROM workspace_billing WHERE offer_id = 'helvetly-v1'`:                                         1,
			`SELECT count(*) FROM limit_workspaces WHERE offer_id = 'helvetly-v1' AND value = 400`:                          1,
			`SELECT count(*) FROM billing_checkouts WHERE offer_id = 'helvetly-v1'`:                                         1,
			`SELECT count(*) FROM offer_audit WHERE target = 'helvetly-v1' AND before->>'offer_id' = 'helvetly-2026-11-v2'`: round + 1,
		} {
			if n := count(sql); n != want {
				t.Fatalf("%s: %d, want %d", sql, n, want)
			}
		}
		if _, err := p.DownTo(ctx, 12); err != nil {
			t.Fatal(err)
		}
		if d, l := v2(); d != doc || l != plans {
			t.Fatalf("after Down, v2 differs from 00007's:\n%s\n%s", d, l)
		}
		for sql, want := range map[string]int{
			`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-2026-11-v2'
				AND jsonb_path_exists(document, '$.records[*] ? (@.key == "employees")') = false`: 1,
			`SELECT count(*) FROM limit_plans WHERE offer_id = 'helvetly-2026-11-v2'`:                      66 * 3,
			`SELECT count(*) FROM limits WHERE key = 'ai_tokens_per_month' AND requires_features = '{}'`:   1,
			`SELECT count(*) FROM limits WHERE key = 'employees'`:                                          0,
			`SELECT count(*) FROM workspace_billing WHERE offer_id = 'helvetly-2026-11-v2'`:                1,
			`SELECT count(*) FROM limit_workspaces WHERE offer_id = 'helvetly-2026-11-v2' AND value = 400`: 1,
			`SELECT count(*) FROM billing_checkouts WHERE offer_id = 'helvetly-2026-11-v2'`:                1,
		} {
			if n := count(sql); n != want {
				t.Fatalf("after Down, %s: %d, want %d", sql, n, want)
			}
		}
	}
}

// TestOfferV2Migration: 00014 publishes offer helvetly-v2 next to helvetly-v1 with its new key, moves every workspace
// on v1 to it with its own values (v1 has no quotes_per_month, which would refuse every quote), and audits it; Down
// moves them back, removes v2 and the key, and Up runs again.
func TestOfferV2Migration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 13); err != nil {
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
	exec(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_1', 'One', now())`)
	exec(`INSERT INTO workspace_billing (workspace_id, status, plan, offer_id, updated_at)
		VALUES ('ws_1', 'trialing', 'business', 'helvetly-v1', now())`)
	exec(`INSERT INTO limit_workspaces (workspace_id, offer_id, limit_key, state, value, reason, set_by)
		VALUES ('ws_1', 'helvetly-v1', 'clients', 'limited', 40, 'pilot', 'ops')`)
	if _, err := p.UpTo(ctx, 14); err != nil {
		t.Fatal(err)
	}
	for sql, want := range map[string]int{
		`SELECT count(*) FROM limits`:                                                                                              68,
		`SELECT count(*) FROM limit_plans WHERE offer_id = 'helvetly-v2'`:                                                          68 * 3,
		`SELECT count(*) FROM limit_plans WHERE offer_id = 'helvetly-v1'`:                                                          67 * 3,
		`SELECT count(*) FROM workspace_billing WHERE offer_id = 'helvetly-v2'`:                                                    1,
		`SELECT count(*) FROM offer_audit WHERE action = 'offer.publish' AND target = 'helvetly-v2'`:                               1,
		`SELECT value FROM limit_workspaces WHERE offer_id = 'helvetly-v2' AND limit_key = 'clients'`:                              40,
		`SELECT value FROM limit_plans WHERE offer_id = 'helvetly-v2' AND limit_key = 'quotes_per_month' AND plan_id = 'pro'`:      100,
		`SELECT count(*) FROM limit_plans WHERE offer_id = 'helvetly-v2' AND plan_id = 'business' AND state = 'unlimited'`:         7,
		`SELECT l.position - i.position FROM limits l, limits i WHERE l.key = 'quotes_per_month' AND i.key = 'invoices_per_month'`: 1,
	} {
		if n := count(sql); n != want {
			t.Fatalf("%s: %d, want %d", sql, n, want)
		}
	}
	if _, err := p.DownTo(ctx, 13); err != nil {
		t.Fatal(err)
	}
	for sql, want := range map[string]int{
		`SELECT count(*) FROM limits`:                                           67,
		`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v2'`:          0,
		`SELECT count(*) FROM workspace_billing WHERE offer_id = 'helvetly-v1'`: 1,
		`SELECT count(*) FROM limit_workspaces WHERE offer_id = 'helvetly-v1'`:  1,
		`SELECT count(*) FROM limit_workspaces WHERE offer_id <> 'helvetly-v1'`: 0,
	} {
		if n := count(sql); n != want {
			t.Fatalf("after Down, %s: %d, want %d", sql, n, want)
		}
	}
	if _, err := p.UpTo(ctx, 14); err != nil {
		t.Fatal(err)
	}
}
