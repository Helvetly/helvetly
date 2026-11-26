package store_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

func seedEngagementWorkspace(t *testing.T) (*store.Store, *pgxpool.Pool) {
	t.Helper()
	s, pool := storetest.New(t)
	ctx := context.Background()
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_a", Name: "Acme"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_b", Name: "Other"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	for ws, id := range map[string]string{"wsp_a": "cli_a", "wsp_b": "cli_b"} {
		if err := s.CreateClient(ctx, ws, id, map[string]any{"name": "Client " + id}, t0); err != nil {
			t.Fatal(err)
		}
	}
	return s, pool
}

func newEngagement(id, clientID string) *store.Engagement {
	return &store.Engagement{ID: id, ClientID: clientID, Title: "German", Quantity: 30500, Billing: "advance", PriceBasis: "net",
		UnitPrice: 12050, Currency: "CHF", VATCategory: "S", VATRate: 810, StartDate: "2026-01-31", Recurrence: "monthly", Interval: 1}
}

func TestEngagementNumbersNeverReused(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	for i, id := range []string{"eng_1", "eng_2"} {
		e := newEngagement(id, "cli_a")
		if err := s.CreateEngagement(ctx, "wsp_a", e, t0); err != nil || e.Number != int64(i+1) {
			t.Fatalf("%s: number %d err %v", id, e.Number, err)
		}
	}
	if err := s.DeleteEngagement(ctx, "wsp_a", "eng_2", t0); err != nil {
		t.Fatal(err)
	}
	e := newEngagement("eng_3", "cli_a")
	if err := s.CreateEngagement(ctx, "wsp_a", e, t0); err != nil || e.Number != 3 {
		t.Fatalf("number %d err %v", e.Number, err)
	}
	other := newEngagement("eng_b", "cli_b")
	if err := s.CreateEngagement(ctx, "wsp_b", other, t0); err != nil || other.Number != 1 {
		t.Fatalf("other workspace number %d err %v", other.Number, err)
	}
	got, err := s.Engagement(ctx, "wsp_a", "eng_1", false)
	if err != nil || got.Quantity != 30500 || got.UnitPrice != 12050 || got.StartDate != "2026-01-31" || got.Client.Name != "Client cli_a" ||
		got.OverageUnitPrice != nil {
		t.Fatalf("got %+v err %v", got, err)
	}
}

func TestEngagementOtherWorkspace404(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	if err := s.CreateEngagement(ctx, "wsp_a", newEngagement("eng_1", "cli_a"), t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Engagement(ctx, "wsp_b", "eng_1", false); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("read: %v", err)
	}
	if err := s.SaveEngagement(ctx, "wsp_b", *newEngagement("eng_1", "cli_a"), t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("save: %v", err)
	}
	if err := s.DeleteEngagement(ctx, "wsp_b", "eng_1", t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("delete: %v", err)
	}
	if list, err := s.ListEngagements(ctx, "wsp_b", store.EngagementFilter{}); err != nil || len(list) != 0 {
		t.Fatalf("list: %v %v", list, err)
	}
	if err := s.DeleteEngagement(ctx, "wsp_a", "eng_1", t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Engagement(ctx, "wsp_a", "eng_1", false); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("deleted still readable: %v", err)
	}
}

func TestEngagementListFilters(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	mk := func(id, start string, end, cancelled *string) {
		e := newEngagement(id, "cli_a")
		e.Title, e.StartDate, e.EndDate, e.CancelledOn = id, start, end, cancelled
		if err := s.CreateEngagement(ctx, "wsp_a", e, t0); err != nil {
			t.Fatal(err)
		}
	}
	str := func(v string) *string { return &v }
	mk("eng_future", "2026-12-01", nil, nil)
	mk("eng_run", "2026-01-01", nil, nil)
	mk("eng_ended", "2026-01-01", str("2026-02-01"), nil)
	mk("eng_cancel", "2026-01-01", nil, str("2026-03-01"))
	for status, want := range map[string]string{"scheduled": "eng_future", "active": "eng_run", "ended": "eng_ended", "cancelled": "eng_cancel"} {
		list, err := s.ListEngagements(ctx, "wsp_a", store.EngagementFilter{Statuses: []string{status}, Today: "2026-11-07"})
		if err != nil || len(list) != 1 || list[0].ID != want {
			t.Fatalf("%s: %v %v", status, list, err)
		}
	}
	if list, _ := s.ListEngagements(ctx, "wsp_a", store.EngagementFilter{Q: "RUN"}); len(list) != 1 {
		t.Fatalf("search: %v", list)
	}
}

func TestInsertPeriodIdempotent(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	ctx := context.Background()
	if err := s.CreateEngagement(ctx, "wsp_a", newEngagement("eng_1", "cli_a"), t0); err != nil {
		t.Fatal(err)
	}
	p := store.EngagementPeriod{ID: "epr_1", EngagementID: "eng_1", Index: 1, StartsOn: "2026-01-31", EndsOn: "2026-02-27", Quantity: 8000,
		UnitPrice: 12050, OverageUnitPrice: 15000}
	for i, want := range []bool{true, false} {
		p.ID = "epr_" + string(rune('1'+i))
		if ok, err := s.InsertPeriod(ctx, p); err != nil || ok != want {
			t.Fatalf("insert %d: %v %v", i, ok, err)
		}
	}
	list, err := s.EngagementPeriods(ctx, "eng_1")
	if err != nil || len(list) != 1 || list[0].ID != "epr_1" || list[0].EndsOn != "2026-02-27" {
		t.Fatalf("%+v %v", list, err)
	}
	if err := s.SetPeriodQuantity(ctx, "epr_1", 9500); err != nil {
		t.Fatal(err)
	}
	if list, _ = s.EngagementPeriods(ctx, "eng_1"); list[0].Quantity != 9500 {
		t.Fatalf("quantity %d", list[0].Quantity)
	}
}

func insertInvoice(t *testing.T, pool *pgxpool.Pool, id, status string) {
	t.Helper()
	number := "NULL"
	if status != "draft" {
		number = "'" + id + "'"
	}
	_, err := pool.Exec(context.Background(), `INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date,
		currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
		vat_breakdown, created_at, updated_at) VALUES ($1, 'wsp_a', 'invoice', $2, `+number+`, 'cli_a', '2026-02-01', '2026-03-01', 'CHF',
		'en', 'exclusive', 0, 0, 0, 0, 0, 0, 0, '[]', now(), now())`, id, status)
	if err != nil {
		t.Fatal(err)
	}
}

func seedPeriod(t *testing.T, s *store.Store) {
	t.Helper()
	ctx := context.Background()
	if err := s.CreateEngagement(ctx, "wsp_a", newEngagement("eng_1", "cli_a"), t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InsertPeriod(ctx, store.EngagementPeriod{ID: "epr_1", EngagementID: "eng_1", Index: 1, StartsOn: "2026-01-31",
		EndsOn: "2026-02-27", Quantity: 8000, UnitPrice: 12050, OverageUnitPrice: 12050}); err != nil {
		t.Fatal(err)
	}
}

func TestPeriodUsedExcludesNothingButSumsEntries(t *testing.T) {
	s, pool := seedEngagementWorkspace(t)
	seedPeriod(t, s)
	ctx := context.Background()
	if list, _ := s.EngagementPeriods(ctx, "eng_1"); list[0].Used != 0 || list[0].InvoicedQuantity != 0 || list[0].AdvanceInvoice != nil {
		t.Fatalf("empty period: %+v", list[0])
	}
	for id, q := range map[string]invoicecalc.Quantity{"ent_1": 1500, "ent_2": 2250} {
		if _, err := pool.Exec(ctx, `INSERT INTO engagement_entries (id, engagement_id, period_id, date, quantity, created_at)
			VALUES ($1, 'eng_1', 'epr_1', '2026-02-01', $2, now())`, id, q); err != nil {
			t.Fatal(err)
		}
	}
	if list, _ := s.EngagementPeriods(ctx, "eng_1"); list[0].Used != 3750 {
		t.Fatalf("used %d", list[0].Used)
	}
}

func TestInvoicedQuantityIgnoresVoid(t *testing.T) {
	s, pool := seedEngagementWorkspace(t)
	seedPeriod(t, s)
	ctx := context.Background()
	insertInvoice(t, pool, "inv_open", "open")
	insertInvoice(t, pool, "inv_void", "void")
	insertInvoice(t, pool, "inv_adv", "draft")
	for id, inv := range map[string]string{"ent_1": "inv_open", "ent_2": "inv_void", "ent_3": ""} {
		if _, err := pool.Exec(ctx, `INSERT INTO engagement_entries (id, engagement_id, period_id, date, quantity, created_at)
			VALUES ($1, 'eng_1', 'epr_1', '2026-02-01', 1000, now())`, id); err != nil {
			t.Fatal(err)
		}
		if inv != "" {
			if err := s.LinkEntries(ctx, []string{id}, []invoicecalc.Quantity{1000}, inv); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO engagement_invoices (period_id, invoice_id, kind, created_at) VALUES
		('epr_1', 'inv_adv', 'advance', now()), ('epr_1', 'inv_void', 'advance', now() - interval '1 day')`); err != nil {
		t.Fatal(err)
	}
	p, _ := s.EngagementPeriods(ctx, "eng_1")
	if p[0].Used != 3000 || p[0].InvoicedQuantity != 1000 {
		t.Fatalf("used %d invoiced %d", p[0].Used, p[0].InvoicedQuantity)
	}
	if a := p[0].AdvanceInvoice; a == nil || a.ID != "inv_adv" || a.Status != "draft" || a.Number != nil || a.Kind != "advance" {
		t.Fatalf("advance %+v", a)
	}
}

func TestSetPeriodPrices(t *testing.T) {
	s, _ := seedEngagementWorkspace(t)
	seedPeriod(t, s)
	ctx := context.Background()
	if err := s.SetPeriodPrices(ctx, "epr_1", 13000, 14000); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.EngagementPeriods(ctx, "eng_1"); list[0].UnitPrice != 13000 || list[0].OverageUnitPrice != 14000 {
		t.Fatalf("%+v", list[0])
	}
	if err := s.SetPeriodPrices(ctx, "epr_nope", 1, 1); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("err %v", err)
	}
}

func TestCutAndDeletePeriods(t *testing.T) {
	s, pool := seedEngagementWorkspace(t)
	seedPeriod(t, s) // epr_1: 31 Jan .. 27 Feb
	ctx := context.Background()
	for i, from := range []string{"2026-02-28", "2026-03-28", "2026-04-28"} {
		p := store.EngagementPeriod{ID: "epr_" + string(rune('2'+i)), EngagementID: "eng_1", Index: i + 2, StartsOn: from, EndsOn: from,
			Quantity: 8000, UnitPrice: 12050, OverageUnitPrice: 12050}
		if _, err := s.InsertPeriod(ctx, p); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO engagement_entries (id, engagement_id, period_id, date, quantity, created_at)
		VALUES ('ent_1', 'eng_1', 'epr_3', '2026-03-30', 100, now())`); err != nil {
		t.Fatal(err)
	}
	if err := s.CutPeriods(ctx, "eng_1", "2026-02-28"); err != nil { // epr_3 keeps its entry, epr_4 goes, epr_2 starts on the day
		t.Fatal(err)
	}
	var ids string
	if err := pool.QueryRow(ctx, `SELECT string_agg(id || ':' || ends_on, ',' ORDER BY idx) FROM engagement_periods`).Scan(&ids); err != nil ||
		ids != "epr_1:2026-02-27,epr_2:2026-02-28,epr_3:2026-03-28" {
		t.Fatalf("%q %v", ids, err)
	}
	if err := s.DeletePeriods(ctx, "eng_1"); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.EngagementPeriods(ctx, "eng_1"); len(list) != 0 {
		t.Fatalf("%+v", list)
	}
}
