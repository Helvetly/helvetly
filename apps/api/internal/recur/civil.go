package recur

import (
	"fmt"
	"time"
)

// Date is a calendar date with no zone ("2026-12-01").
type Date struct {
	Year  int
	Month time.Month
	Day   int
}

// DateTime is a wall-clock time with no zone ("2026-12-01T09:00").
type DateTime struct {
	Date
	Hour, Minute int
}

// DateOf is t's date in t's own location.
func DateOf(t time.Time) Date {
	y, m, d := t.Date()
	return Date{y, m, d}
}

// ParseDate reads "YYYY-MM-DD".
func ParseDate(s string) (Date, error) {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		return Date{}, fmt.Errorf("date %q: %w", s, err)
	}
	return DateOf(t), nil
}

// ParseDateTime reads "YYYY-MM-DDTHH:MM".
func ParseDateTime(s string) (DateTime, error) {
	t, err := time.Parse("2006-01-02T15:04", s)
	if err != nil {
		return DateTime{}, fmt.Errorf("date-time %q: %w", s, err)
	}
	return DateTime{DateOf(t), t.Hour(), t.Minute()}, nil
}

func (d Date) String() string { return d.utc().Format(time.DateOnly) }

func (d Date) Weekday() time.Weekday { return d.utc().Weekday() }

// AddDays normalises like time.Date (Jan 32 = Feb 1).
func (d Date) AddDays(n int) Date { return Date{d.Year, d.Month, d.Day + n}.normal() }

func (d Date) Before(o Date) bool { return d.utc().Before(o.utc()) }

func (d Date) IsZero() bool { return d == Date{} }

func (d Date) At(hour, minute int) DateTime { return DateTime{d, hour, minute} }

func (d Date) utc() time.Time { return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC) }

func (d Date) normal() Date { return DateOf(d.utc()) }

func (dt DateTime) String() string {
	return fmt.Sprintf("%sT%02d:%02d", dt.Date, dt.Hour, dt.Minute)
}

// In is the instant of the wall-clock time in zone. A time in the spring gap moves forward by the gap
// (02:30 → 03:30); a time that happens twice in autumn is the first, the summer-time instant.
func (dt DateTime) In(zone *time.Location) time.Time {
	wall := time.Date(dt.Year, dt.Month, dt.Day, dt.Hour, dt.Minute, 0, 0, time.UTC)
	// The offsets a day either side; zones change at most once within two days.
	_, before := wall.Add(-24 * time.Hour).In(zone).Zone()
	_, after := wall.Add(24 * time.Hour).In(zone).Zone()
	var found []time.Time
	for _, off := range []int{before, after} {
		t := wall.Add(-time.Duration(off) * time.Second)
		if _, got := t.In(zone).Zone(); got == off {
			found = append(found, t)
		}
	}
	switch {
	case len(found) == 0: // the gap: read with the offset before it, which lands after it
		return wall.Add(-time.Duration(before) * time.Second).In(zone)
	case len(found) == 2 && found[1].Before(found[0]):
		return found[1].In(zone)
	}
	return found[0].In(zone)
}
