package vatreturn

import (
	"fmt"
	"regexp"
	"strconv"
	"time"
)

// span is one tax period: [From, Next) as dates, Last the period's last day.
type span struct{ Name, From, Last, Next string }

var periodPattern = regexp.MustCompile(`^(\d{4})(?:-(Q[1-4]|H[12]|0[1-9]|1[0-2]))?$`)

// parsePeriod reads "2026", "2026-H1", "2026-Q3" or "2026-07".
func parsePeriod(s string) (span, bool) {
	m := periodPattern.FindStringSubmatch(s)
	if m == nil {
		return span{}, false
	}
	year, _ := strconv.Atoi(m[1])
	if year < 2000 || year > 2999 {
		return span{}, false
	}
	first, months := 1, 12
	switch p := m[2]; {
	case p == "":
	case p[0] == 'Q':
		first, months = 3*int(p[1]-'1')+1, 3
	case p[0] == 'H':
		first, months = 6*int(p[1]-'1')+1, 6
	default:
		first, _ = strconv.Atoi(p)
		months = 1
	}
	from := time.Date(year, time.Month(first), 1, 0, 0, 0, 0, time.UTC)
	next := from.AddDate(0, months, 0)
	return span{Name: s, From: from.Format(time.DateOnly), Last: next.AddDate(0, 0, -1).Format(time.DateOnly),
		Next: next.Format(time.DateOnly)}, true
}

// lastEnded is the name of the latest period of that length that has ended by today (YYYY-MM-DD).
func lastEnded(period, today string) string {
	t, _ := time.Parse(time.DateOnly, today)
	months := map[string]int{"monthly": 1, "quarterly": 3, "half_yearly": 6, "yearly": 12}[period]
	m := int(t.Month()) - 1 // 0-based month of today
	start := time.Date(t.Year(), time.Month(m-m%months+1), 1, 0, 0, 0, 0, time.UTC).AddDate(0, -months, 0)
	switch period {
	case "monthly":
		return start.Format("2006-01")
	case "half_yearly":
		return fmt.Sprintf("%d-H%d", start.Year(), int(start.Month()-1)/6+1)
	case "yearly":
		return strconv.Itoa(start.Year())
	}
	return fmt.Sprintf("%d-Q%d", start.Year(), int(start.Month()-1)/3+1)
}
