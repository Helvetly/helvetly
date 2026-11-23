package scheduling

import (
	"context"
	"errors"
	"time"

	"helvetly.com/api/internal/store"
)

// errBadMove: a time from the host's calendar Scheduling cannot hold (calsync pushes the session back over it).
var errBadMove = errors.New("scheduling: the calendar's time is not a valid session length")

// MoveFromCalendar applies a pushed session its host moved in their own calendar as the host's "this" reschedule
// (calsync.Mover): the client is emailed and the move audited with its source.
func (s *Service) MoveFromCalendar(ctx context.Context, workspaceID, occurrenceID string, startsAt, endsAt time.Time, source string) error {
	startsAt, endsAt = startsAt.UTC(), endsAt.UTC()
	minutes := int(endsAt.Sub(startsAt) / time.Minute)
	if minutes < 5 || minutes > 720 {
		return errBadMove
	}
	var ch Change
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.RequireFeature(ctx, workspaceID, store.FeatureScheduling); err != nil {
			return err
		}
		e, o, err := lockOccurrence(ctx, q, workspaceID, occurrenceID)
		if err != nil {
			return err
		}
		if !isOpen(o.Status) {
			return errClosed
		}
		if e.RRule == nil { // a one-off's time lives on its event too, or its next edit would move it back
			l := startsAt.In(loadZone(e.TimeZone))
			e.StartsLocal = time.Date(l.Year(), l.Month(), l.Day(), l.Hour(), l.Minute(), 0, 0, time.UTC)
			e.DurationMinutes = minutes
			e.Sequence++
			e.UpdatedAt = s.now()
			if err := q.SaveSchedEvent(ctx, e); err != nil {
				return err
			}
		} else {
			o.IsException = true
		}
		s.retime(&o, startsAt, endsAt)
		o.Sequence++
		o.UpdatedAt = s.now()
		if err := q.SaveSchedOccurrence(ctx, o); err != nil {
			return err
		}
		if err := s.audit(ctx, q, workspaceID, o.HostUserID, "scheduling.moved_from_calendar", o.ID,
			map[string]any{"occurrence_id": o.ID, "source": source, "starts_at": startsAt, "ends_at": endsAt}); err != nil {
			return err
		}
		host := ""
		if o.HostUserID != nil {
			host = *o.HostUserID
		}
		ch = Change{Kind: ChangeUpdated, WorkspaceID: workspaceID, EventID: e.ID, OccurrenceIDs: []string{o.ID}, ActorID: host, Notify: true}
		return s.cal.Enqueue(ctx, q, workspaceID, []string{o.ID})
	})
	if err != nil {
		return err
	}
	s.tell(ctx, changes{ch})
	return nil
}
