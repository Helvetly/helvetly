// Package engagements holds committed work per client: periods, a delivery log and draft invoices
// (docs/engagements-contract.md).
package engagements

import (
	"time"

	"helvetly.com/api/internal/invoicecalc"
)

const dateLayout = "2006-01-02"

func parseDate(s string) (time.Time, bool) {
	t, err := time.Parse(dateLayout, s)
	return t, err == nil
}

// addMonths adds calendar months and clamps to the last day of the target month (31 Jan + 1 = 28 Feb).
func addMonths(t time.Time, months int) time.Time {
	first := time.Date(t.Year(), t.Month()+time.Month(months), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1).Day()
	return first.AddDate(0, 0, min(t.Day(), last)-1)
}

// shift moves start by k intervals of the recurrence, always measured from start.
func shift(start time.Time, recurrence string, interval, k int) (time.Time, bool) {
	switch recurrence {
	case "weekly":
		return start.AddDate(0, 0, 7*interval*k), true
	case "monthly":
		return addMonths(start, interval*k), true
	case "quarterly":
		return addMonths(start, 3*interval*k), true
	case "yearly":
		return addMonths(start, 12*interval*k), true
	}
	return start, false
}

// PeriodBounds returns period n (1-based): it starts at start + (n-1) × interval units, ends the day
// before period n+1, and is cut at end (the earlier of end_date and cancelled_on; "" = none).
// A "none" engagement has one period start..end. ok is false for a period that does not exist.
func PeriodBounds(start, recurrence string, interval int, end string, n int) (startsOn, endsOn string, ok bool) {
	s, okS := parseDate(start)
	if !okS || n < 1 || interval < 1 {
		return "", "", false
	}
	var e time.Time
	if end != "" {
		var okE bool
		if e, okE = parseDate(end); !okE || e.Before(s) {
			return "", "", false
		}
	}
	if recurrence == "none" {
		if end == "" || n != 1 {
			return "", "", false
		}
		return start, end, true
	}
	from, ok := shift(s, recurrence, interval, n-1)
	if !ok || (end != "" && from.After(e)) {
		return "", "", false
	}
	next, _ := shift(s, recurrence, interval, n)
	to := next.AddDate(0, 0, -1)
	if end != "" && to.After(e) {
		to = e
	}
	return from.Format(dateLayout), to.Format(dateLayout), true
}

// Stats is a period measured against today.
type Stats struct {
	Remaining  invoicecalc.Quantity
	Overage    invoicecalc.Quantity
	Expected   invoicecalc.Quantity
	State      string // upcoming | open | closed
	DaysLeft   int    // open only
	ElapsedPct int
	UnderPace  bool // open, ≥ 33 % elapsed and used < 0.75 × expected
	EndingSoon bool // open, ≤ 14 days left and something remains
}

func days(from, to time.Time) int { return int(to.Sub(from).Hours()/24) + 1 }

// Measure computes used/remaining/overage and the pace of a period on civil date today.
// Expected is quantity × elapsed days / period days (today counts), rounded down to 0.001.
func Measure(quantity, used invoicecalc.Quantity, startsOn, endsOn, today string) Stats {
	st := Stats{Remaining: max(0, quantity-used), Overage: max(0, used-quantity)}
	s, ok1 := parseDate(startsOn)
	e, ok2 := parseDate(endsOn)
	t, ok3 := parseDate(today)
	if !ok1 || !ok2 || !ok3 {
		st.State = "closed"
		return st
	}
	switch {
	case t.Before(s):
		st.State = "upcoming"
	case t.After(e):
		st.State, st.Expected, st.ElapsedPct = "closed", quantity, 100
	default:
		st.State = "open"
		elapsed, total := days(s, t), days(s, e)
		st.Expected = invoicecalc.Quantity(int64(quantity) * int64(elapsed) / int64(total))
		st.ElapsedPct = elapsed * 100 / total
		st.DaysLeft = days(t, e) - 1
		st.UnderPace = st.ElapsedPct >= 33 && int64(used)*4 < int64(st.Expected)*3
		st.EndingSoon = st.DaysLeft <= 14 && st.Remaining > 0
	}
	return st
}
