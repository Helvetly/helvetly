package dunningcalc

import (
	"testing"

	"helvetly.com/api/internal/invoicecalc"
)

var legacy = []Step{{AfterDue, 10}, {AfterPrevious, 14}, {AfterPrevious, 7}}

func TestDueOn(t *testing.T) {
	steps := []Step{{BeforeDue, 3}, {AfterDue, 10}, {AfterPrevious, 14}}
	for _, c := range []struct {
		name, previous string
		steps          []Step
		next           int
		want           string
	}{
		{"level 1 counts from the due date", "", legacy, 1, "2026-02-10"},
		{"level 2 counts from the first notice", "2026-02-12", legacy, 2, "2026-02-26"},
		{"level 3 counts from the second", "2026-02-27", legacy, 3, "2026-03-06"},
		{"no fourth level", "2026-03-06", legacy, 4, ""},
		{"no level 0", "", legacy, 0, ""},
		{"a note before the due date", "", steps, 1, "2026-01-28"},
		{"after the due date ignores the note sent", "2026-01-28", steps, 2, "2026-02-10"},
		{"after the previous counts from its sending", "2026-02-11", steps, 3, "2026-02-25"},
		{"after the previous, none sent: from the due date", "", steps, 3, "2026-02-14"},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := DueOn("2026-01-31", c.previous, c.steps, c.next); got != c.want {
				t.Fatalf("DueOn = %q, want %q", got, c.want)
			}
		})
	}
}

func TestNext(t *testing.T) {
	steps := []Step{{BeforeDue, 7}, {BeforeDue, 2}, {AfterDue, 10}, {AfterPrevious, 14}}
	for _, c := range []struct {
		name, issued, today string
		last, want          int
	}{
		{"the first note", "2026-01-01", "2026-01-20", 0, 1},
		{"after the first note", "2026-01-01", "2026-01-25", 1, 2},
		{"on the due date notes still go", "2026-01-01", "2026-01-31", 1, 2},
		{"past due: notes are skipped", "2026-01-01", "2026-02-01", 0, 3},
		{"past due after a note", "2026-01-01", "2026-02-05", 1, 3},
		{"a note before issuing is skipped", "2026-01-26", "2026-01-26", 0, 2},
		{"both notes before issuing", "2026-01-30", "2026-01-30", 0, 3},
		{"in order after the due date", "2026-01-01", "2026-03-01", 3, 4},
		{"none left", "2026-01-01", "2026-03-01", 4, 0},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := Next(c.issued, "2026-01-31", c.today, c.last, steps); got != c.want {
				t.Fatalf("Next = %d, want %d", got, c.want)
			}
		})
	}
	if got := Next("2026-01-01", "2026-01-31", "2026-02-01", 1, []Step{{AfterDue, 10}}); got != 0 {
		t.Fatalf("one step sent: %d", got)
	}
}

func TestProblems(t *testing.T) {
	ten := make([]Step, MaxSteps)
	for i := range ten {
		ten[i] = Step{AfterPrevious, 1}
	}
	ten[0] = Step{AfterDue, 1}
	for _, c := range []struct {
		name  string
		steps []Step
		want  []string
	}{
		{"the old three levels", legacy, []string{"", "", ""}},
		{"notes, then reminders", []Step{{BeforeDue, 5}, {BeforeDue, 1}, {AfterDue, 3}, {AfterPrevious, 10}}, []string{"", "", "", ""}},
		{"ten steps", ten, make([]string, MaxSteps)},
		{"first after the previous", []Step{{AfterPrevious, 3}}, []string{"The first reminder counts from the due date."}},
		{"after the previous follows a note", []Step{{BeforeDue, 3}, {AfterPrevious, 5}},
			[]string{"", "Count from the due date after a note before it."}},
		{"a note after a reminder", []Step{{AfterDue, 3}, {BeforeDue, 3}}, []string{"", "Each reminder must come after the one before it."}},
		{"notes out of order", []Step{{BeforeDue, 1}, {BeforeDue, 5}}, []string{"", "Each reminder must come after the one before it."}},
		{"same day twice", []Step{{AfterDue, 10}, {AfterDue, 10}}, []string{"", "Each reminder must come after the one before it."}},
		{"earlier than the one before", []Step{{AfterDue, 3}, {AfterPrevious, 10}, {AfterDue, 12}},
			[]string{"", "", "Each reminder must come after the one before it."}},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := Problems(c.steps)
			for i := range c.want {
				if got[i] != c.want[i] {
					t.Fatalf("Problems = %q, want %q", got, c.want)
				}
			}
		})
	}
	if got := Offsets([]Step{{BeforeDue, 3}, {AfterDue, 10}, {AfterPrevious, 14}}); got[0] != -3 || got[1] != 10 || got[2] != 24 {
		t.Fatalf("Offsets = %v", got)
	}
}

func TestInterestFrom(t *testing.T) {
	for _, c := range []struct {
		name      string
		fromDue   bool
		firstSent string
		want      string
	}{
		{"agreed due date: the day after it", true, "", "2026-02-01"},
		{"agreed due date ignores the notice", true, "2026-02-12", "2026-02-01"},
		{"default by notice: none before the first", false, "", ""},
		{"default by notice: the day after the first", false, "2026-02-12", "2026-02-13"},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := InterestFrom(c.fromDue, "2026-01-31", c.firstSent); got != c.want {
				t.Fatalf("InterestFrom = %q, want %q", got, c.want)
			}
		})
	}
}

func TestDays(t *testing.T) {
	for _, c := range []struct {
		from, on string
		want     int
	}{
		{"2026-02-01", "2026-02-10", 10},
		{"2026-02-01", "2026-02-01", 1},
		{"2026-02-02", "2026-02-01", 0},
		{"", "2026-02-01", 0},
		{"2028-02-28", "2028-03-01", 3}, // leap day counted
		{"2026-03-28", "2026-03-30", 3}, // across the DST change
	} {
		if got := Days(c.from, c.on); got != c.want {
			t.Errorf("Days(%q, %q) = %d, want %d", c.from, c.on, got, c.want)
		}
	}
}

func TestInterest(t *testing.T) {
	for _, c := range []struct {
		name     string
		open     Money
		rate     int64
		days     int
		currency string
		want     Money
	}{
		{"a year at 5 % on 1000.00", 100000, 500, 365, "EUR", 5000},
		{"30 days at 5 % on 1000.00 = 4.109… EUR", 100000, 500, 30, "EUR", 411},
		{"the same in CHF goes to 0.05", 100000, 500, 30, "CHF", 410},
		{"half a cent rounds up", 3650, 500, 1, "EUR", 1}, // 0.5 cent
		{"just under half rounds down", 3649, 500, 1, "EUR", 0},
		{"no rate", 100000, 0, 30, "CHF", 0},
		{"no days", 100000, 500, 0, "CHF", 0},
		{"nothing open", 0, 500, 30, "CHF", 0},
		{"large amounts stay exact", 9_999_999_999_999, 500, 365, "EUR", 500_000_000_000}, // 499'999'999'999.95 cents up
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := Interest(c.open, invoicecalc.Percent(c.rate), c.days, c.currency); got != c.want {
				t.Fatalf("Interest = %d, want %d", got, c.want)
			}
		})
	}
}

func TestNotice(t *testing.T) {
	a := Notice(123455, 2000, 500, "2026-02-01", "2026-03-02", "CHF")
	// 1234.55 × 5 % × 30 / 365 = 5.0735… → 5.05 in CHF
	if a.Days != 30 || a.Interest != 505 || a.Total != 123455+2000+505 {
		t.Fatalf("Notice = %+v", a)
	}
	if a := Notice(50000, 0, 500, "", "2026-03-02", "CHF"); a.Interest != 0 || a.Total != 50000 || a.Days != 0 {
		t.Fatalf("no interest yet: %+v", a)
	}
}
