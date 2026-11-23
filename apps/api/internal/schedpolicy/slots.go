package schedpolicy

import (
	"slices"
	"time"

	"helvetly.com/api/internal/recur"
)

// MaxDuration is the longest session; conflict queries look back this far from a candidate's start.
const MaxDuration = 24 * time.Hour

// Block is a span of time a host is taken: an open session or an imported busy time.
type Block struct{ Start, End time.Time }

func (b Block) overlaps(start, end time.Time) bool { return b.Start.Before(end) && start.Before(b.End) }

// Window is a weekly availability window in the host's zone.
type Window struct {
	Day        time.Weekday
	Start, End Clock
}

// Override replaces a date's weekly windows: other hours, or the day off when Off.
type Override struct {
	Off        bool
	Start, End Clock
}

// Hours is a host's availability.
type Hours struct {
	Zone      *time.Location
	Weekly    []Window
	Overrides map[recur.Date]Override
}

// windows are the host's available spans on date d.
func (h Hours) windows(d recur.Date, holidays DateSet) []Block {
	if holidays.Has(d) {
		return nil
	}
	if o, ok := h.Overrides[d]; ok {
		if o.Off {
			return nil
		}
		return []Block{{o.Start.on(d, h.Zone), o.End.on(d, h.Zone)}}
	}
	var out []Block
	for _, w := range h.Weekly {
		if w.Day == d.Weekday() {
			out = append(out, Block{w.Start.on(d, h.Zone), w.End.on(d, h.Zone)})
		}
	}
	return out
}

// QueryRange is the span to read a host's sessions and busy times in for conflicts of [start, end): sessions
// last at most MaxDuration, so one that overlaps starts no earlier than start − MaxDuration − buffer.
func QueryRange(start, end time.Time, buffer time.Duration) (from, to time.Time) {
	return start.Add(-MaxDuration - buffer), end.Add(buffer)
}

// SlotQuery describes the free slots to find for one host and event type.
type SlotQuery struct {
	Hours                     Hours
	Holidays                  DateSet
	Duration                  time.Duration
	Step                      time.Duration // 0 = Duration
	BufferBefore, BufferAfter time.Duration
	Now                       time.Time
	MinNotice, Horizon        time.Duration
	From, To                  time.Time // the asked range, clipped to [Now + MinNotice, Now + Horizon]
	Taken                     []Block   // the host's open sessions and busy times
}

// Slots are the free starts, in order: each window stepped from its start, the session inside the window, the
// start within the asked range and the notice and horizon, and the session with its buffers clear of Taken.
func Slots(q SlotQuery) []time.Time {
	if q.Duration <= 0 {
		return nil
	}
	step := q.Step
	if step <= 0 {
		step = q.Duration
	}
	lo, hi := q.From, q.To
	if earliest := q.Now.Add(q.MinNotice); lo.Before(earliest) {
		lo = earliest
	}
	if latest := q.Now.Add(q.Horizon); hi.After(latest) {
		hi = latest
	}
	if !lo.Before(hi) {
		return nil
	}
	var out []time.Time
	last := recur.DateOf(hi.In(q.Hours.Zone))
	// From the day before: a window of that day may run past midnight.
	for d := recur.DateOf(lo.In(q.Hours.Zone)).AddDays(-1); !last.Before(d); d = d.AddDays(1) {
		for _, w := range q.Hours.windows(d, q.Holidays) {
			for t := w.Start; !t.Add(q.Duration).After(w.End); t = t.Add(step) {
				if t.Before(lo) || !t.Before(hi) {
					continue
				}
				if !taken(q.Taken, t.Add(-q.BufferBefore), t.Add(q.Duration+q.BufferAfter)) {
					out = append(out, t)
				}
			}
		}
	}
	slices.SortFunc(out, func(a, b time.Time) int { return a.Compare(b) })
	return slices.CompactFunc(out, time.Time.Equal)
}

func taken(blocks []Block, start, end time.Time) bool {
	for _, b := range blocks {
		if b.overlaps(start, end) {
			return true
		}
	}
	return false
}

// Session is another session of the host.
type Session struct {
	ID, Title  string
	Start, End time.Time
}

type ConflictKind string

const (
	ConflictEvent        ConflictKind = "event"
	ConflictBusy         ConflictKind = "busy"
	ConflictOutsideHours ConflictKind = "outside_hours"
	ConflictHoliday      ConflictKind = "holiday"
)

// Conflict is a warning about a candidate time.
type Conflict struct {
	Kind         ConflictKind
	Start, End   time.Time
	OccurrenceID string // event only
	Title        string // event only; busy times keep no title
}

// Candidate is the time asked about; Exclude is its own occurrence when it is being moved.
type Candidate struct {
	Start, End time.Time
	Exclude    string
}

// Conflicts lists what a candidate collides with: the host's other sessions, busy times, a time outside the
// host's hours (only when the host has hours set) and a workspace holiday (in hours.Zone).
func Conflicts(c Candidate, sessions []Session, busy []Block, hours Hours, holidays DateSet) []Conflict {
	var out []Conflict
	for _, s := range sessions {
		if s.ID != c.Exclude && (Block{s.Start, s.End}).overlaps(c.Start, c.End) {
			out = append(out, Conflict{Kind: ConflictEvent, Start: s.Start, End: s.End, OccurrenceID: s.ID, Title: s.Title})
		}
	}
	for _, b := range busy {
		if b.overlaps(c.Start, c.End) {
			out = append(out, Conflict{Kind: ConflictBusy, Start: b.Start, End: b.End})
		}
	}
	day := recur.DateOf(c.Start.In(hours.Zone))
	if holidays.Has(day) {
		out = append(out, Conflict{Kind: ConflictHoliday, Start: day.At(0, 0).In(hours.Zone), End: day.AddDays(1).At(0, 0).In(hours.Zone)})
	}
	if len(hours.Weekly) > 0 || len(hours.Overrides) > 0 {
		inside := false
		for _, w := range hours.windows(day, nil) {
			inside = inside || !c.Start.Before(w.Start) && !c.End.After(w.End)
		}
		if !inside {
			out = append(out, Conflict{Kind: ConflictOutsideHours, Start: c.Start, End: c.End})
		}
	}
	slices.SortStableFunc(out, func(a, b Conflict) int { return a.Start.Compare(b.Start) })
	return out
}
