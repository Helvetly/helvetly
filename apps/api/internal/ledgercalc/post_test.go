package ledgercalc

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/invoicecalc"
)

func g(taxable, vat invoicecalc.Money) []invoicecalc.Group {
	return []invoicecalc.Group{{Category: "S", Rate: 810, TaxableAmount: taxable, VATAmount: vat}}
}

func brief(rows []Row) [][3]any {
	var out [][3]any
	for _, r := range rows {
		out = append(out, [3]any{r.Debit, r.Credit, r.Amount})
	}
	return out
}

func TestPostInvoiceAndPayment(t *testing.T) {
	rows := Post(DefaultAccounts(), Sources{
		Invoices: []Invoice{{ID: "inv_1", Ref: "2026-001", Party: "Acme", Date: "2026-03-02", Currency: "CHF", Sign: 1, Groups: g(100000, 8100)}},
		Payments: []Payment{{InvoiceID: "inv_1", Ref: "2026-001", Date: "2026-03-20", Method: "cash", Currency: "CHF", Amount: 108100}},
	})
	want := []Row{
		{"2026-03-02", "2026-001", "Invoice 2026-001 · Acme", "1100", "3200", 100000, "CHF", "invoice", "inv_1"},
		{"2026-03-02", "2026-001", "Invoice 2026-001 · Acme", "1100", "2200", 8100, "CHF", "invoice", "inv_1"},
		{"2026-03-20", "2026-001", "Payment 2026-001", "1000", "1100", 108100, "CHF", "payment", "inv_1"},
	}
	if !reflect.DeepEqual(rows, want) {
		t.Fatalf("got %+v", rows)
	}
}

func TestPostSignReverses(t *testing.T) {
	rows := Post(DefaultAccounts(), Sources{Invoices: []Invoice{{ID: "c", Ref: "C1", Party: "Acme", Date: "2026-03-02", Currency: "CHF", Sign: -1, Groups: g(100000, 8100)}}})
	if len(rows) != 2 || rows[0].Debit != "3200" || rows[0].Credit != "1100" || rows[1].Debit != "2200" || rows[0].Description != "Credit C1 · Acme" {
		t.Fatalf("got %+v", rows)
	}
}

func TestPostNegativeRoundingSwaps(t *testing.T) {
	rows := Post(DefaultAccounts(), Sources{Invoices: []Invoice{{Ref: "R", Sign: 1, Rounding: -2}}})
	if len(rows) != 1 || rows[0].Debit != "3800" || rows[0].Credit != "1100" || rows[0].Amount.String() != "0.02" {
		t.Fatalf("got %+v", rows)
	}
}

func TestPostDropsZero(t *testing.T) {
	rows := Post(DefaultAccounts(), Sources{Invoices: []Invoice{{Ref: "Z", Sign: 1, Groups: g(5000, 0)}}})
	if len(rows) != 1 || rows[0].Credit != "3200" {
		t.Fatalf("got %+v", rows)
	}
}

func TestPostExpenseSplit(t *testing.T) {
	e := Expense{ID: "e", Ref: "E1", Party: "Shop", Date: "2026-04-01", Currency: "CHF", Account: "6640", Total: 10810, Deductible: 810}
	rows := Post(DefaultAccounts(), Sources{Expenses: []Expense{e}})
	want := [][3]any{{"6640", "2000", invoicecalc.Money(10000)}, {"1171", "2000", invoicecalc.Money(810)}}
	if !reflect.DeepEqual(brief(rows), want) {
		t.Fatalf("got %+v", rows)
	}
	e.MaterialVAT, e.PaidOn, e.Method = true, "2026-04-05", "cash"
	rows = Post(DefaultAccounts(), Sources{Expenses: []Expense{e}})
	want = [][3]any{{"6640", "2000", invoicecalc.Money(10000)}, {"1170", "2000", invoicecalc.Money(810)}, {"2000", "1000", invoicecalc.Money(10810)}}
	if !reflect.DeepEqual(brief(rows), want) {
		t.Fatalf("got %+v", rows)
	}
}

func TestPostMemberReimbursed(t *testing.T) {
	e := Expense{Ref: "E", Date: "2026-04-01", Account: "6640", Total: 1000, PaidOn: "2026-04-02", PaidByMember: true, ReimbursedOn: "2026-04-09"}
	rows := Post(DefaultAccounts(), Sources{Expenses: []Expense{e}})
	if len(rows) != 3 || rows[1].Debit != "2000" || rows[1].Credit != "2210" || rows[1].Date != "2026-04-02" ||
		rows[2].Debit != "2210" || rows[2].Credit != "1020" || rows[2].Date != "2026-04-09" {
		t.Fatalf("got %+v", rows)
	}
	e.PaidByMember = false
	if rows = Post(DefaultAccounts(), Sources{Expenses: []Expense{e}}); len(rows) != 2 || rows[1].Credit != "1020" {
		t.Fatalf("reimbursement without member must be ignored: %+v", rows)
	}
}

func TestPostUnknownMethodFallsBack(t *testing.T) {
	a := DefaultAccounts()
	a.Bank["other"] = "1030"
	rows := Post(a, Sources{Payments: []Payment{{Ref: "P", Method: "crypto", Amount: 100}, {Ref: "Q", Method: "cash", Amount: 100, Refund: true}}})
	if rows[0].Debit != "1030" || rows[1].Debit != "1100" || rows[1].Credit != "1000" || rows[1].SourceType != "refund" || rows[1].Description != "Refund Q" {
		t.Fatalf("got %+v", rows)
	}
}

func TestPostBalances(t *testing.T) {
	rows := Post(DefaultAccounts(), Sources{
		Invoices: []Invoice{
			{Ref: "B", Date: "2026-01-02", Currency: "CHF", Sign: 1, Groups: g(100000, 8100), Rounding: -2},
			{Ref: "A", Date: "2026-01-02", Currency: "EUR", Sign: -1, Groups: g(5000, 405), Rounding: 3},
		},
		Payments: []Payment{{Ref: "B", Date: "2026-01-01", Currency: "CHF", Method: "twint", Amount: 500}},
		Expenses: []Expense{{Ref: "E", Date: "2026-01-03", Currency: "CHF", Account: "6000", Total: 999, Deductible: 74, PaidOn: "2026-01-04", PaidByMember: true, ReimbursedOn: "2026-01-05"}},
	})
	for _, r := range rows {
		if r.Amount <= 0 || r.Debit == "" || r.Credit == "" {
			t.Fatalf("bad row %+v", r)
		}
	}
	for i := 1; i < len(rows); i++ {
		a, b := rows[i-1], rows[i]
		if a.Date > b.Date || (a.Date == b.Date && a.Ref > b.Ref) {
			t.Fatalf("not sorted at %d: %+v %+v", i, a, b)
		}
	}
	if rows[0].Date != "2026-01-01" || rows[1].Ref != "A" || rows[len(rows)-1].Date != "2026-01-05" {
		t.Fatalf("order: %+v", rows)
	}
}

func TestPostAcquisitionTax(t *testing.T) {
	e := Expense{ID: "e", Ref: "E1", Party: "Abroad", Date: "2026-04-01", Currency: "CHF", Account: "6500", Total: 100000,
		ReverseCharge: true, AcquisitionTax: 8100, AcquisitionDeductible: 8100}
	rows := Post(DefaultAccounts(), Sources{Expenses: []Expense{e}})
	want := [][3]any{{"6500", "2000", invoicecalc.Money(100000)}, {"1171", "2200", invoicecalc.Money(8100)}}
	if !reflect.DeepEqual(brief(rows), want) || rows[1].Description != "Acquisition tax E1 · Abroad" || rows[1].Date != "2026-04-01" || rows[1].SourceType != "expense" {
		t.Fatalf("got %+v", rows)
	}
	e.MaterialVAT, e.AcquisitionDeductible = true, 4050 // half deductible: the rest is expense
	rows = Post(DefaultAccounts(), Sources{Expenses: []Expense{e}})
	want = [][3]any{{"6500", "2000", invoicecalc.Money(100000)}, {"1170", "2200", invoicecalc.Money(4050)}, {"6500", "2200", invoicecalc.Money(4050)}}
	if !reflect.DeepEqual(brief(rows), want) {
		t.Fatalf("got %+v", rows)
	}
	e.ReverseCharge = false
	if rows = Post(DefaultAccounts(), Sources{Expenses: []Expense{e}}); len(rows) != 1 {
		t.Fatalf("no acquisition tax without reverse charge: %+v", rows)
	}
}
