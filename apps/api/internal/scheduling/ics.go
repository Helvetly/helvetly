package scheduling

import (
	"context"
	"net/http"

	"helvetly.com/api/internal/ical"
	"helvetly.com/api/internal/store"
)

// UID is an occurrence's iCalendar identity: a one-off's own id, or its series' id with RECURRENCE-ID set to the
// occurrence's original start (returned non-zero), so a change to one session updates that one calendar entry.
func (s *Service) UID(e store.SchedEvent, o store.SchedOccurrence) (uid string, recurrenceID bool) {
	if e.RRule == nil {
		return o.ID + "@" + s.uidHost, false
	}
	return e.ID + "@" + s.uidHost, true
}

// VEvent is the occurrence as one VEVENT: what the client may see (the client note, never the internal description),
// the meeting link or the address. A series' occurrence carries the series' zone.
func (s *Service) VEvent(e store.SchedEvent, o store.SchedOccurrence) ical.Event {
	uid, recurring := s.UID(e, o)
	v := ical.Event{UID: uid, Sequence: o.Sequence, Start: o.StartsAt, End: o.EndsAt, Summary: deref(o.Title), Description: deref(e.ClientNote)}
	if v.Summary == "" {
		v.Summary = e.Title
	}
	if recurring {
		v.RecurrenceID, v.Zone = o.OriginalStart, loadZone(e.TimeZone)
	}
	if e.Mode == "online" {
		if u := o.MeetingURL; u != nil {
			v.URL, v.Location = *u, *u
		} else if e.MeetingURL != nil {
			v.URL, v.Location = *e.MeetingURL, *e.MeetingURL
		}
	} else if l := o.Location; l != nil {
		v.Location = *l
	} else if e.Location != nil {
		v.Location = *e.Location
	}
	switch {
	case o.Status == store.SchedRequested:
		v.Status = "TENTATIVE"
	case !isOpen(o.Status):
		v.Status = "CANCELLED"
	}
	return v
}

// OccurrenceICS is the occurrence as an .ics file with method (PUBLISH for downloads).
func (s *Service) OccurrenceICS(ctx context.Context, q store.Q, workspaceID, occurrenceID string, method ical.Method) ([]byte, error) {
	o, err := q.SchedOccurrence(ctx, workspaceID, occurrenceID, false)
	if err != nil {
		return nil, err
	}
	e, err := q.SchedEvent(ctx, workspaceID, o.EventID, false)
	if err != nil {
		return nil, err
	}
	return ical.Calendar{Method: method, Stamp: s.now(), Events: []ical.Event{s.VEvent(e, o)}}.Bytes(), nil
}

func (s *Service) occurrenceICS(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, err := s.OccurrenceICS(r.Context(), s.db.Q, sess.Workspace.ID, r.PathValue("id"), ical.Publish)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8; method=PUBLISH")
	w.Header().Set("Content-Disposition", `attachment; filename="session.ics"`)
	_, _ = w.Write(body)
	return nil
}
