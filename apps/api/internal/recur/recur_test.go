package recur

import (
	"strings"
	"testing"
	"time"
)

func zone(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func dt(t *testing.T, s string) DateTime {
	t.Helper()
	v, err := ParseDateTime(s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func date(t *testing.T, s string) *Date {
	t.Helper()
	v, err := ParseDate(s)
	if err != nil {
		t.Fatal(err)
	}
	return &v
}

func TestIn(t *testing.T) {
	for _, c := range []struct{ name, zone, local, want string }{
		{"winter", "Europe/Zurich", "2026-12-01T09:00", "2026-12-01T08:00:00Z"},
		{"summer", "Europe/Zurich", "2026-07-01T09:00", "2026-07-01T07:00:00Z"},
		{"spring gap moves forward", "Europe/Zurich", "2027-03-28T02:30", "2027-03-28T01:30:00Z"},
		{"autumn overlap takes the first", "Europe/Zurich", "2027-10-31T02:30", "2027-10-31T00:30:00Z"},
		{"New York gap", "America/New_York", "2027-03-14T02:15", "2027-03-14T07:15:00Z"},
		{"New York overlap", "America/New_York", "2027-11-07T01:30", "2027-11-07T05:30:00Z"},
		{"UTC", "UTC", "2027-01-01T00:00", "2027-01-01T00:00:00Z"},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := dt(t, c.local).In(zone(t, c.zone)).UTC().Format(time.RFC3339); got != c.want {
				t.Fatalf("In = %s, want %s", got, c.want)
			}
		})
	}
}

func TestCivil(t *testing.T) {
	if _, err := ParseDate("2026-13-01"); err == nil {
		t.Fatal("bad date read")
	}
	if _, err := ParseDateTime("2026-12-01 09:00"); err == nil {
		t.Fatal("bad date-time read")
	}
	if got := dt(t, "2026-12-31T23:05").String(); got != "2026-12-31T23:05" {
		t.Fatalf("String = %s", got)
	}
	d := *date(t, "2026-12-31")
	if got := d.AddDays(1).String(); got != "2027-01-01" {
		t.Fatalf("AddDays = %s", got)
	}
	if d.IsZero() || !(Date{}).IsZero() {
		t.Fatal("IsZero")
	}
	if got := DateOf(time.Date(2026, 3, 1, 23, 0, 0, 0, time.UTC)); got != (Date{2026, 3, 1}) {
		t.Fatalf("DateOf = %v", got)
	}
}

func TestExpand(t *testing.T) {
	zurich := zone(t, "Europe/Zurich")
	ny := zone(t, "America/New_York")
	from := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2040, 1, 1, 0, 0, 0, 0, time.UTC)
	holiday := func(days ...string) func(Date) bool {
		return func(d Date) bool {
			for _, s := range days {
				if d.String() == s {
					return true
				}
			}
			return false
		}
	}
	for _, c := range []struct {
		name  string
		rule  Rule
		start string
		zone  *time.Location
		skip  func(Date) bool
		from  time.Time
		to    time.Time
		max   int
		want  string // local starts in zone, comma separated
	}{
		{
			name: "weekly on the start's day across summer time", start: "2027-03-22T09:00", zone: zurich,
			rule: Rule{Freq: Weekly, Count: 3},
			want: "2027-03-22T09:00+01,2027-03-29T09:00+02,2027-04-05T09:00+02",
		},
		{
			name: "weekly Tue and Thu, start on Wed skips Tue of the first week", start: "2026-12-02T18:00", zone: zurich,
			rule: Rule{Freq: Weekly, ByDay: []time.Weekday{time.Thursday, time.Tuesday}, Count: 4},
			want: "2026-12-03T18:00+01,2026-12-08T18:00+01,2026-12-10T18:00+01,2026-12-15T18:00+01",
		},
		{
			name: "every 2 weeks until inclusive", start: "2026-12-01T10:00", zone: zurich,
			rule: Rule{Freq: Weekly, Interval: 2, Until: date(t, "2026-12-29")},
			want: "2026-12-01T10:00+01,2026-12-15T10:00+01,2026-12-29T10:00+01",
		},
		{
			name: "every 2 weeks, Sunday start keeps its week", start: "2026-12-06T10:00", zone: zurich,
			rule: Rule{Freq: Weekly, Interval: 2, ByDay: []time.Weekday{time.Monday, time.Sunday}, Count: 3},
			want: "2026-12-06T10:00+01,2026-12-14T10:00+01,2026-12-20T10:00+01",
		},
		{
			name: "spring gap in New York moves forward", start: "2027-03-07T02:30", zone: ny,
			rule: Rule{Freq: Weekly, Count: 3},
			want: "2027-03-07T02:30-05,2027-03-14T03:30-04,2027-03-21T02:30-04",
		},
		{
			name: "autumn overlap in Zurich is the first", start: "2027-10-24T02:30", zone: zurich,
			rule: Rule{Freq: Weekly, Count: 2},
			want: "2027-10-24T02:30+02,2027-10-31T02:30+02",
		},
		{
			name: "monthly on the 31st skips short months", start: "2027-01-31T09:00", zone: zurich,
			rule: Rule{Freq: Monthly, Count: 4},
			want: "2027-01-31T09:00+01,2027-03-31T09:00+02,2027-05-31T09:00+02,2027-07-31T09:00+02",
		},
		{
			name: "monthly on the last day", start: "2027-01-15T09:00", zone: zurich,
			rule: Rule{Freq: Monthly, ByMonthDay: -1, Count: 3},
			want: "2027-01-31T09:00+01,2027-02-28T09:00+01,2027-03-31T09:00+02",
		},
		{
			name: "monthly on a day before the start begins next month", start: "2027-01-20T09:00", zone: zurich,
			rule: Rule{Freq: Monthly, ByMonthDay: 5, Count: 2},
			want: "2027-02-05T09:00+01,2027-03-05T09:00+01",
		},
		{
			name: "the last Friday", start: "2027-01-01T16:00", zone: zurich,
			rule: Rule{Freq: Monthly, BySetPos: &SetPos{-1, time.Friday}, Count: 3},
			want: "2027-01-29T16:00+01,2027-02-26T16:00+01,2027-03-26T16:00+01",
		},
		{
			name: "the 2nd Tuesday every 3 months", start: "2027-01-01T08:00", zone: zurich,
			rule: Rule{Freq: Monthly, Interval: 3, BySetPos: &SetPos{2, time.Tuesday}, Count: 3},
			want: "2027-01-12T08:00+01,2027-04-13T08:00+02,2027-07-13T08:00+02",
		},
		{
			name: "the 1st Monday on the 1st", start: "2027-02-01T08:00", zone: zurich,
			rule: Rule{Freq: Monthly, BySetPos: &SetPos{1, time.Monday}, Count: 2},
			want: "2027-02-01T08:00+01,2027-03-01T08:00+01",
		},
		{
			name: "skipped holidays do not count towards count", start: "2026-12-21T09:00", zone: zurich,
			rule: Rule{Freq: Weekly, ByDay: []time.Weekday{time.Friday}, Count: 3},
			skip: holiday("2026-12-25", "2027-01-01"),
			want: "2027-01-08T09:00+01,2027-01-15T09:00+01,2027-01-22T09:00+01",
		},
		{
			name: "the window keeps the count from the first occurrence", start: "2026-12-01T09:00", zone: zurich,
			rule: Rule{Freq: Weekly, Count: 3},
			from: time.Date(2026, 12, 8, 0, 0, 0, 0, time.UTC), to: time.Date(2026, 12, 16, 0, 0, 0, 0, time.UTC),
			want: "2026-12-08T09:00+01,2026-12-15T09:00+01",
		},
		{
			name: "no end stops at the window", start: "2026-12-01T09:00", zone: zurich,
			rule: Rule{Freq: Weekly},
			to:   time.Date(2026, 12, 15, 8, 0, 0, 0, time.UTC),
			want: "2026-12-01T09:00+01,2026-12-08T09:00+01",
		},
		{
			name: "max caps the series", start: "2026-12-01T09:00", zone: zurich,
			rule: Rule{Freq: Weekly, Count: 10}, max: 2,
			want: "2026-12-01T09:00+01,2026-12-08T09:00+01",
		},
		{
			name: "a day that never comes ends with the window", start: "2027-02-01T09:00", zone: zurich,
			rule: Rule{Freq: Monthly, Interval: 12, ByMonthDay: 30},
			to:   time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC), want: "",
		},
		{
			name: "until before the first", start: "2027-02-01T09:00", zone: zurich,
			rule: Rule{Freq: Weekly, Until: date(t, "2027-01-01")}, want: "",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			f, e, m := c.from, c.to, c.max
			if f.IsZero() {
				f = from
			}
			if e.IsZero() {
				e = to
			}
			if m == 0 {
				m = MaxOccurrences
			}
			var got []string
			for _, at := range Expand(c.rule, dt(t, c.start), c.zone, c.skip, f, e, m) {
				got = append(got, at.In(c.zone).Format("2006-01-02T15:04-07"))
			}
			if s := strings.Join(got, ","); s != c.want {
				t.Fatalf("Expand =\n%s\nwant\n%s", s, c.want)
			}
		})
	}
}

func TestExpandCapsAt520(t *testing.T) {
	got := Expand(Rule{Freq: Weekly}, dt(t, "2026-01-05T09:00"), time.UTC, nil,
		time.Time{}, time.Date(2050, 1, 1, 0, 0, 0, 0, time.UTC), MaxOccurrences)
	if len(got) != MaxOccurrences {
		t.Fatalf("got %d occurrences, want %d", len(got), MaxOccurrences)
	}
}

func TestRRULERoundTrip(t *testing.T) {
	zurich := zone(t, "Europe/Zurich")
	for _, c := range []struct {
		name string
		rule Rule
		want string
	}{
		{"weekly", Rule{Freq: Weekly}, "FREQ=WEEKLY"},
		{"every 2 weeks on days until", Rule{Freq: Weekly, Interval: 2, ByDay: []time.Weekday{time.Tuesday, time.Thursday},
			Until: date(t, "2027-06-30")}, "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20270630T215959Z"},
		{"winter until", Rule{Freq: Weekly, Until: date(t, "2027-01-31")}, "FREQ=WEEKLY;UNTIL=20270131T225959Z"},
		{"monthly last day count", Rule{Freq: Monthly, ByMonthDay: -1, Count: 12}, "FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=12"},
		{"monthly last Friday", Rule{Freq: Monthly, BySetPos: &SetPos{-1, time.Friday}}, "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1"},
		{"monthly 2nd Sunday", Rule{Freq: Monthly, Interval: 3, BySetPos: &SetPos{2, time.Sunday}},
			"FREQ=MONTHLY;INTERVAL=3;BYDAY=SU;BYSETPOS=2"},
	} {
		t.Run(c.name, func(t *testing.T) {
			s := RRULE(c.rule, zurich)
			if s != c.want {
				t.Fatalf("RRULE = %s, want %s", s, c.want)
			}
			back, err := Parse(s, zurich)
			if err != nil {
				t.Fatal(err)
			}
			if RRULE(back, zurich) != s || (back.Until == nil) != (c.rule.Until == nil) ||
				back.Until != nil && *back.Until != *c.rule.Until {
				t.Fatalf("Parse(%s) = %+v", s, back)
			}
		})
	}
}

func TestParseRefuses(t *testing.T) {
	for _, s := range []string{
		"FREQ=DAILY",
		"FREQ=YEARLY",
		"FREQ=WEEKLY;BYHOUR=9",
		"FREQ=WEEKLY;FREQ=WEEKLY",
		"FREQ=WEEKLY;INTERVAL",
		"FREQ=WEEKLY;INTERVAL=x",
		"FREQ=WEEKLY;INTERVAL=0",
		"FREQ=WEEKLY;INTERVAL=13",
		"FREQ=WEEKLY;BYDAY=XX",
		"FREQ=WEEKLY;BYDAY=MO,MO",
		"FREQ=WEEKLY;COUNT=521",
		"FREQ=WEEKLY;COUNT=2;UNTIL=20270101T000000Z",
		"FREQ=WEEKLY;UNTIL=2027-01-01",
		"FREQ=MONTHLY;BYDAY=MO",
		"FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=1",
		"FREQ=MONTHLY;BYDAY=MO;BYSETPOS=5",
		"FREQ=MONTHLY;BYMONTHDAY=32",
		"FREQ=MONTHLY;BYMONTHDAY=1;BYDAY=MO;BYSETPOS=1",
		"FREQ=WEEKLY;BYMONTHDAY=1",
	} {
		if r, err := Parse(s, time.UTC); err == nil {
			t.Errorf("Parse(%s) = %+v, want an error", s, r)
		}
	}
}

func TestValidate(t *testing.T) {
	for _, c := range []struct {
		name string
		rule Rule
	}{
		{"negative interval", Rule{Freq: Weekly, Interval: -1}},
		{"negative count", Rule{Freq: Weekly, Count: -1}},
		{"weekly unknown day", Rule{Freq: Weekly, ByDay: []time.Weekday{7}}},
		{"weekly set pos", Rule{Freq: Weekly, BySetPos: &SetPos{1, time.Monday}}},
		{"monthly by day", Rule{Freq: Monthly, ByDay: []time.Weekday{time.Monday}}},
		{"monthly -2", Rule{Freq: Monthly, ByMonthDay: -2}},
		{"set pos unknown day", Rule{Freq: Monthly, BySetPos: &SetPos{1, -1}}},
		{"set pos 0", Rule{Freq: Monthly, BySetPos: &SetPos{0, time.Monday}}},
		{"no freq", Rule{}},
	} {
		if err := c.rule.Validate(); err == nil {
			t.Errorf("%s: no error", c.name)
		}
	}
}
