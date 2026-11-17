package store

import (
	"context"
	"strings"
	"testing"
)

// TestOffersMigration: 00007 publishes offer helvetly-v1 with every plan's value of its 66 keys, moves a workspace's own
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
	if n := count(`SELECT count(*) FROM limit_plans WHERE offer_id = 'helvetly-v1'`); n != 66*3 {
		t.Fatalf("%d plan values", n)
	}
	if n := count(`SELECT count(*) FROM offer_versions`); n != 1 {
		t.Fatalf("%d offers, want helvetly-v1 alone", n)
	}
	if n := count(`SELECT count(*) FROM workspace_billing WHERE offer_id = 'helvetly-v1'`); n != 1 {
		t.Fatalf("workspace not assigned: %d", n)
	}
	if n := count(`SELECT count(*) FROM offer_audit WHERE action = 'offer.publish' AND target = 'helvetly-v1'`); n != 1 {
		t.Fatalf("publication not audited: %d", n)
	}
	for _, c := range []struct {
		key, state string
		value      *int64
		reason     string
	}{{"clients", "limited", ptr[int64](40), "pilot"}, {"api_access", "enabled", nil, "set before offer helvetly-v1"}, {"storage_bytes", "unlimited", nil, "big"}} {
		var state, reason string
		var value *int64
		if err := pool.QueryRow(ctx, `SELECT state, value, reason FROM limit_workspaces WHERE workspace_id = 'ws_1'
			AND offer_id = 'helvetly-v1' AND limit_key = $1`, c.key).Scan(&state, &value, &reason); err != nil {
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
		`INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value) VALUES ('helvetly-v1', 'basic', 'clients', 'limited', 1)`,
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
