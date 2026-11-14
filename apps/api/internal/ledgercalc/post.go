package ledgercalc

import (
	"sort"

	"helvetly.com/api/internal/invoicecalc"
)

// Post derives the journal from the sources, sorted by date, then ref, then input order.
func Post(a Accounts, s Sources) []Row {
	var rows []Row
	add := func(date, ref, desc, debit, credit string, amount invoicecalc.Money, cur, typ, id string) {
		if amount == 0 {
			return
		}
		if amount < 0 {
			debit, credit, amount = credit, debit, -amount
		}
		rows = append(rows, Row{date, ref, desc, debit, credit, amount, cur, typ, id})
	}
	bank := func(method string) string {
		if c, ok := a.Bank[method]; ok {
			return c
		}
		return a.Bank["other"]
	}

	for _, inv := range s.Invoices {
		desc := "Invoice " + inv.Ref + " · " + inv.Party
		sign := invoicecalc.Money(1)
		if inv.Sign < 0 {
			desc, sign = "Credit "+inv.Ref+" · "+inv.Party, -1
		}
		post := func(credit string, amount invoicecalc.Money) {
			add(inv.Date, inv.Ref, desc, a.Receivables, credit, sign*amount, inv.Currency, "invoice", inv.ID)
		}
		for _, g := range inv.Groups {
			post(a.Revenue, g.TaxableAmount)
			post(a.OutputVAT, g.VATAmount)
		}
		post(a.Rounding, inv.Rounding)
	}

	for _, p := range s.Payments {
		desc, typ, sign := "Payment "+p.Ref, "payment", invoicecalc.Money(1)
		if p.Refund {
			desc, typ, sign = "Refund "+p.Ref, "refund", -1
		}
		add(p.Date, p.Ref, desc, bank(p.Method), a.Receivables, sign*p.Amount, p.Currency, typ, p.InvoiceID)
	}

	for _, e := range s.Expenses {
		vat := a.InputVATOther
		if e.MaterialVAT {
			vat = a.InputVATMaterial
		}
		desc := "Expense " + e.Ref + " · " + e.Party
		add(e.Date, e.Ref, desc, e.Account, a.Payables, e.Total-e.Deductible, e.Currency, "expense", e.ID)
		add(e.Date, e.Ref, desc, vat, a.Payables, e.Deductible, e.Currency, "expense", e.ID)
		if e.ReverseCharge {
			acq := "Acquisition tax " + e.Ref + " · " + e.Party
			add(e.Date, e.Ref, acq, vat, a.OutputVAT, e.AcquisitionDeductible, e.Currency, "expense", e.ID)
			add(e.Date, e.Ref, acq, e.Account, a.OutputVAT, e.AcquisitionTax-e.AcquisitionDeductible, e.Currency, "expense", e.ID)
		}
		if e.PaidOn == "" {
			continue
		}
		pay := "Expense payment " + e.Ref
		if !e.PaidByMember {
			add(e.PaidOn, e.Ref, pay, a.Payables, bank(e.Method), e.Total, e.Currency, "expense", e.ID)
			continue
		}
		add(e.PaidOn, e.Ref, pay, a.Payables, a.MemberPayable, e.Total, e.Currency, "expense", e.ID)
		if e.ReimbursedOn != "" {
			add(e.ReimbursedOn, e.Ref, "Reimbursement "+e.Ref, a.MemberPayable, bank("bank_transfer"), e.Total, e.Currency, "expense", e.ID)
		}
	}

	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Date != rows[j].Date {
			return rows[i].Date < rows[j].Date
		}
		return rows[i].Ref < rows[j].Ref
	})
	return rows
}
