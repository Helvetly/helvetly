// Package recur expands Helvetly's recurrence rules, a strict subset of RFC 5545 RRULE: FREQ=WEEKLY (INTERVAL,
// BYDAY) and FREQ=MONTHLY (BYMONTHDAY incl. -1, or one BYDAY with BYSETPOS), ended by UNTIL or COUNT. It never
// reads foreign rules.
package recur

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
)

type Freq string

const (
	Weekly  Freq = "weekly"
	Monthly Freq = "monthly"
)

// MaxOccurrences caps a series (weekly for ten years).
const MaxOccurrences = 520

// SetPos is "the Nth weekday of the month": Pos 1–4, or -1 for the last.
type SetPos struct {
	Pos int
	Day time.Weekday
}

// Rule is a series' recurrence. Weekly with no ByDay repeats on the first start's weekday; monthly with neither
// ByMonthDay nor BySetPos on the first start's day of the month.
type Rule struct {
	Freq       Freq
	Interval   int // 1–12; 0 reads as 1
	ByDay      []time.Weekday
	ByMonthDay int // 1–31 or -1 (the last day); months without that day are skipped
	BySetPos   *SetPos
	Until      *Date // inclusive, in the series' zone
	Count      int   // 1–520; 0 = none
}

// Validate checks a rule from a trust boundary.
func (r Rule) Validate() error {
	if r.Interval < 0 || r.Interval > 12 {
		return errors.New("interval must be 1–12")
	}
	if r.Count < 0 || r.Count > MaxOccurrences {
		return fmt.Errorf("count must be 1–%d", MaxOccurrences)
	}
	if r.Count > 0 && r.Until != nil {
		return errors.New("until and count cannot both be set")
	}
	switch r.Freq {
	case Weekly:
		if r.ByMonthDay != 0 || r.BySetPos != nil {
			return errors.New("weekly rules take only by_day")
		}
		if hasDuplicate(r.ByDay) {
			return errors.New("by_day repeats a day")
		}
		for _, d := range r.ByDay {
			if d < time.Sunday || d > time.Saturday {
				return errors.New("by_day has an unknown day")
			}
		}
	case Monthly:
		if len(r.ByDay) > 0 {
			return errors.New("monthly rules take by_month_day or by_set_pos")
		}
		if r.ByMonthDay != 0 && r.BySetPos != nil {
			return errors.New("by_month_day and by_set_pos cannot both be set")
		}
		if r.ByMonthDay < -1 || r.ByMonthDay > 31 {
			return errors.New("by_month_day must be 1–31 or -1")
		}
		if p := r.BySetPos; p != nil {
			if p.Pos < -1 || p.Pos > 4 || p.Pos == 0 {
				return errors.New("by_set_pos must be 1–4 or -1")
			}
			if p.Day < time.Sunday || p.Day > time.Saturday {
				return errors.New("by_set_pos has an unknown day")
			}
		}
	default:
		return fmt.Errorf("unknown freq %q", r.Freq)
	}
	return nil
}

// Expand returns the series' starts in [from, to): each matching date on or after start's date, at start's
// wall-clock time in zone (see DateTime.In). Dates for which skip answers true are left out and do not count
// towards Count, as EXDATE does not. Like Count, max caps the series from its first occurrence, not the window,
// so extending a window never makes more than max in all. The rule must be valid.
func Expand(r Rule, start DateTime, zone *time.Location, skip func(Date) bool, from, to time.Time, max int) []time.Time {
	limit := max
	if r.Count > 0 && r.Count < limit {
		limit = r.Count
	}
	var out []time.Time
	made := 0
	r.eachDate(start.Date, func(d Date, real bool) bool {
		if r.Until != nil && r.Until.Before(d) {
			return false
		}
		t := d.At(start.Hour, start.Minute).In(zone)
		if !t.Before(to) || made >= limit {
			return false
		}
		if !real || skip != nil && skip(d) {
			return true
		}
		made++
		if !t.Before(from) {
			out = append(out, t)
		}
		return true
	})
	return out
}

// eachDate calls yield with the rule's dates on or after first, in order, until it answers false. A month
// without the rule's day yields its first day as not real, so the caller's bounds still end the loop.
func (r Rule) eachDate(first Date, yield func(d Date, real bool) bool) {
	step := max(r.Interval, 1)
	if r.Freq == Weekly {
		days := r.ByDay
		if len(days) == 0 {
			days = []time.Weekday{first.Weekday()}
		}
		offsets := make([]int, len(days)) // from Monday: weeks start on Monday (WKST=MO)
		for i, d := range days {
			offsets[i] = (int(d) + 6) % 7
		}
		slices.Sort(offsets)
		monday := first.AddDays(-(int(first.Weekday()) + 6) % 7)
		for week := 0; ; week += step {
			for _, off := range offsets {
				d := monday.AddDays(week*7 + off)
				if d.Before(first) {
					continue
				}
				if !yield(d, true) {
					return
				}
			}
		}
	}
	monthDay := r.ByMonthDay
	if monthDay == 0 && r.BySetPos == nil {
		monthDay = first.Day
	}
	for m := 0; ; m += step {
		month := Date{first.Year, first.Month + time.Month(m), 1}.normal()
		d, ok := r.monthDate(month, monthDay)
		if !ok || d.Before(first) {
			d, ok = month, false
		}
		if !yield(d, ok) {
			return
		}
	}
}

// monthDate is the rule's date in the month starting at firstOfMonth.
func (r Rule) monthDate(firstOfMonth Date, monthDay int) (Date, bool) {
	last := firstOfMonth.AddDays(31).AddDays(-firstOfMonth.AddDays(31).Day)
	if p := r.BySetPos; p != nil {
		if p.Pos == -1 {
			return last.AddDays(-(int(last.Weekday()) - int(p.Day) + 7) % 7), true
		}
		d := firstOfMonth.AddDays((int(p.Day)-int(firstOfMonth.Weekday())+7)%7 + 7*(p.Pos-1))
		return d, true // the 4th always exists
	}
	if monthDay == -1 {
		return last, true
	}
	if monthDay > last.Day {
		return Date{}, false
	}
	return Date{firstOfMonth.Year, firstOfMonth.Month, monthDay}, true
}

var dayCodes = []string{"SU", "MO", "TU", "WE", "TH", "FR", "SA"}

// RRULE is the rule as an RFC 5545 RRULE value. UNTIL is the end of the until date in zone, in UTC, as RFC 5545
// requires next to a DTSTART with TZID.
func RRULE(r Rule, zone *time.Location) string {
	parts := []string{"FREQ=" + strings.ToUpper(string(r.Freq))}
	if r.Interval > 1 {
		parts = append(parts, "INTERVAL="+strconv.Itoa(r.Interval))
	}
	if len(r.ByDay) > 0 {
		codes := make([]string, len(r.ByDay))
		for i, d := range r.ByDay {
			codes[i] = dayCodes[d]
		}
		parts = append(parts, "BYDAY="+strings.Join(codes, ","))
	}
	if r.ByMonthDay != 0 {
		parts = append(parts, "BYMONTHDAY="+strconv.Itoa(r.ByMonthDay))
	}
	if p := r.BySetPos; p != nil {
		parts = append(parts, "BYDAY="+dayCodes[p.Day], "BYSETPOS="+strconv.Itoa(p.Pos))
	}
	if r.Until != nil {
		end := time.Date(r.Until.Year, r.Until.Month, r.Until.Day, 23, 59, 59, 0, zone)
		parts = append(parts, "UNTIL="+end.UTC().Format("20060102T150405Z"))
	}
	if r.Count > 0 {
		parts = append(parts, "COUNT="+strconv.Itoa(r.Count))
	}
	return strings.Join(parts, ";")
}

// Parse reads a rule written by RRULE (zone gives UNTIL back as a date) and refuses anything outside the subset.
func Parse(s string, zone *time.Location) (Rule, error) {
	var r Rule
	var days []time.Weekday
	setPos := 0
	seen := map[string]bool{}
	for part := range strings.SplitSeq(s, ";") {
		key, value, ok := strings.Cut(part, "=")
		if !ok || seen[key] {
			return Rule{}, fmt.Errorf("rrule part %q", part)
		}
		seen[key] = true
		var err error
		switch key {
		case "FREQ":
			r.Freq = Freq(strings.ToLower(value))
		case "INTERVAL":
			r.Interval, err = strconv.Atoi(value)
		case "BYDAY":
			for code := range strings.SplitSeq(value, ",") {
				i := slices.Index(dayCodes, code)
				if i < 0 {
					return Rule{}, fmt.Errorf("rrule day %q", code)
				}
				days = append(days, time.Weekday(i))
			}
		case "BYMONTHDAY":
			r.ByMonthDay, err = strconv.Atoi(value)
		case "BYSETPOS":
			setPos, err = strconv.Atoi(value)
		case "UNTIL":
			var t time.Time
			t, err = time.Parse("20060102T150405Z", value)
			d := DateOf(t.In(zone))
			r.Until = &d
		case "COUNT":
			r.Count, err = strconv.Atoi(value)
		default:
			return Rule{}, fmt.Errorf("rrule part %q is not supported", key)
		}
		if err != nil {
			return Rule{}, fmt.Errorf("rrule %s: %w", key, err)
		}
	}
	if setPos != 0 {
		if len(days) != 1 {
			return Rule{}, errors.New("rrule BYSETPOS needs one BYDAY")
		}
		r.BySetPos = &SetPos{setPos, days[0]}
	} else {
		r.ByDay = days
	}
	if r.Interval == 0 && seen["INTERVAL"] {
		return Rule{}, errors.New("interval must be 1–12")
	}
	return r, r.Validate()
}

func hasDuplicate(days []time.Weekday) bool {
	seen := map[time.Weekday]bool{}
	for _, d := range days {
		if seen[d] {
			return true
		}
		seen[d] = true
	}
	return false
}
