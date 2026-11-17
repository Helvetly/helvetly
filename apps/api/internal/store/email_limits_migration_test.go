package store

import (
	"context"
	"strings"
	"testing"
)

const emailOffer = "helvetly-email-2026-11"

// seedEmailWorkspaces: before 00021, a Pro workspace on 'helvetly' with an override of a key 00021 retires, a Business
// one on helvetly-people-2026-11 with an override it keeps, one without a subscription, and two Checkouts on
// 'helvetly' (one settled).
func seedEmailWorkspaces(t *testing.T, exec func(string, ...any)) {
	t.Helper()
	for _, w := range [][3]string{{"ws_pro", "pro", "helvetly"}, {"ws_business", "business", peopleOffer}} {
		exec(`INSERT INTO workspaces (id, name, created_at) VALUES ($1, $1, now())`, w[0])
		exec(`INSERT INTO workspace_billing (workspace_id, status, plan, offer_id, updated_at) VALUES ($1, 'active', $2, $3, now())`, w[0], w[1], w[2])
	}
	exec(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_none', 'ws_none', now())`)
	exec(`INSERT INTO limit_workspaces (limit_key, workspace_id, offer_id, state, reason, set_by) VALUES
		('download_bytes_per_month', 'ws_pro', 'helvetly', 'unlimited', 'agreed', 'support'),
		('clients', 'ws_business', $1, 'limited', 'agreed', 'support')`, peopleOffer)
	exec(`UPDATE limit_workspaces SET value = 7 WHERE workspace_id = 'ws_business'`)
	exec(`INSERT INTO billing_checkouts (id, workspace_id, offer_id, plan, billing_interval, currency, price_id, seats, trial, created_by, created_at, settled_at)
		VALUES ('chk_open', 'ws_none', 'helvetly', 'pro', 'month', 'CHF', 'price_x', 1, false, 'usr_1', now(), NULL),
		       ('chk_done', 'ws_pro', 'helvetly', 'pro', 'month', 'CHF', 'price_x', 1, false, 'usr_1', now(), now())`)
}

// TestEmailLimitsMigration: 00021 publishes the offer on sale with emails Basic 100, Pro 500, Business 2000 and no
// download or email attachment limits, retires those two keys from the definitions and every offer's values, and
// moves every workspace (with its overrides on its offer) and every unsettled Checkout to it. Down moves them back,
// restores the two keys from the documents that sold them, and Up runs again.
func TestEmailLimitsMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 20); err != nil {
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
	retired := `('download_bytes_per_month', 'email_attachment_bytes_per_month')`
	retiredPlans := text(`SELECT count(*)::text FROM limit_plans WHERE limit_key IN ` + retired)
	seedEmailWorkspaces(t, exec)
	if _, err := p.UpTo(ctx, 21); err != nil {
		t.Fatal(err)
	}

	if got := text(`SELECT id FROM offer_versions ORDER BY published_at DESC, id DESC LIMIT 1`); got != emailOffer {
		t.Fatalf("offer on sale %q, want %q", got, emailOffer)
	}
	if n := text(`SELECT (SELECT count(*) FROM limits WHERE key IN ` + retired + `) + (SELECT count(*) FROM limit_plans WHERE limit_key IN ` + retired + `)
		+ (SELECT count(*) FROM limit_workspaces WHERE limit_key IN ` + retired + `)`); n != "0" {
		t.Fatalf("%s rows of the retired keys left", n)
	}
	if diff := text(`SELECT coalesce(string_agg(DISTINCT coalesce(a.limit_key, b.limit_key), ','), '')
		FROM (SELECT * FROM limit_plans WHERE offer_id = $1) a
		FULL JOIN (SELECT * FROM limit_plans WHERE offer_id = $2) b USING (plan_id, limit_key)
		WHERE a.state IS DISTINCT FROM b.state OR a.value IS DISTINCT FROM b.value
		   OR a.per_additional_paid_seat IS DISTINCT FROM b.per_additional_paid_seat`, peopleOffer, emailOffer); diff != "emails_per_month" {
		t.Fatalf("keys that differ from the people offer: %q", diff)
	}
	for plan, want := range map[string]string{"basic": "100 100", "pro": "500 500", "business": "2000 2000"} {
		got := text(`SELECT value || ' ' || per_additional_paid_seat FROM limit_plans WHERE offer_id = $1 AND plan_id = $2 AND limit_key = 'emails_per_month'`, emailOffer, plan)
		if got != want {
			t.Fatalf("%s emails %q, want %q", plan, got, want)
		}
	}
	for _, ws := range []string{"ws_pro", "ws_business"} {
		if got := text(`SELECT offer_id FROM workspace_billing WHERE workspace_id = $1`, ws); got != emailOffer {
			t.Fatalf("%s is on %q", ws, got)
		}
	}
	if got := text(`SELECT value::text FROM limit_workspaces WHERE workspace_id = 'ws_business' AND offer_id = $1 AND limit_key = 'clients'`, emailOffer); got != "7" {
		t.Fatalf("override not carried over: %q", got)
	}
	if got := text(`SELECT string_agg(id || '=' || offer_id, ',' ORDER BY id) FROM billing_checkouts`); got != "chk_done=helvetly,chk_open="+emailOffer {
		t.Fatalf("checkouts: %s", got)
	}

	if _, err := p.DownTo(ctx, 20); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if got := text(`SELECT string_agg(workspace_id || '=' || offer_id, ',' ORDER BY workspace_id) FROM workspace_billing`); got != "ws_business="+peopleOffer+",ws_pro=helvetly" {
		t.Fatalf("after rollback: %s", got)
	}
	if got := text(`SELECT offer_id FROM billing_checkouts WHERE id = 'chk_open'`); got != "helvetly" {
		t.Fatalf("after rollback the checkout is on %q", got)
	}
	if got := text(`SELECT string_agg(key || ' ' || position || ' ' || allow_unlimited, ',' ORDER BY key) FROM limits WHERE key IN ` + retired); got != "download_bytes_per_month 50 false,email_attachment_bytes_per_month 62 false" {
		t.Fatalf("definitions restored: %s", got)
	}
	if got := text(`SELECT count(*)::text FROM limit_plans WHERE limit_key IN ` + retired); got != retiredPlans {
		t.Fatalf("%s values of the retired keys restored, want %s", got, retiredPlans)
	}
	if n := text(`SELECT count(*)::text FROM offer_versions WHERE id = $1`, emailOffer); n != "0" {
		t.Fatalf("offer left behind: %s", n)
	}
	if _, err := p.UpTo(ctx, 21); err != nil {
		t.Fatalf("up again: %v", err)
	}
}

// TestEmailLimitsRollbackRefusal: 00021 goes down only while nothing but what it moved refers to its offer.
func TestEmailLimitsRollbackRefusal(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 20); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	seedEmailWorkspaces(t, exec)
	if _, err := p.UpTo(ctx, 21); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO billing_checkouts (id, workspace_id, offer_id, plan, billing_interval, currency, price_id, seats, trial, created_by, created_at)
		VALUES ('chk_new', 'ws_none', $1, 'basic', 'month', 'CHF', 'price_x', 1, false, 'usr_1', now())`, emailOffer)
	if _, err := p.DownTo(ctx, 20); err == nil || !strings.Contains(err.Error(), "still referenced by billing_checkouts") {
		t.Fatalf("rollback of a used offer: %v", err)
	}
	var on int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM workspace_billing WHERE offer_id = $1`, emailOffer).Scan(&on); err != nil || on != 2 {
		t.Fatalf("a refused rollback moved workspaces: %d, %v", on, err)
	}
}
