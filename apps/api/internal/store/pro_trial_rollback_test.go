package store

import (
	"context"
	"strings"
	"testing"
)

const proTrialOffer = "helvetly-v2-pro-trial"

// TestProTrialRollback: 00015 goes down only while nothing refers to its offer. A used offer refuses, and the
// refusal leaves the offer, its plans and every reference exactly as they were.
func TestProTrialRollback(t *testing.T) {
	ctx := context.Background()
	for _, tt := range []struct {
		name, use, table string // use: SQL that makes the offer used; "" for unused
	}{
		{"unused", "", ""},
		{"workspace pinned", `INSERT INTO workspace_billing (workspace_id, status, plan, trial_end, offer_id, updated_at)
			VALUES ('ws_1', 'trialing', 'pro', now() + interval '7 days', 'helvetly-v2-pro-trial', now())`, "workspace_billing"},
		{"checkout saved", `INSERT INTO billing_checkouts (id, workspace_id, offer_id, plan, billing_interval, currency, price_id, seats, trial, created_by, created_at)
			VALUES ('chk_1', 'ws_1', 'helvetly-v2-pro-trial', 'pro', 'month', 'CHF', 'price_x', 1, true, 'usr_1', now())`, "billing_checkouts"},
		{"override written", `INSERT INTO limit_workspaces (limit_key, workspace_id, offer_id, state, reason, set_by)
			VALUES ('clients', 'ws_1', 'helvetly-v2-pro-trial', 'unlimited', 'agreed', 'support')`, "limit_workspaces"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			p, pool := migrationProvider(t)
			if _, err := p.UpTo(ctx, 15); err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, `INSERT INTO workspaces (id, name, created_at) VALUES ('ws_1', 'A', now())`); err != nil {
				t.Fatal(err)
			}
			if tt.use != "" {
				if _, err := pool.Exec(ctx, tt.use); err != nil {
					t.Fatal(err)
				}
			}
			count := func(sql string) (n int) {
				t.Helper()
				if err := pool.QueryRow(ctx, sql).Scan(&n); err != nil {
					t.Fatal(err)
				}
				return n
			}
			offers := func() int { return count(`SELECT count(*) FROM offer_versions WHERE id = '` + proTrialOffer + `'`) }
			plans := func() int { return count(`SELECT count(*) FROM limit_plans WHERE offer_id = '` + proTrialOffer + `'`) }
			plansBefore := plans()
			if offers() != 1 || plansBefore == 0 {
				t.Fatalf("offer %d, plans %d before rollback", offers(), plansBefore)
			}

			_, err := p.DownTo(ctx, 14)
			if tt.use == "" {
				if err != nil {
					t.Fatalf("unused rollback: %v", err)
				}
				if offers() != 0 || plans() != 0 {
					t.Fatalf("unused offer left behind: %d offers, %d plans", offers(), plans())
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), "still referenced by "+tt.table) {
				t.Fatalf("rollback of a used offer: %v", err)
			}
			if offers() != 1 || plans() != plansBefore {
				t.Fatalf("refused rollback changed the offer: %d offers, %d plans (was %d)", offers(), plans(), plansBefore)
			}
			if n := count(`SELECT count(*) FROM ` + tt.table + ` WHERE offer_id = '` + proTrialOffer + `'`); n != 1 {
				t.Fatalf("%s rows on the offer: %d, want 1", tt.table, n)
			}
			if v, err := p.GetDBVersion(ctx); err != nil || v != 15 {
				t.Fatalf("version %d, %v: want 15", v, err)
			}
		})
	}
}
