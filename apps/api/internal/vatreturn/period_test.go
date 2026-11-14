package vatreturn

import "testing"

func TestParsePeriod(t *testing.T) {
	for _, c := range []struct {
		in               string
		from, last, next string
	}{
		{"2026-Q3", "2026-07-01", "2026-09-30", "2026-10-01"},
		{"2026-Q4", "2026-10-01", "2026-12-31", "2027-01-01"},
		{"2026-H1", "2026-01-01", "2026-06-30", "2026-07-01"},
		{"2024-02", "2024-02-01", "2024-02-29", "2024-03-01"},
		{"2026", "2026-01-01", "2026-12-31", "2027-01-01"},
	} {
		s, ok := parsePeriod(c.in)
		if !ok || s.From != c.from || s.Last != c.last || s.Next != c.next {
			t.Errorf("parsePeriod(%q) = %+v %v", c.in, s, ok)
		}
	}
	for _, bad := range []string{"", "2026-Q5", "2026-H3", "2026-13", "2026-7", "26-Q1", "1999", "2026-q1"} {
		if _, ok := parsePeriod(bad); ok {
			t.Errorf("parsePeriod(%q) accepted", bad)
		}
	}
}

func TestLastEnded(t *testing.T) {
	for _, c := range []struct{ period, today, want string }{
		{"quarterly", "2026-11-09", "2026-Q3"},
		{"quarterly", "2026-01-01", "2025-Q4"},
		{"half_yearly", "2026-11-09", "2026-H1"},
		{"half_yearly", "2026-03-01", "2025-H2"},
		{"monthly", "2026-01-15", "2025-12"},
		{"monthly", "2026-11-09", "2026-10"},
		{"yearly", "2026-11-09", "2025"},
	} {
		if got := lastEnded(c.period, c.today); got != c.want {
			t.Errorf("lastEnded(%s, %s) = %s, want %s", c.period, c.today, got, c.want)
		}
	}
}
