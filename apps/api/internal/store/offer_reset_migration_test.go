package store

import (
	"context"
	"testing"
)

// TestOfferResetMigration: 00065 moves every workspace, checkout and override from helvetly-v1 … v1.5 onto the one
// offer left, helvetly-v1, keeping each workspace's plan and subscription (the owner's Business workspace with a
// lifetime discount keeps working), drops an override that was on another offer than the workspace's own, adds
// Free's values and remove_branding; Down takes Free and remove_branding back and Up works again.
func TestOfferResetMigration(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 64); err != nil {
		t.Fatal(err)
	}
	exec := func(sql string) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	count := func(sql string) int64 {
		t.Helper()
		var n int64
		if err := pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return n
	}
	exec(`INSERT INTO workspaces (id, name, created_at) VALUES ('ws_owner', 'deindeutschcoach.ch', now()), ('ws_old', 'Old', now()),
		('ws_free', 'Never paid', now())`)
	exec(`INSERT INTO workspace_billing (workspace_id, stripe_customer_id, stripe_subscription_id, status, plan, billing_interval,
			offer_id, per_seat, seats, discount, updated_at) VALUES
		('ws_owner', 'cus_owner', 'sub_owner', 'active', 'business', 'month', 'helvetly-v1.5', true, 1, '{"percent_off":100,"duration":"forever"}', now()),
		('ws_old', 'cus_old', 'sub_old', 'active', 'basic', 'year', 'helvetly-v1.2', true, 2, NULL, now()),
		('ws_free', NULL, NULL, '', '', '', NULL, false, NULL, NULL, now())`)
	exec(`INSERT INTO billing_checkouts (id, workspace_id, offer_id, plan, billing_interval, currency, price_id, seats, trial, created_by, created_at,
			settled_subscription, settled_at) VALUES ('bco_1', 'ws_owner', 'helvetly-v1.4', 'business', 'month', 'chf', 'price_x', 1, false, 'u', now(), 'sub_owner', now())`)
	exec(`INSERT INTO limit_workspaces (workspace_id, offer_id, limit_key, state, value, reason, set_by) VALUES
		('ws_owner', 'helvetly-v1.5', 'clients', 'limited', 9999, 'owner', 'op'),
		('ws_owner', 'helvetly-v1.1', 'clients', 'limited', 1, 'stale', 'op'),
		('ws_free', 'helvetly-v1.3', 'products', 'limited', 7, 'a', 'op'), ('ws_free', 'helvetly-v1.4', 'products', 'limited', 8, 'b', 'op')`)

	if _, err := p.UpTo(ctx, 65); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM offer_versions`) + count(`SELECT count(*) FROM offer_versions WHERE id = 'helvetly-v1'
		AND document->>'offer_id' = id AND (document->'trial'->>'days')::int = 14`); n != 2 {
		t.Fatal("not exactly one offer, helvetly-v1 with a 14-day trial")
	}
	if n := count(`SELECT count(*) FROM workspace_billing WHERE workspace_id = 'ws_owner' AND offer_id = 'helvetly-v1' AND plan = 'business'
		AND status = 'active' AND stripe_subscription_id = 'sub_owner' AND discount->>'percent_off' = '100'`); n != 1 {
		t.Fatal("the owner's discounted Business workspace did not keep its plan on helvetly-v1")
	}
	if n := count(`SELECT count(*) FROM workspace_billing WHERE offer_id = 'helvetly-v1'`) +
		count(`SELECT count(*) FROM workspace_billing WHERE workspace_id = 'ws_free' AND offer_id IS NULL`); n != 3 {
		t.Fatal("workspaces not moved, or one that never subscribed given an offer")
	}
	if n := count(`SELECT count(*) FROM billing_checkouts WHERE offer_id = 'helvetly-v1'`); n != 1 {
		t.Fatal("the checkout stayed on its offer")
	}
	if n := count(`SELECT count(*) FROM limit_workspaces WHERE offer_id = 'helvetly-v1' AND (workspace_id, limit_key, value) IN
		(('ws_owner', 'clients', 9999), ('ws_free', 'products', 8))`) + count(`SELECT count(*) FROM limit_workspaces`); n != 4 {
		t.Fatal("overrides not moved, or a stale one kept")
	}
	if n := count(`SELECT count(*) FROM limit_plans WHERE plan_id = 'free'`) - count(`SELECT count(*) FROM limits`); n != 0 {
		t.Fatal("Free lacks a value")
	}
	if n := count(`SELECT count(*) FROM limit_plans WHERE limit_key = 'remove_branding' AND state = CASE WHEN plan_id IN ('pro', 'business')
		THEN 'enabled' ELSE 'disabled' END`); n != 4 {
		t.Fatal("remove_branding is not Pro's and Business's")
	}
	if n := count(`SELECT count(*) FROM offer_audit WHERE action = 'offer.reset' AND target = 'helvetly-v1'`); n != 1 {
		t.Fatal("the reset is not audited")
	}
	if _, err := p.DownTo(ctx, 64); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM limit_plans WHERE plan_id = 'free' OR limit_key = 'remove_branding'`) +
		count(`SELECT count(*) FROM limits WHERE key = 'remove_branding'`); n != 0 {
		t.Fatal("Free or remove_branding left after Down")
	}
	if _, err := p.UpTo(ctx, 65); err != nil {
		t.Fatalf("Up again: %v", err)
	}
}
