package invoicecalc

import (
	"math/big"
	"slices"
)

// VAT modes: net prices, gross prices, or a seller who is not VAT-registered.
const (
	Exclusive = "exclusive"
	Inclusive = "inclusive"
	None      = "none"
)

// Categories is the EN 16931 / UNCL5305 subset, in the order the breakdown lists them.
var Categories = []string{"S", "Z", "E", "AE", "K", "G", "O"}

type Line struct {
	Quantity  Quantity
	UnitPrice Money
	Discount  Percent
	Category  string
	Rate      Percent
}

// Group is one row of the VAT breakdown (EN 16931 BG-23).
type Group struct {
	Category      string  `json:"category"`
	Rate          Percent `json:"rate"`
	TaxableAmount Money   `json:"taxable_amount"`
	VATAmount     Money   `json:"vat_amount"`
}

type Totals struct {
	Amounts        []Money // per line, in input order
	Subtotal       Money
	DiscountAmount Money
	NetTotal       Money
	Breakdown      []Group
	VATTotal       Money
	Total          Money
	RoundingAmount Money
}

// Payable is what the buyer owes: the total after cash rounding.
func (t Totals) Payable() Money { return t.Total + t.RoundingAmount }

// LineAmount = round2(quantity × unit_price × (1 − discount/100)).
func LineAmount(l Line) Money {
	return Money(divRound(mul(int64(l.Quantity), int64(l.UnitPrice), int64(Hundred-l.Discount)), 1000*int64(Hundred)))
}

// Compute runs the contract's steps in order. In none mode every line is category O at rate 0.
func Compute(mode, currency string, lines []Line, discount Percent) Totals {
	t := Totals{Amounts: make([]Money, len(lines)), Breakdown: []Group{}}
	type key struct {
		category string
		rate     Percent
	}
	sums := map[key]Money{}
	for i, l := range lines {
		t.Amounts[i] = LineAmount(l)
		t.Subtotal += t.Amounts[i]
		k := key{l.Category, l.Rate}
		if mode == None {
			k = key{"O", 0}
		}
		if _, ok := sums[k]; !ok {
			t.Breakdown = append(t.Breakdown, Group{Category: k.category, Rate: k.rate})
		}
		sums[k] += t.Amounts[i]
	}
	slices.SortStableFunc(t.Breakdown, func(a, b Group) int {
		if a.Rate != b.Rate {
			return int(b.Rate - a.Rate)
		}
		return slices.Index(Categories, a.Category) - slices.Index(Categories, b.Category)
	})
	t.DiscountAmount = Money(divRound(mul(int64(t.Subtotal), int64(discount)), int64(Hundred)))

	bases := make([]Money, len(t.Breakdown))
	for i, g := range t.Breakdown {
		bases[i] = sums[key{g.Category, g.Rate}]
	}
	shares := allocate(t.DiscountAmount, bases)
	for i := range t.Breakdown {
		g := &t.Breakdown[i]
		base := bases[i] - shares[i]
		if mode == Inclusive {
			g.VATAmount = Money(divRound(mul(int64(base), int64(g.Rate)), int64(Hundred+g.Rate)))
			g.TaxableAmount = base - g.VATAmount
		} else {
			g.TaxableAmount = base
			g.VATAmount = Money(divRound(mul(int64(base), int64(g.Rate)), int64(Hundred)))
		}
		t.NetTotal += g.TaxableAmount
		t.VATTotal += g.VATAmount
	}
	t.Total = t.NetTotal + t.VATTotal
	if currency == "CHF" {
		t.RoundingAmount = CashRound(t.Total) - t.Total
	}
	return t
}

// allocate splits total over parts proportionally, by largest remainder, so the shares sum exactly to total
// (ties go to the earlier part). All values are ≥ 0.
func allocate(total Money, parts []Money) []Money {
	shares := make([]Money, len(parts))
	var sum Money
	for _, p := range parts {
		sum += p
	}
	if sum == 0 || total == 0 {
		return shares
	}
	rems := make([]*big.Int, len(parts))
	left := total
	for i, p := range parts {
		q, r := new(big.Int).QuoRem(mul(int64(total), int64(p)), big.NewInt(int64(sum)), new(big.Int))
		shares[i], rems[i] = Money(q.Int64()), r
		left -= shares[i]
	}
	order := make([]int, len(parts))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(a, b int) int { return rems[b].Cmp(rems[a]) })
	for _, i := range order[:left] {
		shares[i]++
	}
	return shares
}

// CashRound rounds to the nearest 0.05 (Swiss cash rounding); 0.025 cannot occur in cents.
func CashRound(m Money) Money {
	r := m % 5
	switch {
	case r >= 3:
		return m - r + 5
	case r <= -3:
		return m - r - 5
	}
	return m - r
}
