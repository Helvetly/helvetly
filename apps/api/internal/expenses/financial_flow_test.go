package expenses

import (
	"context"
	"encoding/csv"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestExpenseFinancialFlowKeepsTaxPaymentAndExportSeparate(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	category := e.categories(b)["6640"]
	local := e.create(b, map[string]any{
		"supplier_name": "Hotel Bern", "supplier_country": "CH", "document_date": "2026-11-03",
		"category_id": category.ID, "receipt_missing_reason": "Original lost; substitute voucher retained",
		"lines":     []map[string]any{{"amount": "180.00", "vat_rate": "3.8"}, {"amount": "25.00", "vat_rate": "8.1"}},
		"input_tax": "partial", "deductible_percent": "50", "paid_by_member_id": b.user,
	})
	// The receipt contains 6.59 + 1.87 VAT. Deducting half per rate gives 3.30 + 0.94 = 4.24.
	if local.Total != "205.00" || local.VATTotal != "8.46" || local.DeductibleVAT != "4.24" {
		t.Fatalf("mixed-rate receipt: %+v", local)
	}
	foreign := e.create(b, map[string]any{
		"supplier_name": "Hotel Berlin", "supplier_country": "DE", "document_date": "2026-11-04",
		"category_id": category.ID, "receipt_missing_reason": "Substitute voucher",
		"currency": "EUR", "exchange_rate": "0.9412", "exchange_rate_date": "2026-11-01", "exchange_rate_source": "estv_monthly",
		"lines": []map[string]any{{"amount": "119.00", "vat_rate": "19"}},
	})
	// EUR 119 × CHF 0.9412 = CHF 112.0028, rounded to 112.00. Foreign VAT is not Swiss input tax.
	if foreign.Base.Total != "112.00" || foreign.InputTax != "none" || foreign.DeductibleVAT != "0.00" {
		t.Fatalf("foreign receipt: %+v", foreign)
	}
	var summary struct{ Data store.ExpenseSummary }
	e.do(b, "GET", "/api/v1/expenses/summary", nil, 200, &summary)
	if summary.Data.InputVAT.Amount.String() != "0.00" {
		t.Fatal("unbooked VAT became reclaimable")
	}
	for _, id := range []string{local.ID, foreign.ID} {
		e.do(b, "POST", "/api/v1/expenses/"+id+"/book", nil, 200, nil)
	}
	e.do(b, "GET", "/api/v1/expenses/summary", nil, 200, &summary)
	if summary.Data.ThisMonth.Amount.String() != "317.00" || summary.Data.InputVAT.Amount.String() != "4.24" ||
		summary.Data.ToReimburse.Amount.String() != "205.00" || summary.Data.Unpaid.Amount.String() != "112.00" {
		t.Fatalf("booked summary: %+v", summary.Data)
	}
	e.do(b, "PATCH", "/api/v1/expenses/"+local.ID, map[string]any{"payment_status": "unpaid"}, 200, nil)
	e.do(b, "GET", "/api/v1/expenses/summary", nil, 200, &summary)
	if summary.Data.Unpaid.Amount.String() != "317.00" || summary.Data.ToReimburse.Amount.String() != "0.00" ||
		summary.Data.InputVAT.Amount.String() != "4.24" {
		t.Fatalf("payment changed cost or VAT: %+v", summary.Data)
	}
	e.do(b, "POST", "/api/v1/expenses/"+local.ID+"/void", map[string]any{"reason": "Replacement supplier receipt"}, 200, nil)
	e.do(b, "GET", "/api/v1/expenses/summary", nil, 200, &summary)
	if summary.Data.ThisMonth.Amount.String() != "112.00" || summary.Data.InputVAT.Amount.String() != "0.00" {
		t.Fatalf("void was not excluded: %+v", summary.Data)
	}
	_, raw := e.send(b, "GET", "/api/v1/expenses/export?ids="+local.ID+","+foreign.ID+"&sort=number", nil, "")
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(string(raw), "\uFEFF"))).ReadAll()
	if err != nil || len(rows) != 3 {
		t.Fatalf("export rows: %v, %s", err, raw)
	}
	fields := map[string]string{}
	for i, name := range rows[0] {
		fields[name] = rows[1][i]
	}
	if fields["status"] != "void" || fields["total"] != "205.00" || fields["deductible_vat"] != "4.24" ||
		fields["account_code"] != "6640" || fields["base_currency"] != "CHF" {
		t.Fatalf("void rewrote the historical accounting export: %+v", fields)
	}
}

func TestBookingWaitsForCategoryEdit(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.categories(b)["6640"]
	input := complete(c.ID)
	input["receipt_missing_reason"] = "Substitute voucher"
	x := e.create(b, input)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := e.raw.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	var blocker int
	if err := tx.QueryRow(ctx, `SELECT pg_backend_pid() FROM expense_categories WHERE id = $1 FOR UPDATE`, c.ID).Scan(&blocker); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		result <- e.st.Tx(ctx, func(q store.Q) error { return q.BookExpense(ctx, x.ID, b.user, e.svc.now()) })
	}()
	for {
		select {
		case err := <-result:
			t.Fatalf("booking bypassed the category lock: %v", err)
		default:
		}
		var waiting bool
		if err := e.raw.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))`, blocker).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("booking did not reach the category lock")
		case <-time.After(5 * time.Millisecond):
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE expense_categories SET name = 'Renamed before booking' WHERE id = $1`, c.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	e.fails(b, "PATCH", "/api/v1/expense-categories/"+c.ID, map[string]any{"name": "Renamed after booking"}, 409, "category_locked")
}

func TestConcurrentBulkBookingUsesOneLockOrder(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.categories(b)["6640"]
	input := complete(c.ID)
	input["receipt_missing_reason"] = "Substitute voucher"
	x, y := e.create(b, input), e.create(b, input)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := e.raw.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	var blocker int
	if err := tx.QueryRow(ctx, `SELECT pg_backend_pid() FROM expense_categories WHERE id = $1 FOR UPDATE`, c.ID).Scan(&blocker); err != nil {
		t.Fatal(err)
	}
	results := make(chan int, 2)
	for _, ids := range [][]string{{x.ID, y.ID}, {y.ID, x.ID}} {
		go func() {
			resp, _ := e.send(b, "POST", "/api/v1/expenses/bulk", map[string]any{"ids": ids, "action": "book"}, "")
			results <- resp.StatusCode
		}()
	}
	for {
		var waiting int
		if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity a
			WHERE $1 = ANY(pg_blocking_pids(a.pid)) OR EXISTS (
				SELECT 1 FROM unnest(pg_blocking_pids(a.pid)) AS b(pid)
				WHERE $1 = ANY(pg_blocking_pids(b.pid)))`, blocker).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting == 2 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("bulk operations did not reach the locks")
		case <-time.After(5 * time.Millisecond):
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if code := <-results; code != 200 {
			t.Fatalf("concurrent bulk booking returned %d", code)
		}
	}
}
