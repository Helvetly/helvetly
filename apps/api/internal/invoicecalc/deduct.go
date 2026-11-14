package invoicecalc

import "slices"

// Deduct subtracts already-invoiced prepayments from a final invoice's totals, per VAT group
// (category and rate). A group the final lacks is kept negative so the totals stay exact.
// It returns the new totals and the gross amount deducted; cash rounding is redone on the remainder.
func Deduct(t Totals, prepaid [][]Group, currency string) (Totals, Money) {
	t.Breakdown = slices.Clone(t.Breakdown)
	var gross Money
	for _, p := range prepaid {
		for _, pg := range p {
			i := slices.IndexFunc(t.Breakdown, func(g Group) bool { return g.Category == pg.Category && g.Rate == pg.Rate })
			if i < 0 {
				t.Breakdown = append(t.Breakdown, Group{Category: pg.Category, Rate: pg.Rate})
				i = len(t.Breakdown) - 1
			}
			t.Breakdown[i].TaxableAmount -= pg.TaxableAmount
			t.Breakdown[i].VATAmount -= pg.VATAmount
			t.NetTotal -= pg.TaxableAmount
			t.VATTotal -= pg.VATAmount
			gross += pg.TaxableAmount + pg.VATAmount
		}
	}
	slices.SortStableFunc(t.Breakdown, func(a, b Group) int {
		if a.Rate != b.Rate {
			return int(b.Rate - a.Rate)
		}
		return slices.Index(Categories, a.Category) - slices.Index(Categories, b.Category)
	})
	t.Total = t.NetTotal + t.VATTotal
	t.RoundingAmount = 0
	if currency == "CHF" {
		t.RoundingAmount = CashRound(t.Total) - t.Total
	}
	return t, gross
}
