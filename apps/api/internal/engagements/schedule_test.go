package engagements

import (
	"slices"
	"testing"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

func TestBoundsMonthEndClamp(t *testing.T) {
	for _, c := range []struct {
		n        int
		from, to string
	}{{1, "2026-01-31", "2026-02-27"}, {2, "2026-02-28", "2026-03-30"}, {3, "2026-03-31", "2026-04-29"}} {
		from, to, ok := PeriodBounds("2026-01-31", "monthly", 1, "", c.n)
		if !ok || from != c.from || to != c.to {
			t.Errorf("n=%d: got %s %s %v", c.n, from, to, ok)
		}
	}
}

func TestBoundsCutAtEnd(t *testing.T) {
	cases := []struct {
		start, rec, end string
		n               int
		from, to        string
		ok              bool
	}{
		{"2026-11-01", "none", "2027-01-31", 1, "2026-11-01", "2027-01-31", true},
		{"2026-11-01", "none", "2027-01-31", 2, "", "", false},
		{"2026-11-01", "none", "", 1, "", "", false},
		{"2026-01-01", "quarterly", "2026-05-15", 2, "2026-04-01", "2026-05-15", true},
		{"2026-01-01", "quarterly", "2026-05-15", 3, "", "", false},
		{"2026-01-01", "monthly", "", 0, "", "", false},
		{"2026-01-01", "daily", "", 1, "", "", false},
		{"2026-01-01", "yearly", "", 2, "2027-01-01", "2027-12-31", true},
	}
	for _, c := range cases {
		from, to, ok := PeriodBounds(c.start, c.rec, 1, c.end, c.n)
		if ok != c.ok || from != c.from || to != c.to {
			t.Errorf("%+v: got %s %s %v", c, from, to, ok)
		}
	}
}

func TestBoundsWeeklyInterval2(t *testing.T) {
	from, to, ok := PeriodBounds("2026-11-02", "weekly", 2, "", 2)
	if !ok || from != "2026-11-16" || to != "2026-11-29" {
		t.Errorf("got %s %s %v", from, to, ok)
	}
}

func TestMeasureOpen(t *testing.T) {
	got := Measure(30000, 10000, "2026-11-01", "2026-11-30", "2026-11-16")
	want := Stats{Remaining: 20000, Expected: 16000, State: "open", DaysLeft: 14, ElapsedPct: 53, UnderPace: true, EndingSoon: true}
	if got != want {
		t.Errorf("got %+v", got)
	}
}

func TestMeasureClosedOverage(t *testing.T) {
	got := Measure(8000, 9500, "2026-10-01", "2026-10-31", "2026-11-07")
	want := Stats{Overage: 1500, Expected: 8000, State: "closed", ElapsedPct: 100}
	if got != want {
		t.Errorf("got %+v", got)
	}
}

func TestMeasureUpcoming(t *testing.T) {
	got := Measure(8000, 0, "2026-12-01", "2026-12-31", "2026-11-07")
	want := Stats{Remaining: 8000, State: "upcoming"}
	if got != want {
		t.Errorf("got %+v", got)
	}
}

func TestUnderPaceThreshold(t *testing.T) {
	// 100-day period: 32 days elapsed is below the 33 % gate, 33 days is on it.
	for _, c := range []struct {
		today string
		want  bool
	}{{"2026-02-01", false}, {"2026-02-02", true}} {
		got := Measure(invoicecalc.Quantity(100000), 0, "2026-01-01", "2026-04-10", c.today)
		if got.UnderPace != c.want {
			t.Errorf("%s: %+v", c.today, got)
		}
	}
	// exactly 75 % of expected is not under pace
	if Measure(30000, 12000, "2026-11-01", "2026-11-30", "2026-11-16").UnderPace {
		t.Error("75 % of expected flagged")
	}
}

func TestBoundsLeapAndClampFromStart(t *testing.T) {
	for _, c := range []struct {
		start, rec string
		n          int
		from, to   string
	}{
		{"2024-02-29", "yearly", 2, "2025-02-28", "2026-02-27"},
		{"2024-02-29", "yearly", 5, "2028-02-29", "2029-02-27"},
		{"2024-01-31", "monthly", 2, "2024-02-29", "2024-03-30"},
		{"2024-01-31", "monthly", 3, "2024-03-31", "2024-04-29"},
		{"2026-11-30", "quarterly", 2, "2027-02-28", "2027-05-29"},
		{"2026-11-30", "quarterly", 3, "2027-05-30", "2027-08-29"},
	} {
		from, to, ok := PeriodBounds(c.start, c.rec, 1, "", c.n)
		if !ok || from != c.from || to != c.to {
			t.Errorf("%+v: got %s %s %v", c, from, to, ok)
		}
	}
}

func TestBoundsEndOnPeriodBoundary(t *testing.T) {
	// end on the last day of period 1: period 2 does not exist; end on the first day of period 2: one-day period
	if _, _, ok := PeriodBounds("2026-01-01", "monthly", 1, "2026-01-31", 2); ok {
		t.Error("period after end_date")
	}
	if from, to, ok := PeriodBounds("2026-01-01", "monthly", 1, "2026-02-01", 2); !ok || from != "2026-02-01" || to != "2026-02-01" {
		t.Errorf("%s %s %v", from, to, ok)
	}
}

func TestMeasureBoundaryDays(t *testing.T) {
	first := Measure(31000, 0, "2026-10-01", "2026-10-31", "2026-10-01")
	if first.State != "open" || first.Expected != 1000 || first.DaysLeft != 30 || first.ElapsedPct != 3 {
		t.Errorf("first day %+v", first)
	}
	last := Measure(31000, 0, "2026-10-01", "2026-10-31", "2026-10-31")
	if last.State != "open" || last.Expected != 31000 || last.DaysLeft != 0 || last.ElapsedPct != 100 || !last.EndingSoon {
		t.Errorf("last day %+v", last)
	}
	if after := Measure(31000, 0, "2026-10-01", "2026-10-31", "2026-11-01"); after.State != "closed" || after.EndingSoon || after.UnderPace {
		t.Errorf("day after %+v", after)
	}
	if Measure(31000, 0, "2026-10-01", "2026-10-31", "2026-09-30").State != "upcoming" {
		t.Error("day before")
	}
	// ending soon needs something remaining and at most 14 days left
	if Measure(1000, 1000, "2026-10-01", "2026-10-31", "2026-10-20").EndingSoon || !Measure(1000, 0, "2026-10-01", "2026-10-31", "2026-10-17").EndingSoon || Measure(1000, 0, "2026-10-01", "2026-10-31", "2026-10-16").EndingSoon {
		t.Error("ending_soon threshold")
	}
}

func TestStatusBoundaries(t *testing.T) {
	d := func(s string) *string { return &s }
	for _, c := range []struct {
		e     store.Engagement
		today string
		want  string
	}{
		{store.Engagement{StartDate: "2026-11-08"}, "2026-11-07", "scheduled"},
		{store.Engagement{StartDate: "2026-11-07"}, "2026-11-07", "active"},
		{store.Engagement{StartDate: "2026-01-01", EndDate: d("2026-11-07")}, "2026-11-07", "active"},
		{store.Engagement{StartDate: "2026-01-01", EndDate: d("2026-11-06")}, "2026-11-07", "ended"},
		{store.Engagement{StartDate: "2026-01-01", CancelledOn: d("2026-11-07")}, "2026-11-07", "active"},
		{store.Engagement{StartDate: "2026-01-01", CancelledOn: d("2026-11-06")}, "2026-11-07", "cancelled"},
		{store.Engagement{StartDate: "2026-01-01", EndDate: d("2026-09-01"), CancelledOn: d("2026-10-01")}, "2026-11-07", "ended"},
		{store.Engagement{StartDate: "2026-01-01", EndDate: d("2026-10-01"), CancelledOn: d("2026-09-01")}, "2026-11-07", "cancelled"},
		{store.Engagement{StartDate: "2026-01-01", EndDate: d("2026-11-30"), CancelledOn: d("2026-10-01")}, "2026-11-07", "cancelled"},
	} {
		if got := Status(c.e, c.today); got != c.want {
			t.Errorf("%+v %s: got %s", c.e, c.today, got)
		}
	}
}

func TestCompareEndsRunningFirstThenRecentlyEnded(t *testing.T) {
	view := func(title, status, ends string) EngagementView {
		v := EngagementView{Status: status}
		v.Title = title
		if ends != "" {
			v.CurrentPeriod = &PeriodSummary{EngagementPeriod: store.EngagementPeriod{EndsOn: ends}}
		}
		return v
	}
	list := []EngagementView{
		view("old", "ended", "2026-01-31"),
		view("late", "active", "2026-12-31"),
		view("recent", "cancelled", "2026-10-31"),
		view("soon", "active", "2026-11-30"),
		view("next", "scheduled", ""),
	}
	slices.SortStableFunc(list, func(a, b EngagementView) int { return compare("ends", a, b) })
	var got []string
	for _, v := range list {
		got = append(got, v.Title)
	}
	if want := []string{"soon", "late", "next", "recent", "old"}; !slices.Equal(got, want) {
		t.Fatalf("order %v, want %v", got, want)
	}
}
