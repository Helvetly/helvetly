package engagements

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

type periodJSON struct {
	ID         string `json:"id"`
	Quantity   string `json:"quantity"`
	Full       string `json:"full_quantity"`
	Unearned   string `json:"unearned"`
	CarriedIn  string `json:"carried_in"`
	Available  string `json:"available"`
	Remaining  string `json:"remaining"`
	Overage    string `json:"overage"`
	Natural    string `json:"natural_ends_on"`
	EndsOn     string `json:"ends_on"`
	Used       string `json:"used"`
	Uninvoiced string `json:"uninvoiced_quantity"`
}

func (e *env) periodList(b *browser, id string) []periodJSON {
	e.t.Helper()
	var out struct {
		Data []periodJSON `json:"data"`
	}
	e.do(b, "GET", "/api/v1/engagements/"+id+"/periods", nil, 200, &out)
	return out.Data
}

func TestRolloverOnlyAdvanceRecurring422(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cli := e.client(b)
	e.fails(b, "POST", "/api/v1/engagements", input(cli, map[string]any{"rollover": true, "recurrence": "none", "end_date": "2026-12-31"}), 422, "validation_failed", "rollover")
	e.fails(b, "POST", "/api/v1/engagements", input(cli, map[string]any{"rollover": true, "billing": "arrears"}), 422, "validation_failed", "rollover")
	e.fails(b, "POST", "/api/v1/engagements", input(cli, map[string]any{"rollover": "yes"}), 422, "validation_failed", "rollover")
	e.fails(b, "POST", "/api/v1/engagements", input(cli, map[string]any{"invoice_detail": "x"}), 422, "validation_failed", "invoice_detail")
	v := e.create(b, input(cli, map[string]any{"rollover": true}))
	e.fails(b, "PATCH", "/api/v1/engagements/"+v.ID, map[string]any{"billing": "arrears"}, 422, "validation_failed", "rollover")
}

func TestViewCarriedInAvailable(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"rollover": true, "start_date": "2026-09-01"}))
	e.entry(v.ID, "2026-09-10", 10000)
	ps := e.periodList(b, v.ID)
	if len(ps) != 3 || ps[0].CarriedIn != "30" || ps[0].Available != "60" || ps[0].Remaining != "60" ||
		ps[1].CarriedIn != "20" || ps[2].CarriedIn != "0" {
		t.Fatalf("%+v", ps)
	}
}

func TestOverageUsesAvailable(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), map[string]any{"rollover": true, "quantity": "8", "start_date": "2026-10-01"}))
	e.entry(v.ID, "2026-10-05", 5000)
	e.entry(v.ID, "2026-11-10", 12000)
	cur := e.periodList(b, v.ID)[0]
	if cur.CarriedIn != "3" || cur.Available != "11" || cur.Overage != "1" || cur.Remaining != "0" || cur.Uninvoiced != "1" {
		t.Fatalf("%+v", cur)
	}
}

func TestCutProratesAndRestores(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), nil))
	path := "/api/v1/engagements/" + v.ID
	e.do(b, "POST", path+"/cancel", map[string]any{"cancelled_on": "2026-11-20"}, 200, nil)
	if rows := e.periodRows(v.ID); strings.Join(rows, ",") != "1:20000" {
		t.Fatal(rows)
	}
	p := e.periodList(b, v.ID)[0]
	if p.Quantity != "20" || p.Full != "30" || p.Natural != "2026-11-30" || p.EndsOn != "2026-11-20" || p.Unearned != "0" {
		t.Fatalf("%+v", p)
	}
	e.do(b, "POST", path+"/resume", nil, 200, nil)
	if rows := e.periodRows(v.ID); strings.Join(rows, ",") != "1:30000" {
		t.Fatal(rows)
	}
}

func TestCutWithAdvanceInvoiceKeepsQuantityShowsUnearned(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), nil))
	path := "/api/v1/engagements/" + v.ID
	e.invoice(b, v.ID, e.periodList(b, v.ID)[0].ID, "draft")
	e.do(b, "POST", path+"/cancel", map[string]any{"cancelled_on": "2026-11-20"}, 200, nil)
	p := e.periodList(b, v.ID)[0]
	if p.Quantity != "30" || p.Unearned != "10" {
		t.Fatalf("%+v", p)
	}
}

func TestManualQuantityNotProrated(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	v := e.create(b, input(e.client(b), nil))
	path := "/api/v1/engagements/" + v.ID
	e.do(b, "PATCH", path+"/periods/"+e.periodList(b, v.ID)[0].ID, map[string]any{"quantity": "12"}, 200, nil)
	e.do(b, "POST", path+"/cancel", map[string]any{"cancelled_on": "2026-11-20"}, 200, nil)
	if rows := e.periodRows(v.ID); strings.Join(rows, ",") != "1:12000" {
		t.Fatal(rows)
	}
}

// fakeDrafts records the lines and stores a bare invoice so the period can link to it.
type fakeDrafts struct {
	e     *env
	lines []store.InvoiceLine
}

func (f *fakeDrafts) CreateDraft(ctx context.Context, _ store.Q, sess store.Session, clientID string, fill func(*store.Invoice)) (string, error) {
	inv := store.Invoice{VATMode: "exclusive"}
	fill(&inv)
	f.lines = inv.Lines
	id := auth.NewID("inv")
	_, err := f.e.pool.Exec(ctx, `INSERT INTO invoices (id, workspace_id, kind, status, client_id, issue_date, due_date,
		currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
		vat_breakdown, created_at, updated_at) VALUES ($1, $2, 'invoice', 'draft', $3, '2026-02-01', '2026-03-01', 'CHF',
		'en', 'exclusive', 0, 0, 0, 0, 0, 0, 0, '[]', now(), now())`, id, sess.Workspace.ID, clientID)
	return id, err
}

func TestInvoiceDetailDefault(t *testing.T) {
	for detail, want := range map[string]int{"summary": 1, "per_entry": 2} {
		t.Run(detail, func(t *testing.T) {
			e := newEnv(t)
			f := &fakeDrafts{e: e}
			e.svc.inv = f
			b := e.workspace()
			v := e.create(b, input(e.client(b), map[string]any{"billing": "arrears", "start_date": "2026-10-01", "invoice_detail": detail}))
			e.entry(v.ID, "2026-10-05", 1000)
			e.entry(v.ID, "2026-10-06", 2000)
			ps := e.periodList(b, v.ID)
			e.do(b, "POST", "/api/v1/engagements/"+v.ID+"/periods/"+ps[1].ID+"/invoice", map[string]any{"kind": "usage"}, http.StatusCreated, nil)
			if len(f.lines) != want {
				t.Fatalf("%d lines: %+v", len(f.lines), f.lines)
			}
		})
	}
}

// Seller satisfies Invoices; the tests using fakeDrafts never render a report.
func (f *fakeDrafts) Seller(context.Context, store.Q, string) (store.Party, []byte, string, error) {
	return store.Party{}, nil, "en", nil
}

func TestDescriptionLimit(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cli := e.client(b)
	at, over := strings.Repeat("é", descriptionMax), strings.Repeat("a", descriptionMax+1)
	e.fails(b, "POST", "/api/v1/engagements", input(cli, map[string]any{"description": over}), 422, "validation_failed", "description")
	v := e.create(b, input(cli, map[string]any{"description": at}))

	// One saved before the limit: it loads and saves unchanged, any change has to fit the limit.
	legacy := strings.Repeat("b", 1500)
	if _, err := e.pool.Exec(context.Background(), `UPDATE engagements SET description = $1 WHERE id = $2`, legacy, v.ID); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, description string
		status            int
	}{
		{"unchanged", legacy, 200},
		{"unchanged with outer spaces", " " + legacy + "\n", 200},
		{"changed and still long", legacy + "c", 422},
		{"shortened but above the limit", legacy[:1200], 422},
		{"shortened to the limit", legacy[:descriptionMax], 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.status == 200 {
				e.do(b, "PATCH", "/api/v1/engagements/"+v.ID, map[string]any{"description": tc.description, "title": "Renamed"}, 200, nil)
				return
			}
			e.fails(b, "PATCH", "/api/v1/engagements/"+v.ID, map[string]any{"description": tc.description}, 422, "validation_failed", "description")
		})
	}
	var got string
	if err := e.pool.QueryRow(context.Background(), `SELECT description FROM engagements WHERE id = $1`, v.ID).Scan(&got); err != nil || got != legacy[:descriptionMax] {
		t.Fatalf("description %d chars, %v", len(got), err)
	}
}
