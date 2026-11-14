package store_test

import (
	"context"
	"slices"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestJobTargets(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	if ids, err := s.LiveWorkspaces(ctx); err != nil || len(ids) != 0 {
		t.Fatalf("%v %v", ids, err)
	}
	auto := newEngagement("eng_auto", "cli_a")
	auto.AutoInvoice = true
	for ws, e := range map[string]*store.Engagement{"wsp_a": auto, "wsp_b": newEngagement("eng_plain", "cli_b")} {
		if err := s.CreateEngagement(ctx, ws, e, t0); err != nil {
			t.Fatal(err)
		}
	}
	ids, err := s.LiveWorkspaces(ctx)
	if err != nil || !slices.Equal(ids, []store.Workspace{{ID: "wsp_a", Timezone: "UTC"}, {ID: "wsp_b", Timezone: "UTC"}}) {
		t.Fatalf("%v %v", ids, err)
	}
	targets, err := s.AutoInvoiceTargets(ctx)
	if err != nil || len(targets) != 1 || targets[0] != (store.AutoInvoiceTarget{WorkspaceID: "wsp_a", Timezone: "UTC", EngagementID: "eng_auto"}) {
		t.Fatalf("%v %v", targets, err)
	}
}

func TestAddNoticeOncePerKindAndInvoice(t *testing.T) {
	s, pool := seedEngagementWorkspace(t)
	ctx := context.Background()
	seedEngPeriod(t, s, "wsp_a", "cli_a", "eng_1")
	for _, id := range []string{"inv_1", "inv_2"} {
		if _, err := pool.Exec(ctx, `INSERT INTO invoices (id, workspace_id, kind, status, client_id, issue_date, due_date,
			currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
			vat_breakdown, created_at, updated_at) VALUES ($1, 'wsp_a', 'invoice', 'draft', 'cli_a', '2026-02-01', '2026-03-01', 'CHF',
			'en', 'exclusive', 0, 0, 0, 0, 0, 0, 0, '[]', now(), now())`, id); err != nil {
			t.Fatal(err)
		}
	}
	inv := func(id string) *string { return &id }
	cases := []struct {
		kind    string
		invoice *string
		want    bool
	}{
		{"ending_soon", nil, true}, {"ending_soon", nil, false},
		{"draft_created", inv("inv_1"), true}, {"draft_created", inv("inv_1"), false},
		{"draft_created", inv("inv_2"), true},
	}
	for i, c := range cases {
		got, err := s.AddNotice(ctx, store.EngagementNotice{ID: "ntc_" + string(rune('a'+i)), EngagementID: "eng_1",
			PeriodID: "per_eng_1", Kind: c.kind, InvoiceID: c.invoice, CreatedAt: t0})
		if err != nil || got != c.want {
			t.Fatalf("case %d: %v %v", i, got, err)
		}
	}
}
