package store

import (
	"context"
	"testing"
	"time"
)

// TestWorkspaceDomainsMigration: 00032 gives every published offer custom_portal_domain (Business only), publishes
// helvetly-v1.3 with its record last, and Down takes it all back.
func TestWorkspaceDomainsMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 32); err != nil {
		t.Fatal(err)
	}
	count := func(sql string) int64 {
		t.Helper()
		var n int64
		if err := pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM limit_plans WHERE limit_key = 'custom_portal_domain'
		AND state = CASE plan_id WHEN 'business' THEN 'enabled' ELSE 'disabled' END`); n != 4*3 {
		t.Fatalf("%d custom_portal_domain values, want 3 plans in 4 offers", n)
	}
	if n := count(`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1.3' AND document->>'offer_id' = id
		AND document->'records'->-1->>'key' = 'custom_portal_domain' AND jsonb_array_length(document->'records') = 69`); n != 1 {
		t.Fatal("helvetly-v1.3 is not published with the record last")
	}
	if _, err := p.DownTo(ctx, 31); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM limits WHERE key = 'custom_portal_domain'`) + count(`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1.3'`); n != 0 {
		t.Fatal("left after Down")
	}
	if _, err := p.UpTo(ctx, 32); err != nil {
		t.Fatalf("Up again: %v", err)
	}
}

// TestWorkspaceDomainsDNSMigration: 00033 drops Cloudflare's columns and dates every row's status; Down restores them.
func TestWorkspaceDomainsDNSMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 32); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workspaces (id, name, created_at) VALUES ('ws_d', 'D', now());
		INSERT INTO workspace_domains (id, workspace_id, hostname, cf_hostname_id, status, next_check_at, created_by, created_at, updated_at)
		VALUES ('dom_1', 'ws_d', 'portal.d.ch', 'cf_1', 'pending', now(), 'usr', now(), '2026-11-01')`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 33); err != nil {
		t.Fatal(err)
	}
	var since time.Time
	if err := pool.QueryRow(ctx, `SELECT status_since FROM workspace_domains WHERE id = 'dom_1'`).Scan(&since); err != nil || since.Format(time.DateOnly) != "2026-11-01" {
		t.Fatalf("status_since %v: %v", since, err)
	}
	if _, err := p.DownTo(ctx, 32); err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 33); err != nil {
		t.Fatalf("Up again: %v", err)
	}
}
