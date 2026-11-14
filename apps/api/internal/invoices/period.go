package invoices

import "time"

// period resolves a named reporting period on the workspace's civil date today: its dates and those of the
// preceding period of the same kind, all inclusive. A period still running ends today and is compared with
// the whole preceding one. ok is false for an unknown name.
func period(name string, today time.Time) (from, to, prevFrom, prevTo time.Time, ok bool) {
	month := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
	day := -24 * time.Hour
	switch name {
	case "this_month":
		return month, today, month.AddDate(0, -1, 0), month.Add(day), true
	case "last_month":
		last := month.AddDate(0, -1, 0)
		return last, month.Add(day), last.AddDate(0, -1, 0), last.Add(day), true
	case "this_quarter":
		quarter := month.AddDate(0, -(int(today.Month()-1) % 3), 0)
		return quarter, today, quarter.AddDate(0, -3, 0), quarter.Add(day), true
	case "this_year":
		year := month.AddDate(0, -int(today.Month()-1), 0)
		return year, today, year.AddDate(-1, 0, 0), year.Add(day), true
	case "last_12_months":
		start := month.AddDate(0, -11, 0)
		return start, today, start.AddDate(-1, 0, 0), start.Add(day), true
	}
	return from, to, prevFrom, prevTo, false
}
