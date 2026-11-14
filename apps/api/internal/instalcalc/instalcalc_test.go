package instalcalc

import (
	"reflect"
	"testing"
	"time"

	"helvetly.com/api/internal/invoicecalc"
)

type M = invoicecalc.Money

func sum(ms []M) M {
	var s M
	for _, m := range ms {
		s += m
	}
	return s
}

func TestSplitSumsExactly(t *testing.T) {
	for _, tc := range []struct {
		total    M
		count    int
		currency string
		want     []M
	}{
		{108100, 3, "CHF", []M{36035, 36035, 36030}},
		{100000, 3, "EUR", []M{33333, 33333, 33334}},
		{100000, 3, "CHF", []M{33335, 33335, 33330}},
		{1000, 12, "CHF", []M{85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 65}},
		{1, 2, "EUR", []M{0, 1}},
		{0, 2, "CHF", []M{0, 0}},
	} {
		got := Split(tc.total, tc.count, tc.currency)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("Split(%d, %d, %s) = %v, want %v", tc.total, tc.count, tc.currency, got, tc.want)
		}
		if sum(got) != tc.total {
			t.Errorf("Split(%d, %d, %s) sums to %d", tc.total, tc.count, tc.currency, sum(got))
		}
		if tc.currency == "CHF" && tc.total%5 == 0 {
			for _, m := range got {
				if m%5 != 0 {
					t.Errorf("Split(%d, %d, CHF) has %d, not a 0.05 multiple", tc.total, tc.count, m)
				}
			}
		}
	}
	if got := Split(100, 0, "CHF"); got != nil {
		t.Errorf("Split with count 0 = %v, want nil", got)
	}
}

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func TestDatesClampMonthEnd(t *testing.T) {
	for _, tc := range []struct {
		first    time.Time
		interval string
		count    int
		want     []time.Time
	}{
		{day(2026, 1, 31), "monthly", 3, []time.Time{day(2026, 1, 31), day(2026, 2, 28), day(2026, 3, 31)}},
		{day(2028, 1, 31), "monthly", 4, []time.Time{day(2028, 1, 31), day(2028, 2, 29), day(2028, 3, 31), day(2028, 4, 30)}},
		{day(2026, 11, 30), "quarterly", 3, []time.Time{day(2026, 11, 30), day(2027, 2, 28), day(2027, 5, 30)}},
		{day(2028, 2, 29), "yearly", 2, []time.Time{day(2028, 2, 29), day(2029, 2, 28)}},
		{day(2026, 12, 28), "weekly", 2, []time.Time{day(2026, 12, 28), day(2027, 1, 4)}},
		{day(2026, 3, 1), "biweekly", 3, []time.Time{day(2026, 3, 1), day(2026, 3, 15), day(2026, 3, 29)}},
	} {
		got, err := Dates(tc.first, tc.interval, tc.count)
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Errorf("Dates(%s, %s, %d) = %v, %v, want %v", tc.first.Format(time.DateOnly), tc.interval, tc.count, got, err, tc.want)
		}
	}
}

func TestDatesInvalid(t *testing.T) {
	for _, tc := range []struct {
		interval string
		count    int
	}{
		{"daily", 3}, {"", 3}, {"Monthly", 3}, {"monthly", 1}, {"monthly", 13}, {"weekly", 0}, {"weekly", -2},
	} {
		if _, err := Dates(day(2026, 1, 1), tc.interval, tc.count); err == nil {
			t.Errorf("Dates(%q, %d) succeeded, want an error", tc.interval, tc.count)
		}
	}
}

func TestValidInterval(t *testing.T) {
	for s, want := range map[string]bool{"weekly": true, "biweekly": true, "monthly": true, "quarterly": true, "yearly": true, "daily": false, "": false, "MONTHLY": false} {
		if got := ValidInterval(s); got != want {
			t.Errorf("ValidInterval(%q) = %v, want %v", s, got, want)
		}
	}
}

func TestAllocate(t *testing.T) {
	amounts := []M{36035, 36035, 36030}
	for _, tc := range []struct {
		name              string
		credited, paid    M
		effective, paidTo []M
	}{
		{"none", 0, 0, amounts, []M{0, 0, 0}},
		{"partial payment", 0, 50000, amounts, []M{36035, 13965, 0}},
		{"credit from the end", 40000, 0, []M{36035, 32065, 0}, []M{0, 0, 0}},
		{"credit and payment", 40000, 40000, []M{36035, 32065, 0}, []M{36035, 3965, 0}},
		{"exactly paid", 0, 108100, amounts, amounts},
		{"overpaid", 0, 200000, amounts, amounts},
		{"credit beyond total", 500000, 1000, []M{0, 0, 0}, []M{0, 0, 0}},
		{"credit equals total", 108100, 0, []M{0, 0, 0}, []M{0, 0, 0}},
	} {
		eff, paid := Allocate(amounts, tc.credited, tc.paid)
		if !reflect.DeepEqual(eff, tc.effective) || !reflect.DeepEqual(paid, tc.paidTo) {
			t.Errorf("%s: Allocate = %v, %v, want %v, %v", tc.name, eff, paid, tc.effective, tc.paidTo)
		}
		for i := range eff {
			if eff[i] < 0 || paid[i] < 0 || paid[i] > eff[i] {
				t.Errorf("%s: instalment %d effective %d paid %d", tc.name, i, eff[i], paid[i])
			}
		}
	}
	// the input slice is not modified
	if !reflect.DeepEqual(amounts, []M{36035, 36035, 36030}) {
		t.Errorf("Allocate modified its input: %v", amounts)
	}
}

func TestSplitGroupsMixedRates(t *testing.T) {
	groups := []invoicecalc.Group{
		{Category: "S", Rate: 810, TaxableAmount: 100000, VATAmount: 8100},
		{Category: "R", Rate: 260, TaxableAmount: 1001, VATAmount: 26},
		{Category: "Z", Rate: 0, TaxableAmount: 7},
	}
	got := SplitGroups(groups, 3)
	want := [][]invoicecalc.Group{
		{{Category: "S", Rate: 810, TaxableAmount: 33333}, {Category: "R", Rate: 260, TaxableAmount: 333}, {Category: "Z", Rate: 0, TaxableAmount: 2}},
		{{Category: "S", Rate: 810, TaxableAmount: 33333}, {Category: "R", Rate: 260, TaxableAmount: 333}, {Category: "Z", Rate: 0, TaxableAmount: 2}},
		{{Category: "S", Rate: 810, TaxableAmount: 33334}, {Category: "R", Rate: 260, TaxableAmount: 335}, {Category: "Z", Rate: 0, TaxableAmount: 3}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("SplitGroups = %v, want %v", got, want)
	}
	for g := range groups {
		var s M
		for _, part := range got {
			s += part[g].TaxableAmount
		}
		if s != groups[g].TaxableAmount {
			t.Errorf("group %d sums to %d, want %d", g, s, groups[g].TaxableAmount)
		}
	}
	if SplitGroups(groups, 0) != nil {
		t.Error("SplitGroups with count 0 is not nil")
	}
}

// Rounding every part up to 0.05 must not leave the last instalment negative or empty.
func TestSplitSmallCHFTotals(t *testing.T) {
	for _, tc := range []struct {
		total M
		count int
	}{{50, 12}, {110, 12}, {320, 12}, {20, 5}, {65, 12}, {5, 2}, {100, 12}} {
		got := Split(tc.total, tc.count, "CHF")
		if sum(got) != tc.total {
			t.Errorf("Split(%d, %d) = %v sums to %d", tc.total, tc.count, got, sum(got))
		}
		if last := got[len(got)-1]; last <= 0 {
			t.Errorf("Split(%d, %d) = %v: last instalment %d", tc.total, tc.count, got, last)
		}
		for _, m := range got {
			if m < 0 || m%5 != 0 {
				t.Errorf("Split(%d, %d) = %v: %d is negative or not a 0.05 multiple", tc.total, tc.count, got, m)
			}
		}
	}
}
