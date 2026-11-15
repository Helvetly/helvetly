package ledgercalc

import "helvetly.com/api/internal/invoicecalc"

// PayrollAccounts are the accounts a payroll booking posts to. The defaults follow the Swiss KMU chart; they are
// stored with each booking and are for the accountant to confirm, not a statement of what a jurisdiction requires.
type PayrollAccounts struct {
	Salary            string `json:"salary"`             // wage expense: gross pay
	EmployerCosts     string `json:"employer_costs"`     // employer contributions and costs expense
	NetPayable        string `json:"net_payable"`        // owed to employees: net pay
	DeductionsPayable string `json:"deductions_payable"` // owed to authorities and insurers: deductions and employer costs
	Bank              string `json:"bank"`               // the account net pay is paid from
}

func DefaultPayrollAccounts() PayrollAccounts {
	return PayrollAccounts{Salary: "5000", EmployerCosts: "5700", NetPayable: "2279", DeductionsPayable: "2270", Bank: "1020"}
}

// PayrollItem is one approved, complete payroll entry to book: its accrual, the reversal of an accrual a correction
// replaced, or a payment of net pay (Amount, the part not paid before).
type PayrollItem struct {
	EntryID       string
	Kind          string // accrual, reversal, payment
	Ref           string
	Party         string
	Date          string
	Currency      string
	Gross         invoicecalc.Money
	Deductions    invoicecalc.Money
	Net           invoicecalc.Money
	EmployerCosts invoicecalc.Money
	Amount        invoicecalc.Money
}

// PostPayroll derives the journal rows of payroll items. Net pay is never the only cost: the accrual expenses the
// gross against what is owed to the employee and to third parties, and the employer's costs separately.
func PostPayroll(a PayrollAccounts, items []PayrollItem) []Row {
	var rows []Row
	add := func(it PayrollItem, desc, debit, credit string, amount invoicecalc.Money) {
		if amount == 0 {
			return
		}
		if amount < 0 {
			debit, credit, amount = credit, debit, -amount
		}
		rows = append(rows, Row{it.Date, it.Ref, desc, debit, credit, amount, it.Currency, "payroll_" + it.Kind, it.EntryID})
	}
	for _, it := range items {
		sign, desc := invoicecalc.Money(1), "Payroll "+it.Ref+" · "+it.Party
		switch it.Kind {
		case "payment":
			add(it, "Net pay "+it.Ref+" · "+it.Party, a.NetPayable, a.Bank, it.Amount)
			continue
		case "reversal":
			sign, desc = -1, "Payroll reversal "+it.Ref+" · "+it.Party
		}
		add(it, desc, a.Salary, a.NetPayable, sign*it.Net)
		add(it, desc, a.Salary, a.DeductionsPayable, sign*it.Deductions)
		add(it, desc, a.EmployerCosts, a.DeductionsPayable, sign*it.EmployerCosts)
	}
	return rows
}
