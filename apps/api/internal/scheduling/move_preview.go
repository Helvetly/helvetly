package scheduling

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/recur"
	"helvetly.com/api/internal/schedpolicy"
	"helvetly.com/api/internal/store"
)

// Why a session of a series does not simply go along when the series moves (MoveItem.Reason).
const (
	reasonStarted        = "started"         // started or taken place: keeps its time
	reasonClosed         = "closed"          // attended, no-show or invoiced
	reasonException      = "exception"       // changed on its own: keeps its time unless included
	reasonDayOff         = "day_off"         // its new day is a day off (moved there, or cancelled when the series skips them)
	reasonOutsideSeries  = "outside_series"  // its new day is past the series' end: cancelled
	reasonRequestPending = "request_pending" // the client asked something about it that is still open
	reasonConflict       = "conflict"        // the host is busy at the new time: a warning
	reasonMonthlyRule    = "monthly_rule"    // the rule repeats on a day of the month, which cannot move by days
)

// What the person decided for a session a series move lists (decisions, by occurrence id).
const (
	decideKeep       = "keep"        // stays where it is, off the rule
	decideSkip       = "skip"        // cancelled on time (the business's change)
	decideMoveAnyway = "move_anyway" // goes to its new time all the same, a day off or a conflict there
	decideWithSeries = "with_series" // changed on its own, it moves with the others all the same
	decideMoveTo     = "move_to"     // goes to a time of the person's own (move_to:<RFC 3339 instant>)
)

type decision struct {
	kind string
	at   time.Time // move_to
}

// moveChoices are the person's decisions for the sessions a series move cannot simply take along.
type moveChoices struct {
	decisions map[string]decision
	dryRun    bool // only the preview: the edit is rolled back and nothing outside the database is asked
}

var choiceFields = []string{"dry_run", "decisions"}

func (s *Service) choicesOf(body map[string]json.RawMessage) (moveChoices, error) {
	ch := moveChoices{dryRun: flagOf(body, "dry_run"), decisions: map[string]decision{}}
	f := form{}
	if raw, ok := body["decisions"]; ok {
		var given map[string]string
		if json.Unmarshal(raw, &given) != nil || len(given) > 1000 {
			f.fail("decisions", "Send a decision for each session: keep, skip, move_anyway, with_series or move_to:<time>.")
		}
		for id, v := range given {
			kind, at, _ := strings.Cut(v, ":")
			d := decision{kind: kind}
			switch kind {
			case decideKeep, decideSkip, decideMoveAnyway, decideWithSeries:
				if at != "" {
					f.fail("decisions", "Unknown decision "+v+".")
				}
			case decideMoveTo:
				t, err := time.Parse(time.RFC3339, at)
				if err != nil {
					f.fail("decisions", "Enter a time such as move_to:2026-12-01T09:00:00Z.")
				} else if !t.After(s.now()) {
					f.fail("decisions", "Pick a time that has not passed.")
				}
				d.at = t.UTC()
			default:
				f.fail("decisions", "Unknown decision "+v+".")
			}
			ch.decisions[id] = d
		}
	}
	for _, k := range choiceFields {
		delete(body, k)
	}
	return ch, f.err()
}

// pin moves the session the person dragged to where it was dropped, whatever it was before (changed on its own
// too), unless they decided otherwise for it.
func (ch *moveChoices) pin(id string, at time.Time) {
	if _, ok := ch.decisions[id]; !ok {
		ch.decisions[id] = decision{kind: decideMoveTo, at: at}
	}
}

// MovePreview is what a series edit would do (dry_run): how many sessions move, the first few, and the sessions that
// do not simply go along, each with its reason.
type MovePreview struct {
	Moving int        `json:"moving"`
	Sample []MoveItem `json:"sample"`
	Items  []MoveItem `json:"items"`
}

type MoveItem struct {
	OccurrenceID string     `json:"occurrence_id"`
	StartsAt     time.Time  `json:"starts_at"`
	EndsAt       time.Time  `json:"ends_at"`
	MovesTo      *time.Time `json:"moves_to"` // its new start by the rule (whether or not it goes there), null when it has none
	Status       string     `json:"status"`
	Reason       string     `json:"reason"`
	Moves        bool       `json:"moves"`             // a warning: it moves unless decided otherwise
	DayOff       string     `json:"day_off,omitempty"` // the day off's name
	Conflicts    []Conflict `json:"conflicts,omitempty"`
}

// errDryRun rolls a previewed edit back.
var errDryRun = errors.New("dry run")

const sampleSize = 3

// preview compares the series' rows before an edit (before, the event's rows when it began) with what they are now,
// inside the edit's transaction. o is the session the edit was made on, at from on ("following"); only sessions that
// have not ended count.
func (s *Service) preview(ctx context.Context, q store.Q, ws store.Workspace, o store.SchedOccurrence, before []store.SchedOccurrence,
	following bool, ed edit) (MovePreview, error) {
	out := MovePreview{Sample: []MoveItem{}, Items: []MoveItem{}}
	list, err := q.SchedulingHolidays(ctx, ws.ID, "", "")
	if err != nil {
		return out, err
	}
	dayOff := map[string]string{}
	for _, h := range list {
		dayOff[h.Day] = h.Name
	}
	dayOffAt := func(t time.Time) string { return dayOff[recur.DateOf(t.In(ws.Location())).String()] }
	now := s.now()
	for _, b := range before {
		if !b.EndsAt.After(now) || following && b.OriginalStart.Before(o.OriginalStart) ||
			b.Status == store.SchedCancelledOnTime || b.Status == store.SchedCancelledLate || b.Status == store.SchedDeclined {
			continue
		}
		item := MoveItem{OccurrenceID: b.ID, StartsAt: b.StartsAt, EndsAt: b.EndsAt, Status: b.Status}
		a, err := q.SchedOccurrence(ctx, ws.ID, b.ID, false)
		if err != nil {
			return out, err
		}
		switch {
		case !isOpen(b.Status):
			item.Reason = reasonClosed
		case s.timeLocked(b):
			item.Reason = reasonStarted
		case !isOpen(a.Status):
			item.Reason = reasonOutsideSeries
			if to, ok := ed.proposed[b.ID]; ok {
				item.MovesTo, item.DayOff = &to, dayOffAt(to)
				if item.DayOff != "" {
					item.Reason = reasonDayOff
				}
				if item.Conflicts, err = s.moveConflicts(ctx, q, ws, a, to); err != nil {
					return out, err
				}
			}
		case a.StartsAt.Equal(b.StartsAt):
			if to, ok := ed.proposed[b.ID]; ok && b.IsException && !to.Equal(b.StartsAt) {
				item.Reason, item.MovesTo = reasonException, &to
				if item.Conflicts, err = s.moveConflicts(ctx, q, ws, a, to); err != nil {
					return out, err
				}
			}
		default:
			to := a.StartsAt
			item.MovesTo, item.Moves = &to, true
			out.Moving++
			if len(out.Sample) < sampleSize {
				out.Sample = append(out.Sample, item)
			}
			if item.Reason, item.Conflicts, err = s.moveWarning(ctx, q, ws, a, dayOffAt(a.StartsAt)); err != nil {
				return out, err
			}
			if item.Reason == reasonDayOff {
				item.DayOff = dayOffAt(a.StartsAt)
			}
		}
		if item.Reason != "" {
			out.Items = append(out.Items, item)
		}
	}
	return out, nil
}

// moveWarning is why a session that moves deserves a look, "" for none: the day off it lands on, a request of the
// client still open, someone busy then (with what).
func (s *Service) moveWarning(ctx context.Context, q store.Q, ws store.Workspace, a store.SchedOccurrence, dayOff string) (string, []Conflict, error) {
	cs, err := s.moveConflicts(ctx, q, ws, a, a.StartsAt)
	if err != nil {
		return "", nil, err
	}
	if dayOff != "" {
		return reasonDayOff, cs, nil
	}
	if _, err := q.OpenSchedRequest(ctx, ws.ID, a.ID); err == nil {
		return reasonRequestPending, cs, nil
	} else if !isNotFound(err) {
		return "", nil, err
	}
	if len(cs) == 0 {
		return "", nil, nil
	}
	return reasonConflict, cs, nil
}

// moveConflicts are what a's session would overlap at start: the host's other sessions and busy times from their
// calendars, and the client's sessions with other members (kind client). Days off and working hours are told
// apart (the day off is its own reason).
func (s *Service) moveConflicts(ctx context.Context, q store.Q, ws store.Workspace, a store.SchedOccurrence, start time.Time) ([]Conflict, error) {
	end := start.Add(a.EndsAt.Sub(a.StartsAt))
	cs, err := s.conflicts(ctx, q, ws, a.HostUserID, start, end, a.ID)
	if err != nil {
		return nil, err
	}
	out := slices.DeleteFunc(cs, func(c Conflict) bool {
		return c.Kind != string(schedpolicy.ConflictEvent) && c.Kind != string(schedpolicy.ConflictBusy)
	})
	from, to := start.Add(-schedpolicy.MaxDuration), end
	theirs, err := q.SchedOccurrences(ctx, ws.ID, store.SchedOccurrenceFilter{From: &from, To: &to, ClientID: a.ClientID})
	if err != nil {
		return nil, err
	}
	for _, x := range theirs {
		if x.ID == a.ID || x.EventID == a.EventID || !isOpen(x.Status) || !x.EndsAt.After(start) ||
			a.HostUserID != nil && x.HostUserID != nil && *x.HostUserID == *a.HostUserID { // the host's own: already there
			continue
		}
		title := ""
		if x.Title != nil {
			title = *x.Title
		} else if e, err := q.SchedEvent(ctx, ws.ID, x.EventID, false); err == nil {
			title = e.Title
		}
		out = append(out, Conflict{Kind: conflictClient, StartsAt: x.StartsAt, EndsAt: x.EndsAt, OccurrenceID: x.ID, Title: title})
	}
	return out, nil
}

// conflictClient: the client has a session with another member then.
const conflictClient = "client"

// rulePreview is the preview of a move the series' rule cannot make: nothing moves.
func rulePreview(o store.SchedOccurrence) MovePreview {
	return MovePreview{Sample: []MoveItem{}, Items: []MoveItem{{OccurrenceID: o.ID, StartsAt: o.StartsAt, EndsAt: o.EndsAt,
		Status: o.Status, Reason: reasonMonthlyRule}}}
}
