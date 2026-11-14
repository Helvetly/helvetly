package store

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var typesNow = time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)

// typesDB: a migrated schema (up to version `upTo`, 0 = all) with workspace wsp_a and client cli_1.
func typesDB(t *testing.T, upTo int64) (Q, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	p, pool := migrationProvider(t)
	var err error
	if upTo > 0 {
		_, err = p.UpTo(ctx, upTo)
	} else {
		_, err = p.Up(ctx)
	}
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_a', 'A', 'UTC', now())`,
		`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at) VALUES ('cli_1', 'wsp_a', 1, 'One', now(), now())`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	return Q{db: pool}, pool
}

// seedInvoice inserts a document of the given kind and status with payable total `total` (VAT 810 per 10000 of it, for the breakdown).
func seedInvoice(t *testing.T, pool *pgxpool.Pool, id, kind, status string, total int64, due string, prepaid int64) {
	t.Helper()
	number := "NULL"
	if status != "draft" {
		number = "'" + id + "'"
	}
	col, arg := "", ""
	if prepaid != 0 {
		col, arg = ", prepaid_total", ", $6"
	}
	args := []any{id, kind, status, due, total}
	if prepaid != 0 {
		args = append(args, prepaid)
	}
	_, err := pool.Exec(context.Background(), fmt.Sprintf(`INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date,
		due_date, currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
		vat_breakdown, created_at, updated_at%[1]s)
		VALUES ($1, 'wsp_a', $2, $3, %[2]s, 'cli_1', '2026-10-01', $4, 'CHF', 'de', 'exclusive', 0, $5, 0, $5, 0, $5, 0,
		'[{"category":"S","rate":"8.1","taxable_amount":"10.00","vat_amount":"0.81"}]', now(), now()%[3]s)`, col, number, arg), args...)
	if err != nil {
		t.Fatal(err)
	}
}

// seedPayment: no created_by, as for a payment whose author is gone.
func seedPayment(pool *pgxpool.Pool, id, invoiceID string, amount int64) error {
	_, err := pool.Exec(context.Background(), `INSERT INTO invoice_payments (id, invoice_id, amount, paid_on, method, created_at)
		VALUES ($1, $2, $3, '2026-10-05', 'cash', now())`, id, invoiceID, amount)
	return err
}

func TestMigrationKeepsExistingRows(t *testing.T) {
	ctx := context.Background()
	p, pool := migrationProvider(t)
	if _, err := p.UpTo(ctx, 20); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_a', 'A', 'UTC', now())`,
		`INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at) VALUES ('cli_1', 'wsp_a', 1, 'One', now(), now())`,
		`INSERT INTO invoice_counters (workspace_id, kind, year, seq) VALUES ('wsp_a', 'invoice', 2026, 4)`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	seedInvoice(t, pool, "inv_1", "invoice", "open", 1000, "2026-10-31", 0)
	if _, err := p.UpTo(ctx, 21); err != nil {
		t.Fatal(err)
	}
	var kind, status string
	var prepaid int64
	var deducted *string
	if err := pool.QueryRow(ctx, `SELECT kind, status, prepaid_total, deducted_on_invoice_id FROM invoices WHERE id = 'inv_1'`).
		Scan(&kind, &status, &prepaid, &deducted); err != nil || kind != "invoice" || status != "open" || prepaid != 0 || deducted != nil {
		t.Fatalf("row = %s %s %d %v, %v", kind, status, prepaid, deducted, err)
	}
	if seq, err := (Q{db: pool}).PeekInvoiceSeq(ctx, "wsp_a", "invoice", 2026); err != nil || seq != 5 {
		t.Fatalf("counter next = %d, %v; want 5", seq, err)
	}
	for _, k := range []string{"partial", "prepayment", "debit_note", "corrected", "proforma", "self_billed"} {
		seedInvoice(t, pool, "inv_"+k, k, "open", 1, "2026-10-31", 0)
	}
	for _, series := range []string{"credit_note", "proforma", "self_billed"} {
		if _, err := (Q{db: pool}).NextInvoiceSeq(ctx, "wsp_a", series, 2026); err != nil {
			t.Fatalf("series %s: %v", series, err)
		}
	}
	if _, err := (Q{db: pool}).NextInvoiceSeq(ctx, "wsp_a", "partial", 2026); err == nil {
		t.Fatal("partial is not a series")
	}
}

func TestPrepaymentsRoundTrip(t *testing.T) {
	q, pool := typesDB(t, 0)
	ctx := context.Background()
	seedInvoice(t, pool, "pre_1", "prepayment", "paid", 300, "2026-10-31", 0)
	seedInvoice(t, pool, "pre_2", "prepayment", "paid", 200, "2026-10-31", 0)
	seedInvoice(t, pool, "fin", "invoice", "draft", 1000, "2026-10-31", 0)
	if err := q.SetPrepayments(ctx, "fin", []string{"pre_2", "pre_1"}); err != nil {
		t.Fatal(err)
	}
	got, err := q.Invoice(ctx, "wsp_a", "fin", "2026-11-07", false)
	if err != nil || len(got.Prepayments) != 2 || got.Prepayments[0].ID != "pre_2" || got.Prepayments[1].ID != "pre_1" {
		t.Fatalf("prepayments = %+v, %v", got.Prepayments, err)
	}
	p := got.Prepayments[0]
	if p.PayableTotal != 200 || p.Status != "paid" || p.Number == nil || *p.Number != "pre_2" ||
		len(p.VATBreakdown) != 1 || p.VATBreakdown[0].Rate != 810 {
		t.Fatalf("ref = %+v", p)
	}
	if err := q.SetPrepayments(ctx, "fin", []string{"pre_1"}); err != nil {
		t.Fatal(err)
	}
	got, _ = q.Invoice(ctx, "wsp_a", "fin", "2026-11-07", false)
	if len(got.Prepayments) != 1 || got.Prepayments[0].ID != "pre_1" {
		t.Fatalf("after replace = %+v", got.Prepayments)
	}
	none, _ := q.Invoice(ctx, "wsp_a", "pre_1", "2026-11-07", false)
	if none.Prepayments == nil || len(none.Prepayments) != 0 {
		t.Fatalf("no prepayments must be an empty list, got %#v", none.Prepayments)
	}
}

func TestMarkDeductedOnce(t *testing.T) {
	q, pool := typesDB(t, 0)
	ctx := context.Background()
	seedInvoice(t, pool, "pre_1", "prepayment", "paid", 300, "2026-10-31", 0)
	seedInvoice(t, pool, "pre_2", "prepayment", "paid", 200, "2026-10-31", 0)
	seedInvoice(t, pool, "fin", "invoice", "open", 1000, "2026-10-31", 0)
	if err := q.MarkDeducted(ctx, "wsp_a", []string{"pre_1"}, "fin"); err != nil {
		t.Fatal(err)
	}
	if err := q.MarkDeducted(ctx, "wsp_a", []string{"pre_1"}, "fin"); !errors.Is(err, ErrNotDeductible) {
		t.Fatalf("second deduction = %v, want ErrNotDeductible", err)
	}
	if err := q.MarkDeducted(ctx, "wsp_a", []string{"pre_2", "fin"}, "fin"); !errors.Is(err, ErrNotDeductible) {
		t.Fatalf("non-prepayment = %v, want ErrNotDeductible", err)
	}
	got, _ := q.Invoice(ctx, "wsp_a", "pre_1", "2026-11-07", false)
	if got.DeductedOn == nil || got.DeductedOn.ID != "fin" || got.DeductedOn.Number != "fin" {
		t.Fatalf("deducted_on = %+v", got.DeductedOn)
	}
}

func TestMovePaymentsRefreshesBoth(t *testing.T) {
	q, pool := typesDB(t, 0)
	ctx := context.Background()
	seedInvoice(t, pool, "old", "invoice", "open", 1000, "2026-10-31", 0)
	seedInvoice(t, pool, "new", "corrected", "open", 1000, "2026-10-31", 0)
	for i, amt := range []int64{400, 600} {
		if err := seedPayment(pool, fmt.Sprint("pay_", i), "old", amt); err != nil {
			t.Fatal(err)
		}
	}
	if err := q.RefreshBalance(ctx, "old", typesNow); err != nil {
		t.Fatal(err)
	}
	if err := q.MovePayments(ctx, "wsp_a", "old", "new"); err != nil {
		t.Fatal(err)
	}
	if err := q.MarkReplaced(ctx, "wsp_a", "old", typesNow); err != nil {
		t.Fatal(err)
	}
	oldInv, _ := q.Invoice(ctx, "wsp_a", "old", "2026-11-07", false)
	newInv, _ := q.Invoice(ctx, "wsp_a", "new", "2026-11-07", false)
	if oldInv.Status != "replaced" || oldInv.AmountPaid != 0 || len(oldInv.Payments) != 0 || oldInv.AmountDue != 0 {
		t.Fatalf("old = %s paid %d payments %d due %d", oldInv.Status, oldInv.AmountPaid, len(oldInv.Payments), oldInv.AmountDue)
	}
	if newInv.Status != "paid" || newInv.AmountPaid != 1000 || len(newInv.Payments) != 2 {
		t.Fatalf("new = %s paid %d payments %d", newInv.Status, newInv.AmountPaid, len(newInv.Payments))
	}
	// A replaced original keeps its status through a later refresh; an unissued one cannot be replaced.
	if err := q.RefreshBalance(ctx, "old", typesNow); err != nil {
		t.Fatal(err)
	}
	if got, _ := q.Invoice(ctx, "wsp_a", "old", "2026-11-07", false); got.Status != "replaced" {
		t.Fatalf("status after refresh = %s", got.Status)
	}
	seedInvoice(t, pool, "dr", "invoice", "draft", 1, "2026-10-31", 0)
	if err := q.MarkReplaced(ctx, "wsp_a", "dr", typesNow); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("replace draft = %v", err)
	}
}

// A final invoice stores its totals after the deduction, so prepaid_total is not subtracted again.
func TestAmountDueIncludesPrepaid(t *testing.T) {
	q, pool := typesDB(t, 0)
	ctx := context.Background()
	seedInvoice(t, pool, "fin", "invoice", "open", 432400, "2026-12-31", 108100) // 5'405.00 − prepaid 1'081.00
	got, _ := q.Invoice(ctx, "wsp_a", "fin", "2026-11-07", false)
	if got.PrepaidTotal != 108100 || got.AmountDue != 432400 {
		t.Fatalf("prepaid %d due %d, want 108100 / 432400", got.PrepaidTotal, got.AmountDue)
	}
	if err := seedPayment(pool, "pay_1", "fin", 432400); err != nil {
		t.Fatal(err)
	}
	if err := q.RefreshBalance(ctx, "fin", typesNow); err != nil {
		t.Fatal(err)
	}
	got, _ = q.Invoice(ctx, "wsp_a", "fin", "2026-11-07", false)
	if got.Status != "paid" || got.AmountDue != 0 || got.RefundDue != 0 {
		t.Fatalf("status %s due %d refund %d", got.Status, got.AmountDue, got.RefundDue)
	}
	list, _, err := q.ListInvoices(ctx, "wsp_a", "2026-11-07", InvoiceFilter{Kind: "invoice"}, 0, 0)
	if err != nil || len(list) != 1 || list[0].AmountDue != 0 || list[0].PrepaidTotal != 108100 {
		t.Fatalf("list = %+v, %v", list, err)
	}
}

func TestSummaryExcludesProformaSelfBilled(t *testing.T) {
	q, pool := typesDB(t, 0)
	ctx := context.Background()
	for _, k := range []struct{ id, kind string }{{"a", "invoice"}, {"b", "partial"}, {"c", "prepayment"}, {"d", "debit_note"},
		{"e", "corrected"}, {"f", "proforma"}, {"g", "self_billed"}} {
		seedInvoice(t, pool, k.id, k.kind, "open", 100, "2026-12-31", 0)
	}
	s, err := q.InvoiceSummary(ctx, "wsp_a", "CHF", "2026-11-07", "")
	if err != nil || s.Outstanding.Count != 5 || s.Outstanding.Amount != 500 {
		t.Fatalf("outstanding = %+v, %v; want 5 / 500", s.Outstanding, err)
	}
	for _, m := range s.Monthly {
		if m.Month == "2026-10" && m.Invoiced != 500 {
			t.Fatalf("invoiced October = %d, want 500", m.Invoiced)
		}
	}
}

func TestOverdueNeverProforma(t *testing.T) {
	q, pool := typesDB(t, 0)
	ctx := context.Background()
	seedInvoice(t, pool, "pf", "proforma", "open", 100, "2026-10-15", 0)
	seedInvoice(t, pool, "sb", "self_billed", "open", 100, "2026-10-15", 0)
	pf, _ := q.Invoice(ctx, "wsp_a", "pf", "2026-11-07", false)
	sb, _ := q.Invoice(ctx, "wsp_a", "sb", "2026-11-07", false)
	if pf.IsOverdue || !sb.IsOverdue {
		t.Fatalf("overdue proforma %v self_billed %v, want false / true", pf.IsOverdue, sb.IsOverdue)
	}
	list, _, err := q.ListInvoices(ctx, "wsp_a", "2026-11-07", InvoiceFilter{Statuses: []string{"overdue"}}, 0, 0)
	if err != nil || len(list) != 1 || list[0].ID != "sb" {
		t.Fatalf("overdue filter = %+v, %v", list, err)
	}
	all, _, _ := q.ListInvoices(ctx, "wsp_a", "2026-11-07", InvoiceFilter{}, 0, 0)
	for _, i := range all {
		if i.ID == "pf" && i.IsOverdue {
			t.Fatal("list item says proforma is overdue")
		}
	}
}

// A zero-total document (a fully prepaid final) is voided by its issued credit note although nothing was credited.
func TestRefreshBalanceVoidsZeroTotalOnCreditNote(t *testing.T) {
	q, pool := typesDB(t, 0)
	ctx := context.Background()
	seedInvoice(t, pool, "fin", "invoice", "paid", 0, "2026-10-31", 0)
	if err := q.RefreshBalance(ctx, "fin", typesNow); err != nil {
		t.Fatal(err)
	}
	if got, _ := q.Invoice(ctx, "wsp_a", "fin", "2026-11-07", false); got.Status != "paid" {
		t.Fatalf("without a credit note = %s", got.Status)
	}
	seedInvoice(t, pool, "cn", "credit_note", "paid", 0, "2026-10-31", 0)
	if _, err := pool.Exec(ctx, `UPDATE invoices SET credited_invoice_id = 'fin' WHERE id = 'cn'`); err != nil {
		t.Fatal(err)
	}
	if err := q.RefreshBalance(ctx, "fin", typesNow); err != nil {
		t.Fatal(err)
	}
	if got, _ := q.Invoice(ctx, "wsp_a", "fin", "2026-11-07", false); got.Status != "void" {
		t.Fatalf("with a credit note = %s", got.Status)
	}
}
