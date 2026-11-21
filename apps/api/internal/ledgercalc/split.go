package ledgercalc

import (
	"math/big"
	"strings"

	"helvetly.com/api/internal/invoicecalc"
)

// SplitLine is one expense line in its document currency; Account "" means the expense's own category account.
type SplitLine struct {
	Account string
	Amount  invoicecalc.Money
	Rate    invoicecalc.Percent
}

// Split is the part of an expense posted to one account, in its base currency.
type Split struct {
	Account    string            `json:"account"`
	Material   bool              `json:"material"`   // input tax on materials and services (Ziffer 400), else 405
	Net        invoicecalc.Money `json:"net"`        // posted to Account: the gross share less its deductible input tax
	Deductible invoicecalc.Money `json:"deductible"` // posted to input tax
	Taxable    invoicecalc.Money `json:"taxable"`    // the share of the net total: the acquisition tax base
	// Acquisition tax on Taxable and its deductible part, for a service from abroad (set by the caller).
	AcquisitionTax        invoicecalc.Money `json:"acquisition_tax"`
	AcquisitionDeductible invoicecalc.Money `json:"acquisition_deductible"`
}

// Material: the input-tax box is the expense's own ("400" or "405"), else 400 for an account of class 4.
func Material(account, box string) bool {
	return box == "400" || box == "" && strings.HasPrefix(account, "4")
}

// SplitExpense divides an expense's base total, deductible input tax and net total over the accounts of its
// lines, in the order they first appear, in proportion to each account's gross, VAT and net in the document
// currency; the last account takes what rounding leaves, so the parts always add up to the totals.
func SplitExpense(account, box string, gross bool, lines []SplitLine, total, deductible, net invoicecalc.Money) []Split {
	mode := invoicecalc.Exclusive
	if gross {
		mode = invoicecalc.Inclusive
	}
	var order []string
	byAccount := map[string][]invoicecalc.Line{}
	for _, l := range lines {
		a := l.Account
		if a == "" {
			a = account
		}
		if _, ok := byAccount[a]; !ok {
			order = append(order, a)
		}
		category := "O"
		if l.Rate > 0 {
			category = "S"
		}
		byAccount[a] = append(byAccount[a], invoicecalc.Line{Quantity: 1000, UnitPrice: l.Amount, Category: category, Rate: l.Rate})
	}
	if len(order) == 0 {
		order = []string{account}
	}
	grossW, vatW, netW := make([]invoicecalc.Money, len(order)), make([]invoicecalc.Money, len(order)), make([]invoicecalc.Money, len(order))
	for i, a := range order {
		t := invoicecalc.Compute(mode, "", byAccount[a], 0)
		grossW[i], vatW[i], netW[i] = t.Total, t.VATTotal, t.NetTotal
	}
	totals, deductibles, nets := allocate(total, grossW), allocate(deductible, vatW), allocate(net, netW)
	splits := make([]Split, len(order))
	for i, a := range order {
		splits[i] = Split{Account: a, Material: Material(a, box), Net: totals[i] - deductibles[i], Deductible: deductibles[i], Taxable: nets[i]}
	}
	return splits
}

// allocate divides amount in proportion to weights, rounding each part down and giving the rest to the last, so no
// part is negative and none is lost; with no weight at all the last takes everything.
func allocate(amount invoicecalc.Money, weights []invoicecalc.Money) []invoicecalc.Money {
	parts := make([]invoicecalc.Money, len(weights))
	var sum invoicecalc.Money
	for _, w := range weights {
		sum += w
	}
	left := amount
	for i := range len(weights) - 1 {
		if sum != 0 {
			q := new(big.Int).Mul(big.NewInt(int64(amount)), big.NewInt(int64(weights[i])))
			parts[i] = invoicecalc.Money(q.Div(q, big.NewInt(int64(sum))).Int64())
		}
		left -= parts[i]
	}
	parts[len(parts)-1] = left
	return parts
}
