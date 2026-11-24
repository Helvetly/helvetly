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
// lines, in the order they first appear, in proportion to each account's VAT and net in the document
// currency. The last account with a share takes what rounding leaves.
func SplitExpense(account, box string, gross bool, lines []SplitLine, total, deductible, net invoicecalc.Money) []Split {
	if len(lines) == 0 {
		return []Split{{Account: account, Material: Material(account, box), Net: total - deductible, Deductible: deductible, Taxable: net}}
	}
	accounts := map[string]int{}
	var splits []Split
	var netWeights, vatWeights []*big.Rat
	for _, l := range lines {
		a := l.Account
		if a == "" {
			a = account
		}
		i, ok := accounts[a]
		if !ok {
			i = len(splits)
			accounts[a] = i
			splits = append(splits, Split{Account: a, Material: Material(a, box)})
			netWeights = append(netWeights, new(big.Rat))
			vatWeights = append(vatWeights, new(big.Rat))
		}
		// Account weights keep fractional cents: only the document rounds the tax for each rate.
		base := new(big.Rat).SetInt64(int64(l.Amount))
		denominator := invoicecalc.Hundred
		if gross {
			denominator += l.Rate
		}
		vat := big.NewRat(int64(l.Rate), int64(denominator))
		vat.Mul(base, vat)
		if gross {
			base.Sub(base, vat)
		}
		netWeights[i].Add(netWeights[i], base)
		vatWeights[i].Add(vatWeights[i], vat)
	}

	nets := allocate(net, netWeights)
	deductibles := allocate(deductible, vatWeights)
	unrecoverable := allocate(total-net-deductible, vatWeights)
	for i := range splits {
		splits[i].Taxable = nets[i]
		splits[i].Deductible = deductibles[i]
		splits[i].Net = nets[i] + unrecoverable[i]
	}
	return splits
}

// allocate divides amount in proportion to weights, rounding each part down and giving the rest to the last with weight.
// With no weight at all the last takes everything.
func allocate(amount invoicecalc.Money, weights []*big.Rat) []invoicecalc.Money {
	parts := make([]invoicecalc.Money, len(weights))
	var sum big.Rat
	last := len(weights) - 1
	for i, w := range weights {
		sum.Add(&sum, w)
		if w.Sign() > 0 {
			last = i
		}
	}
	if sum.Sign() == 0 {
		parts[last] = amount
		return parts
	}
	left := amount
	for i := range last {
		share := new(big.Rat).Mul(new(big.Rat).SetInt64(int64(amount)), weights[i])
		share.Quo(share, &sum)
		parts[i] = invoicecalc.Money(new(big.Int).Quo(share.Num(), share.Denom()).Int64())
		left -= parts[i]
	}
	parts[last] = left
	return parts
}
