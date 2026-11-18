package engagements

import (
	"context"
	"testing"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// seedInvoice stores a bare invoice and returns its id; service may be "".
func (e *env) seedInvoice(ws, clientID, status, issue, service string) string {
	e.t.Helper()
	id := auth.NewID("inv")
	_, err := e.pool.Exec(context.Background(), `INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, service_date, due_date,
		currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
		vat_breakdown, created_at, updated_at) VALUES ($1, $2, 'invoice', $3, CASE WHEN $3 = 'draft' THEN NULL ELSE $1 END, $4, $5, nullif($6, '')::date, '2027-01-01', 'CHF',
		'en', 'exclusive', 0, 0, 0, 0, 0, 0, 0, '[]', now(), now())`, id, ws, status, clientID, issue, service)
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func TestLinkInvoice(t *testing.T) {
	e := newEnv(t)
	realDrafts(e)
	b, other := e.workspace(), e.workspace()
	cli := e.client(b)
	adv := e.create(b, input(cli, map[string]any{"billing": "advance"}))
	use := e.create(b, input(cli, map[string]any{"billing": "arrears"}))
	link := func(eng view) string { return "/api/v1/engagements/" + eng.ID + "/invoices" }
	linkKind := func(id string) string {
		var k string
		if err := e.pool.QueryRow(context.Background(), `SELECT kind FROM engagement_invoices WHERE invoice_id = $1`, id).Scan(&k); err != nil {
			t.Fatal(err)
		}
		return k
	}

	first := e.seedInvoice(b.workspace, cli, "open", "2026-12-20", "2026-11-05") // service date wins over the issue date
	e.do(b, "POST", link(adv), map[string]any{"invoice_id": first}, 201, nil)
	if k := linkKind(first); k != "advance" {
		t.Fatalf("kind %s", k)
	}
	byIssue := e.seedInvoice(b.workspace, cli, "open", "2026-11-20", "")
	e.do(b, "POST", link(adv), map[string]any{"invoice_id": byIssue}, 201, nil)
	if k := linkKind(byIssue); k != "usage" { // the period already has its advance invoice
		t.Fatalf("second kind %s", k)
	}
	arrears := e.seedInvoice(b.workspace, cli, "draft", "2026-11-20", "")
	e.do(b, "POST", link(use), map[string]any{"invoice_id": arrears}, 201, nil)
	if k := linkKind(arrears); k != "usage" {
		t.Fatalf("arrears kind %s", k)
	}

	// duplicate-advance prevention: the period now counts as invoiced
	e.fails(b, "POST", "/api/v1/engagements/"+adv.ID+"/periods/"+adv.CurrentPeriod.ID+"/invoice", map[string]any{"kind": "advance"}, 409, "already_invoiced")

	e.fails(b, "POST", link(adv), map[string]any{"invoice_id": first}, 409, "invoice_linked")
	e.fails(b, "POST", link(adv), map[string]any{"invoice_id": first, "x": 1}, 400, "invalid_request")
	for name, id := range map[string]string{
		"other client":    e.seedInvoice(b.workspace, e.client(b), "open", "2026-11-20", ""),
		"void":            e.seedInvoice(b.workspace, cli, "void", "2026-11-20", ""),
		"outside periods": e.seedInvoice(b.workspace, cli, "open", "2020-01-01", ""),
		"other workspace": e.seedInvoice(other.workspace, e.client(other), "open", "2026-11-20", ""),
		"unknown":         "inv_nope",
	} {
		t.Run(name, func(t *testing.T) {
			e.fails(b, "POST", link(adv), map[string]any{"invoice_id": id}, 422, "validation_failed", "invoice_id")
		})
	}

	// unlinking: a manual link goes, an invoice made from entries stays
	e.do(b, "DELETE", link(adv)+"/"+byIssue, nil, 204, nil)
	e.fails(b, "DELETE", link(adv)+"/"+byIssue, nil, 404, "not_found")
	e.entry(use.ID, "2026-11-02", 1000)
	var inv invoiceOut
	e.do(b, "POST", "/api/v1/engagements/"+use.ID+"/periods/"+use.CurrentPeriod.ID+"/invoice", map[string]any{"kind": "usage"}, 201, &inv)
	e.fails(b, "DELETE", link(use)+"/"+inv.Data.InvoiceID, nil, 409, "invoice_covers_entries")

	var got struct {
		Data *struct{ ID, Title string } `json:"data"`
	}
	e.do(b, "GET", "/api/v1/invoices/"+first+"/engagement", nil, 200, &got)
	if got.Data == nil || got.Data.ID != adv.ID {
		t.Fatalf("engagement of invoice %+v", got.Data)
	}
	e.do(b, "GET", "/api/v1/invoices/"+byIssue+"/engagement", nil, 200, &got)
	if got.Data != nil {
		t.Fatalf("unlinked invoice has %+v", got.Data)
	}
	e.fails(b, "GET", "/api/v1/invoices/inv_unknown/engagement", nil, 404, "not_found")

	// the list filter the pickers use leaves out what belongs to an engagement
	list, _, err := e.st.ListInvoices(context.Background(), b.workspace, "2026-11-16", store.InvoiceFilter{ClientID: cli, Unlinked: true}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range list {
		if it.ID == first || it.ID == arrears {
			t.Fatalf("linked invoice %s listed as unlinked", it.ID)
		}
	}
	if len(list) == 0 {
		t.Fatal("unlinked list is empty")
	}
}
