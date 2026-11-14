// Package instalcalc splits an invoice amount into instalments: amounts, due dates and the allocation
// of credits and payments over them. Pure, exact minor units.
package instalcalc

import (
	"fmt"
	"time"

	"helvetly.com/api/internal/invoicecalc"
)

const (
	MinCount = 2
	MaxCount = 12
)

// days or months per step
var intervals = map[string]struct{ days, months int }{
	"weekly":    {days: 7},
	"biweekly":  {days: 14},
	"monthly":   {months: 1},
	"quarterly": {months: 3},
	"yearly":    {months: 12},
}

func ValidInterval(s string) bool {
	_, ok := intervals[s]
	return ok
}

// Split divides total into count instalments; the last takes the remainder. In CHF every other
// instalment is cash rounded to 0.05 (down when up would leave nothing for the last), so the last is a 0.05 multiple
// whenever the total is.
func Split(total invoicecalc.Money, count int, currency string) []invoicecalc.Money {
	if count < 1 {
		return nil
	}
	part := total / invoicecalc.Money(count)
	if currency == "CHF" {
		exact := part
		// rounded up count−1 times, small totals would leave the last instalment empty or negative: round down then
		if part = invoicecalc.CashRound(exact); total > 0 && part*invoicecalc.Money(count-1) >= total {
			part = exact - exact%5
		}
	}
	out := make([]invoicecalc.Money, count)
	for i := range count - 1 {
		out[i] = part
	}
	out[count-1] = total - part*invoicecalc.Money(count-1)
	return out
}

// Dates returns count due dates from first. Month steps are taken from first, not from the previous
// date, and clamp to the month end: 31 Jan → 28 Feb → 31 Mar.
func Dates(first time.Time, interval string, count int) ([]time.Time, error) {
	step, ok := intervals[interval]
	if !ok {
		return nil, fmt.Errorf("instalcalc: unknown interval %q", interval)
	}
	if count < MinCount || count > MaxCount {
		return nil, fmt.Errorf("instalcalc: count %d outside %d–%d", count, MinCount, MaxCount)
	}
	y, m, d := first.Date()
	h, mi, s := first.Clock()
	out := make([]time.Time, count)
	for i := range count {
		if step.days > 0 {
			out[i] = first.AddDate(0, 0, i*step.days)
			continue
		}
		month := m + time.Month(i*step.months)
		// day 0 of the next month is the last day of this one
		last := time.Date(y, month+1, 0, 0, 0, 0, 0, first.Location()).Day()
		out[i] = time.Date(y, month, min(d, last), h, mi, s, first.Nanosecond(), first.Location())
	}
	return out, nil
}

// Allocate reduces the amounts from the last instalment backwards by credited, then fills the
// effective amounts oldest first with paid. Nothing goes below zero; overpayment is not allocated.
func Allocate(amounts []invoicecalc.Money, credited, paid invoicecalc.Money) (effective, paidPer []invoicecalc.Money) {
	effective = append([]invoicecalc.Money(nil), amounts...)
	for i := len(effective) - 1; i >= 0 && credited > 0; i-- {
		cut := min(credited, effective[i])
		effective[i] -= cut
		credited -= cut
	}
	paidPer = make([]invoicecalc.Money, len(effective))
	for i, e := range effective {
		paidPer[i] = max(0, min(paid, e))
		paid -= paidPer[i]
	}
	return effective, paidPer
}

// SplitGroups divides each VAT group's taxable amount into count parts, the remainder on the last.
// VAT is left zero: each part is computed as its own invoice.
func SplitGroups(groups []invoicecalc.Group, count int) [][]invoicecalc.Group {
	if count < 1 {
		return nil
	}
	out := make([][]invoicecalc.Group, count)
	for i := range out {
		out[i] = make([]invoicecalc.Group, len(groups))
	}
	for g, group := range groups {
		for i, net := range Split(group.TaxableAmount, count, "") {
			out[i][g] = invoicecalc.Group{Category: group.Category, Rate: group.Rate, TaxableAmount: net}
		}
	}
	return out
}
