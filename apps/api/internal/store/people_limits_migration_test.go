package store

import (
	"context"
	"strings"
	"testing"
)

const peopleOffer = "helvetly-people-2026-11"

// seedPeopleWorkspaces: one workspace per plan on offer 'helvetly', before 00018.
func seedPeopleWorkspaces(t *testing.T, ctx context.Context, exec func(string, ...any)) {
	t.Helper()
	for _, w := range [][2]string{{"ws_business", "business"}, {"ws_pro", "pro"}, {"ws_basic", "basic"}} {
		exec(`INSERT INTO workspaces (id, name, created_at) VALUES ($1, $1, now())`, w[0])
		exec(`INSERT INTO workspace_billing (workspace_id, status, plan, offer_id, updated_at) VALUES ($1, 'active', $2, 'helvetly', now())`, w[0], w[1])
	}
	exec(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_none', 'ws_none', now())`)
	// Business workspaces that must stay: one with a deliberate override, one with a scheduled change to Basic.
	for _, ws := range []string{"ws_override", "ws_scheduled"} {
		exec(`INSERT INTO workspaces (id, name, created_at) VALUES ($1, $1, now())`, ws)
		exec(`INSERT INTO workspace_billing (workspace_id, status, plan, offer_id, updated_at) VALUES ($1, 'active', 'business', 'helvetly', now())`, ws)
	}
	exec(`INSERT INTO limit_workspaces (limit_key, workspace_id, offer_id, state, reason, set_by) VALUES ('clients', 'ws_override', 'helvetly', 'unlimited', 'agreed', 'support')`)
	exec(`UPDATE workspace_billing SET pending_plan = 'basic', pending_interval = 'month', pending_at = now() + interval '10 days' WHERE workspace_id = 'ws_scheduled'`)
}

// TestPeopleLimitsMigration: 00018 publishes an offer whose only difference from 'helvetly' is the people limit
// (Basic 5, Pro 25, Business unlimited), makes it the one on sale, and moves only Business workspaces to it: their
// terms only grow. Basic, Pro, workspaces without a subscription, and Business workspaces with an override or a scheduled
// plan change keep the terms they were sold; the move is audited;
// Down moves exactly those back and removes the offer, and Up runs again.
func TestPeopleLimitsMigration(t *testing.T) {
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
	text := func(sql string, args ...any) (s string) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(&s); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return s
	}
	seedPeopleWorkspaces(t, ctx, exec)
	if _, err := p.UpTo(ctx, 18); err != nil {
		t.Fatal(err)
	}

	// The offer on sale is the new one; only max_self_service_seats differs from the old one.
	if got := text(`SELECT id FROM offer_versions ORDER BY published_at DESC, id DESC LIMIT 1`); got != peopleOffer {
		t.Fatalf("offer on sale %q, want %q", got, peopleOffer)
	}
	if diff := text(`SELECT coalesce(string_agg(DISTINCT coalesce(a.limit_key, b.limit_key), ',' ORDER BY coalesce(a.limit_key, b.limit_key)), '')
		FROM (SELECT * FROM limit_plans WHERE offer_id = 'helvetly') a
		FULL JOIN (SELECT * FROM limit_plans WHERE offer_id = $1) b USING (plan_id, limit_key)
		WHERE a.state IS DISTINCT FROM b.state OR a.value IS DISTINCT FROM b.value
		   OR a.per_additional_paid_seat IS DISTINCT FROM b.per_additional_paid_seat`, peopleOffer); diff != "max_self_service_seats" {
		t.Fatalf("keys that differ from the old offer: %q", diff)
	}
	for plan, want := range map[string]string{"basic": "limited 5", "pro": "limited 25", "business": "unlimited "} {
		got := text(`SELECT state || ' ' || coalesce(value::text, '') FROM limit_plans WHERE offer_id = $1 AND plan_id = $2 AND limit_key = 'max_self_service_seats'`, peopleOffer, plan)
		if got != want {
			t.Fatalf("%s people limit %q, want %q", plan, got, want)
		}
	}
	// The document the plans came from is the published one (the checksum is checked by the billing tests).
	if text(`SELECT document->'billing'->'plans'->'basic'->>'month_minor' FROM offer_versions WHERE id = $1`, peopleOffer) != "1900" {
		t.Fatal("prices changed")
	}

	// Only Business moved, and the move is on record.
	for ws, want := range map[string]string{"ws_business": peopleOffer, "ws_pro": "helvetly", "ws_basic": "helvetly", "ws_override": "helvetly", "ws_scheduled": "helvetly"} {
		if got := text(`SELECT offer_id FROM workspace_billing WHERE workspace_id = $1`, ws); got != want {
			t.Fatalf("%s is on %q, want %q", ws, got, want)
		}
	}
	if got := text(`SELECT after->'workspaces'::text FROM offer_audit WHERE action = 'offer.assign' AND target = $1`, peopleOffer); got != `["ws_business"]` {
		t.Fatalf("audit of the move: %s", got)
	}

	// Down moves exactly the moved workspace back and removes the offer; Up runs again.
	if _, err := p.DownTo(ctx, 17); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if got := text(`SELECT offer_id FROM workspace_billing WHERE workspace_id = 'ws_business'`); got != "helvetly" {
		t.Fatalf("after rollback Business is on %q", got)
	}
	if n := text(`SELECT count(*)::text FROM offer_versions WHERE id = $1`, peopleOffer); n != "0" {
		t.Fatalf("offer left behind: %s", n)
	}
	if _, err := p.UpTo(ctx, 18); err != nil {
		t.Fatalf("up again: %v", err)
	}
}

// TestPeopleLimitsRollbackRefusals: 00018 goes down only while nothing but the workspaces it moved refers to its offer.
func TestPeopleLimitsRollbackRefusals(t *testing.T) {
	ctx := context.Background()
	for _, tt := range []struct{ name, use, table string }{
		{"a workspace that bought it", `UPDATE workspace_billing SET offer_id = '` + peopleOffer + `' WHERE workspace_id = 'ws_basic'`, "workspace_billing"},
		{"checkout saved", `INSERT INTO billing_checkouts (id, workspace_id, offer_id, plan, billing_interval, currency, price_id, seats, trial, created_by, created_at)
			VALUES ('chk_1', 'ws_none', '` + peopleOffer + `', 'pro', 'month', 'CHF', 'price_x', 1, false, 'usr_1', now())`, "billing_checkouts"},
		{"override written", `INSERT INTO limit_workspaces (limit_key, workspace_id, offer_id, state, reason, set_by)
			VALUES ('clients', 'ws_none', '` + peopleOffer + `', 'unlimited', 'agreed', 'support')`, "limit_workspaces"},
	} {
		t.Run(tt.name, func(t *testing.T) {
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
			seedPeopleWorkspaces(t, ctx, exec)
			if _, err := p.UpTo(ctx, 18); err != nil {
				t.Fatal(err)
			}
			exec(tt.use)
			_, err := p.DownTo(ctx, 17)
			if err == nil || !strings.Contains(err.Error(), "still referenced by "+tt.table) {
				t.Fatalf("rollback of a used offer: %v", err)
			}
			var offers, onNew int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM offer_versions WHERE id = $1`, peopleOffer).Scan(&offers); err != nil || offers != 1 {
				t.Fatalf("refused rollback changed the offer: %d, %v", offers, err)
			}
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM workspace_billing WHERE workspace_id = 'ws_business' AND offer_id = $1`, peopleOffer).Scan(&onNew); err != nil || onNew != 1 {
				t.Fatalf("a refused rollback moved Business back: %d, %v", onNew, err)
			}
		})
	}
}
