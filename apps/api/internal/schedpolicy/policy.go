// Package schedpolicy holds Scheduling's pure rules: cancellation deadlines and their wording, free booking
// slots, conflicts of a session and the Swiss public holidays.
package schedpolicy

import (
	"fmt"
	"slices"
	"time"

	"helvetly.com/api/internal/recur"
)

// Clock is a wall-clock time of day; 24:00 is the end of a day.
type Clock struct{ Hour, Minute int }

// ParseClock reads "HH:MM" (00:00–24:00).
func ParseClock(s string) (Clock, error) {
	var c Clock
	if len(s) != 5 || s[2] != ':' {
		return c, fmt.Errorf("time %q is not HH:MM", s)
	}
	if _, err := fmt.Sscanf(s, "%02d:%02d", &c.Hour, &c.Minute); err != nil ||
		c.Hour > 24 || c.Minute > 59 || c.Hour == 24 && c.Minute != 0 || c.Hour < 0 || c.Minute < 0 {
		return Clock{}, fmt.Errorf("time %q is not HH:MM", s)
	}
	return c, nil
}

func (c Clock) String() string { return fmt.Sprintf("%02d:%02d", c.Hour, c.Minute) }

func (c Clock) on(d recur.Date, zone *time.Location) time.Time {
	return d.At(c.Hour, c.Minute).In(zone)
}

// DateSet is a set of civil dates, such as the workspace holidays. A nil set is empty.
type DateSet map[recur.Date]bool

func (s DateSet) Has(d recur.Date) bool { return s[d] }

// Policy is the cancellation part of the scheduling settings.
type Policy struct {
	NoticeMinutes       int
	Cutoff              *Clock         // nil: the deadline is start − notice
	CutoffDays          []time.Weekday // the days a cut-off falls on
	CutoffSkipsHolidays bool
}

// Deadline is the last moment a cancellation of a session starting at start is on time: start − notice, or with
// a cut-off the latest cut-off moment (a cut-off day at the cut-off time in zone, not a holiday when the policy
// says so) at or before it. A request at or before the deadline is on time.
func Deadline(start time.Time, p Policy, holidays DateSet, zone *time.Location) time.Time {
	base := start.Add(-time.Duration(p.NoticeMinutes) * time.Minute)
	if p.Cutoff == nil {
		return base
	}
	day := recur.DateOf(base.In(zone))
	for range 366 {
		at := p.Cutoff.on(day, zone)
		if !at.After(base) && slices.Contains(p.CutoffDays, day.Weekday()) && !(p.CutoffSkipsHolidays && holidays.Has(day)) {
			return at
		}
		day = day.AddDays(-1)
	}
	return base // no cut-off day in a year: settings validation keeps this from happening
}
