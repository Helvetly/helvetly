package ledgercalc

import (
	"testing"

	"helvetly.com/api/internal/invoicecalc"
)

func TestPostPayroll(t *testing.T) {
	a := DefaultPayrollAccounts()
	accrual := PayrollItem{EntryID: "pay_1", Kind: "accrual", Ref: "2026-10", Party: "Anna Muster", Date: "2026-10-31",
		Currency: "CHF", Gross: 600000, Deductions: 82000, Net: 518000, EmployerCosts: 71000}
	reversal := accrual
	reversal.Kind = "reversal"
	payment := PayrollItem{EntryID: "pay_1", Kind: "payment", Ref: "2026-10", Party: "Anna Muster", Date: "2026-10-25",
		Currency: "CHF", Amount: 518000}
	underpaid := PayrollItem{EntryID: "pay_2", Kind: "payment", Ref: "2026-10", Party: "Anna Muster", Date: "2026-11-25",
		Currency: "CHF", Amount: -5000}
	rows := PostPayroll(a, []PayrollItem{accrual, payment, reversal, underpaid})

	debit, credit := map[string]invoicecalc.Money{}, map[string]invoicecalc.Money{}
	for _, r := range rows[:3] {
		debit[r.Debit] += r.Amount
		credit[r.Credit] += r.Amount
	}
	if debit["5000"] != 600000 || debit["5700"] != 71000 {
		t.Fatalf("accrual expenses %v, want gross 6000.00 and employer costs 710.00 apart", debit)
	}
	if credit["2279"] != 518000 || credit["2270"] != 153000 {
		t.Fatalf("accrual liabilities %v: net to the employee, deductions and employer costs to third parties", credit)
	}
	if r := rows[3]; r.Debit != "2279" || r.Credit != "1020" || r.Amount != 518000 || r.SourceType != "payroll_payment" {
		t.Fatalf("payment row %+v", r)
	}
	for _, r := range rows[4:7] {
		if r.Credit != "5000" && r.Credit != "5700" || r.SourceType != "payroll_reversal" {
			t.Fatalf("reversal row %+v must credit the expense back", r)
		}
	}
	if r := rows[7]; r.Debit != "1020" || r.Credit != "2279" || r.Amount != 5000 {
		t.Fatalf("an overpayment refund flips the payment: %+v", r)
	}
	missing := accrual
	missing.EmployerCosts = 0
	if got := len(PostPayroll(a, []PayrollItem{missing})); got != 2 {
		t.Fatalf("zero employer costs post %d rows, want 2", got)
	}
}
