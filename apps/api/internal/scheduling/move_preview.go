package scheduling

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"helvetly.com/api/internal/recur"
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

// moveChoices are what the person chose for the sessions a series move cannot simply take along, by occurrence id.
type moveChoices struct {
	keep    []string // stay where they are, off the rule
	cancel  []string // cancelled (on time, the business's change)
	include []string // changed on their own, moved with the others all the same
	dryRun  bool     // only the preview: the edit is rolled back and nothing outside the database is asked
}

var choiceFields = []string{"dry_run", "keep", "cancel", "include"}

func choicesOf(body map[string]json.RawMessage) (moveChoices, error) {
	ch := moveChoices{dryRun: flagOf(body, "dry_run")}
	f := form{}
	for key, ids := range map[string]*[]string{"keep": &ch.keep, "cancel": &ch.cancel, "include": &ch.include} {
		if raw, ok := body[key]; ok && (json.Unmarshal(raw, ids) != nil || len(*ids) > 1000) {
			f.fail(key, "Send a list of session ids.")
		}
	}
	for _, k := range choiceFields {
		delete(body, k)
	}
	return ch, f.err()
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
	MovesTo      *time.Time `json:"moves_to"` // the new start when it moves, else null
	Status       string     `json:"status"`
	Reason       string     `json:"reason"`
	Moves        bool       `json:"moves"`             // a warning: it moves unless kept
	DayOff       string     `json:"day_off,omitempty"` // the day off's name
}

// errDryRun rolls a previewed edit back.
var errDryRun = errors.New("dry run")

const sampleSize = 3

// preview compares the series' rows before an edit (before, the event's rows when it began) with what they are now,
// inside the edit's transaction. o is the session the edit was made on, at from on ("following"); only sessions that
// have not ended count.
func (s *Service) preview(ctx context.Context, q store.Q, ws store.Workspace, o store.SchedOccurrence, before []store.SchedOccurrence,
	following bool) (MovePreview, error) {
	out := MovePreview{Sample: []MoveItem{}, Items: []MoveItem{}}
	moved, err := q.SchedOccurrence(ctx, ws.ID, o.ID, false)
	if err != nil {
		return out, err
	}
	delta := moved.StartsAt.Sub(o.StartsAt)
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
			item.Reason, item.DayOff = reasonOutsideSeries, dayOffAt(b.StartsAt.Add(delta))
			if item.DayOff != "" {
				item.Reason = reasonDayOff
			}
		case a.StartsAt.Equal(b.StartsAt):
			if b.IsException && delta != 0 {
				item.Reason = reasonException
			}
		default:
			to := a.StartsAt
			item.MovesTo, item.Moves = &to, true
			out.Moving++
			if len(out.Sample) < sampleSize {
				out.Sample = append(out.Sample, item)
			}
			if item.Reason, err = s.moveWarning(ctx, q, ws, a, dayOffAt(a.StartsAt)); err != nil {
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
// client still open, the host busy then.
func (s *Service) moveWarning(ctx context.Context, q store.Q, ws store.Workspace, a store.SchedOccurrence, dayOff string) (string, error) {
	if dayOff != "" {
		return reasonDayOff, nil
	}
	if _, err := q.OpenSchedRequest(ctx, ws.ID, a.ID); err == nil {
		return reasonRequestPending, nil
	} else if !isNotFound(err) {
		return "", err
	}
	cs, err := s.conflicts(ctx, q, ws, a.HostUserID, a.StartsAt, a.EndsAt, a.ID)
	if err != nil || len(cs) == 0 {
		return "", err
	}
	return reasonConflict, nil
}

// rulePreview is the preview of a move the series' rule cannot make: nothing moves.
func rulePreview(o store.SchedOccurrence) MovePreview {
	return MovePreview{Sample: []MoveItem{}, Items: []MoveItem{{OccurrenceID: o.ID, StartsAt: o.StartsAt, EndsAt: o.EndsAt,
		Status: o.Status, Reason: reasonMonthlyRule}}}
}
