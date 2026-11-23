package calsync

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Pushing: each queued (connection, occurrence) brings the occurrence's external event up to its current state. Only
// open occurrences of the connection's own member exist externally; anything else is deleted there.

const (
	pushEvery   = 5 * time.Second
	pushLease   = 2 * time.Minute
	pushBatch   = 50
	pushWorkers = 4
	firstRetry  = 30 * time.Second
	maxRetry    = time.Hour
	giveUpAfter = 24 * time.Hour
)

// Meeting link errors for internal/scheduling's answers (422 meeting_provider, 422 teams_unavailable, 502
// meeting_unavailable).
var (
	ErrMeetingProvider = auth.Error(http.StatusUnprocessableEntity, "meeting_provider",
		"Connect the host's calendar of this provider first: the meeting link is made through it.", nil)
	ErrTeamsUnavailable = auth.Error(http.StatusUnprocessableEntity, "teams_unavailable",
		"Teams meetings need a work or school Microsoft account. Use another meeting option.", nil)
	ErrMeetingUnavailable = auth.Error(http.StatusBadGateway, "meeting_unavailable",
		"The calendar provider did not make the meeting link. Try again in a minute.", nil)
)

// meetingProviders maps an event's meeting provider to the calendar provider that makes its link.
var meetingProviders = map[string]string{"google_meet": "google", "google": "google", "teams": "microsoft", "microsoft": "microsoft"}

// CreateMeeting makes a Meet or Teams link through the host's connection, as the first occurrence's external event,
// within 10 s. ref names that event: the first push of the series adopts it instead of making another.
func (s *Service) CreateMeeting(ctx context.Context, workspaceID, hostUserID, provider string, first store.SchedOccurrence) (string, string, error) {
	name := meetingProviders[provider]
	p := s.providers[name]
	if p == nil {
		return "", "", ErrMeetingProvider
	}
	conns, err := s.db.CalendarConnections(ctx, workspaceID, hostUserID)
	if err != nil {
		return "", "", err
	}
	var c *store.CalendarConnection
	for i := range conns {
		if conns[i].Provider == name && conns[i].Status == "active" && conns[i].PushCalendarID != nil {
			c = &conns[i]
		}
	}
	if c == nil {
		return "", "", ErrMeetingProvider
	}
	ctx, cancel := context.WithTimeout(ctx, meetingTimeout)
	defer cancel()
	sess, err := s.session(ctx, *c, true)
	if err != nil {
		s.log.WarnContext(ctx, "meeting link: no calendar access", "connection", c.ID, "error", s.failed(context.WithoutCancel(ctx), *c, err))
		return "", "", ErrMeetingProvider
	}
	title := "Session"
	if first.Title != nil {
		title = *first.Title
	}
	cal := *c.PushCalendarID
	out, err := p.create(ctx, sess, cal, event{Summary: title, Start: first.StartsAt, End: first.EndsAt, WorkspaceID: workspaceID,
		OccurrenceID: first.ID, Meeting: true})
	if err != nil {
		s.log.WarnContext(ctx, "meeting link failed", "connection", c.ID, "error", err)
		return "", "", ErrMeetingUnavailable
	}
	if out.MeetingURL == "" {
		_ = p.remove(context.WithoutCancel(ctx), sess, cal, out.ID)
		if name == "microsoft" { // Graph makes no Teams meeting for a personal account
			return "", "", ErrTeamsUnavailable
		}
		return "", "", ErrMeetingUnavailable
	}
	return out.MeetingURL, externalID(cal, out.ID), nil
}

// RunPush works the push queue every 5 s.
func (s *Service) RunPush(ctx context.Context) { every(ctx, pushEvery, s.PushTick) }

// PushTick claims due pushes (leased, so other instances skip them) and works them four at a time.
func (s *Service) PushTick(ctx context.Context) {
	now := s.now()
	due, err := s.db.ClaimPushQueue(ctx, now, now.Add(pushLease), pushBatch)
	if err != nil {
		s.log.ErrorContext(ctx, "calendar push claim failed", "error", err)
		return
	}
	work := make(chan store.QueuedPush)
	var wg sync.WaitGroup
	for range min(pushWorkers, len(due)) {
		wg.Go(func() {
			for p := range work {
				s.push(ctx, p)
			}
		})
	}
	for _, p := range due {
		work <- p
	}
	close(work)
	wg.Wait()
}

func (s *Service) push(ctx context.Context, p store.QueuedPush) {
	c, err := s.db.CalendarConnectionByID(ctx, p.ConnectionID)
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) { // retried when the lease runs out
			s.log.ErrorContext(ctx, "calendar push: connection unreadable", "connection", p.ConnectionID, "error", err)
		}
		return
	}
	err = s.pushOne(ctx, c, p.OccurrenceID)
	switch {
	case err == nil:
		err = s.db.FinishPush(ctx, p.ConnectionID, p.OccurrenceID, p.DueAt)
	case errors.Is(err, errAuth): // the queue stays for a reconnect, which pushes everything again anyway
		err = s.markRevoked(ctx, c)
	case errors.Is(err, errRateLimited):
		err = s.db.RetryPush(ctx, p.ConnectionID, p.OccurrenceID, "rate limited", s.now().Add(defaultPause))
	case s.now().Sub(p.QueuedAt) > giveUpAfter:
		s.log.WarnContext(ctx, "calendar push given up", "connection", c.ID, "error", err)
		err = errors.Join(s.giveUp(ctx, c), s.db.FinishPush(ctx, p.ConnectionID, p.OccurrenceID, p.DueAt))
	default:
		s.log.WarnContext(ctx, "calendar push failed", "connection", c.ID, "attempt", p.Attempts+1, "error", err)
		err = s.db.RetryPush(ctx, p.ConnectionID, p.OccurrenceID, truncate(err.Error()), s.now().Add(backoff(p.Attempts)))
	}
	if err != nil {
		s.log.ErrorContext(ctx, "calendar push bookkeeping failed", "connection", p.ConnectionID, "error", err)
	}
}

// backoff is 30 s doubling per attempt, at most an hour.
func backoff(attempts int) time.Duration {
	d := firstRetry
	for range attempts {
		if d *= 2; d >= maxRetry {
			return maxRetry
		}
	}
	return d
}

func truncate(s string) string {
	if len(s) > 500 {
		return s[:500]
	}
	return s
}

// giveUp puts a connection whose pushes kept failing for a day in error, which stops its jobs, and tells its member.
func (s *Service) giveUp(ctx context.Context, c store.CalendarConnection) error {
	reason := "push_failed"
	return s.db.Tx(ctx, func(q store.Q) error {
		if err := q.SetCalendarStatus(ctx, c.ID, "error", &reason, s.now()); err != nil {
			return err
		}
		return s.notify(ctx, q, c, "scheduling.calendar_disconnected", map[string]any{"provider": c.Provider, "account_email": c.AccountEmail}, true)
	})
}

// pushOne makes the external event match the occurrence.
func (s *Service) pushOne(ctx context.Context, c store.CalendarConnection, occurrenceID string) error {
	p := s.providers[c.Provider]
	if p == nil {
		return nil // the provider was turned off on this installation: nothing can be done
	}
	occ, err := s.db.SchedOccurrence(ctx, c.WorkspaceID, occurrenceID, false)
	gone := errors.Is(err, store.ErrNotFound)
	if err != nil && !gone {
		return err
	}
	link, err := s.db.CalendarLink(ctx, c.ID, occurrenceID)
	linked := err == nil
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	want := !gone && isOpen(occ.Status) && occ.HostUserID != nil && *occ.HostUserID == c.UserID && c.PushCalendarID != nil
	if want {
		if want, err = s.db.FeatureAllowed(ctx, c.WorkspaceID, store.FeatureScheduling); err != nil {
			return err
		}
	}
	if !want && !linked {
		return nil
	}
	sess, err := s.session(ctx, c, true)
	if err != nil {
		return err
	}
	if !want {
		cal, id := splitExternal(link.ExternalID)
		if err := p.remove(ctx, sess, cal, id); err != nil {
			return err
		}
		return s.db.DeleteCalendarLink(ctx, c.ID, occurrenceID)
	}
	ev, err := s.eventOf(ctx, occ, nil)
	if err != nil {
		return err
	}
	cal := *c.PushCalendarID
	var out pushed
	switch linkCal, linkID := splitExternal(link.ExternalID); {
	case linked && link.State == "ok" && linkCal == cal:
		out, err = p.update(ctx, sess, cal, linkID, ev)
		if errors.Is(err, errGone) { // deleted outside since: the session stays, the member is told
			return s.detach(ctx, c, occ)
		}
	case linked && link.State == "ok": // the push calendar changed: move the event
		if err = p.remove(ctx, sess, linkCal, linkID); err == nil {
			out, err = p.create(ctx, sess, cal, ev)
		}
	default: // new, or detached and pushed again
		out, err = s.createOrAdopt(ctx, p, sess, c, occ, cal, ev)
	}
	if err != nil {
		return err
	}
	var etag *string
	if out.ETag != "" {
		etag = &out.ETag
	}
	return s.db.SaveCalendarLink(ctx, store.CalendarLink{ConnectionID: c.ID, OccurrenceID: occ.ID, ExternalID: externalID(cal, out.ID),
		ETag: etag, PushedSequence: occ.Sequence})
}

// createOrAdopt makes the external event, or takes over the one CreateMeeting made for the event's meeting link when
// no occurrence holds it yet.
func (s *Service) createOrAdopt(ctx context.Context, p provider, sess session, c store.CalendarConnection, occ store.SchedOccurrence,
	cal string, ev event) (pushed, error) {
	e, err := s.db.SchedEvent(ctx, c.WorkspaceID, occ.EventID, false)
	if err != nil {
		return pushed{}, err
	}
	if e.MeetingRef != nil && e.MeetingProvider != nil && meetingProviders[*e.MeetingProvider] == c.Provider {
		if refCal, refID := splitExternal(*e.MeetingRef); refCal == cal {
			_, err := s.db.CalendarLinkByExternal(ctx, c.ID, *e.MeetingRef)
			if errors.Is(err, store.ErrNotFound) {
				out, err := p.update(ctx, sess, cal, refID, ev)
				if !errors.Is(err, errGone) {
					return out, err
				}
			} else if err != nil {
				return pushed{}, err
			}
		}
	}
	return p.create(ctx, sess, cal, ev)
}

// detach marks the occurrence's event removed outside; the occurrence shows a warning and its member is told.
func (s *Service) detach(ctx context.Context, c store.CalendarConnection, occ store.SchedOccurrence) error {
	return s.db.Tx(ctx, func(q store.Q) error {
		if err := q.DetachCalendarLink(ctx, c.ID, occ.ID); err != nil {
			return err
		}
		return s.notify(ctx, q, c, "scheduling.event_detached", map[string]any{"occurrence_id": occ.ID, "provider": c.Provider,
			"starts_at": occ.StartsAt}, false)
	})
}

// lookups caches events and client names while one feed is written; nil reads each time.
type lookups struct {
	events  map[string]store.SchedEvent
	clients map[string]string
}

func (l *lookups) event(ctx context.Context, db *store.Store, workspaceID, id string) (store.SchedEvent, error) {
	if l != nil {
		if e, ok := l.events[id]; ok {
			return e, nil
		}
	}
	e, err := db.SchedEvent(ctx, workspaceID, id, false)
	if err == nil && l != nil {
		l.events[id] = e
	}
	return e, err
}

func (l *lookups) client(ctx context.Context, db *store.Store, workspaceID, id string) (string, error) {
	if l != nil {
		if n, ok := l.clients[id]; ok {
			return n, nil
		}
	}
	cl, err := db.Client(ctx, workspaceID, id)
	if err == nil && l != nil {
		l.clients[id] = cl.Name
	}
	return cl.Name, err
}

// eventOf is the occurrence as the host's calendar shows it: the title with the client's name, the place or meeting
// link, the client's note and a link back to the session in Helvetly.
func (s *Service) eventOf(ctx context.Context, occ store.SchedOccurrence, l *lookups) (event, error) {
	e, err := l.event(ctx, s.db, occ.WorkspaceID, occ.EventID)
	if err != nil {
		return event{}, err
	}
	client, err := l.client(ctx, s.db, occ.WorkspaceID, occ.ClientID)
	if err != nil {
		return event{}, fmt.Errorf("client of %s: %w", occ.ID, err)
	}
	title, location, meeting := resolve(occ.Title, e.Title), resolve(occ.Location, deref(e.Location)), resolve(occ.MeetingURL, deref(e.MeetingURL))
	var desc []string
	if e.ClientNote != nil && *e.ClientNote != "" {
		desc = append(desc, *e.ClientNote)
	}
	if meeting != "" {
		desc = append(desc, "Join: "+meeting)
		location = cmpOr(location, meeting)
	}
	desc = append(desc, "Open in Helvetly: "+s.publicURL+"/scheduling?occurrence="+occ.ID)
	return event{Summary: title + " · " + client, Description: strings.Join(desc, "\n\n"), Location: location, Start: occ.StartsAt,
		End: occ.EndsAt, WorkspaceID: occ.WorkspaceID, OccurrenceID: occ.ID}, nil
}

func resolve(own *string, fallback string) string {
	if own != nil {
		return *own
	}
	return fallback
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// every runs tick now and then every d until ctx ends.
func every(ctx context.Context, d time.Duration, tick func(context.Context)) {
	t := time.NewTicker(d)
	defer t.Stop()
	for {
		tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
