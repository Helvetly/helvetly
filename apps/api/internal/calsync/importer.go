package calsync

import (
	"context"
	"errors"
	"time"

	"helvetly.com/api/internal/store"
)

// Importing: each due calendar is read incrementally (Google's syncToken, Microsoft's delta link; an expired one
// starts a full sync). Other events become busy blocks (start, end, id: never a title); our own pushed events are
// watched for the host moving or deleting them.

const (
	importEvery = 30 * time.Second
	importLease = 2 * time.Minute
	importBatch = 50
	// pollEvery: the fallback when no change notification comes (lost, or no public webhook).
	pollEvery = 15 * time.Minute
	// retryImport: a failed sync is tried again after this.
	retryImport = 5 * time.Minute
)

// RunImport syncs due calendars every 30 s.
func (s *Service) RunImport(ctx context.Context) { every(ctx, importEvery, s.ImportTick) }

func (s *Service) ImportTick(ctx context.Context) {
	now := s.now()
	due, err := s.db.ClaimDueSources(ctx, now, now.Add(importLease), importBatch)
	if err != nil {
		s.log.ErrorContext(ctx, "calendar import claim failed", "error", err)
		return
	}
	for _, src := range due {
		if err := s.importSource(ctx, src); err != nil {
			s.log.WarnContext(ctx, "calendar import failed", "connection", src.ConnectionID, "error", err)
		}
	}
}

func (s *Service) importSource(ctx context.Context, src store.CalendarSource) error {
	c, err := s.db.CalendarConnectionByID(ctx, src.ConnectionID)
	if err != nil {
		return err
	}
	p := s.providers[c.Provider]
	retry := func(after time.Duration) error {
		return s.db.SaveSourceSync(ctx, c.ID, src.CalendarID, src.SyncToken, src.FullResync, s.now().Add(after))
	}
	if p == nil {
		return retry(pollEvery)
	}
	if ok, err := s.db.FeatureAllowed(ctx, c.WorkspaceID, store.FeatureCalendarSync); err != nil || !ok {
		return errors.Join(err, retry(pollEvery)) // paused while the plan lacks Scheduling
	}
	sess, err := s.session(ctx, c, true)
	if err != nil {
		if errors.Is(err, errAuth) {
			return s.markRevoked(ctx, c)
		}
		return errors.Join(err, retry(retryImport))
	}
	token := ""
	if src.SyncToken != nil && !src.FullResync {
		token = *src.SyncToken
	}
	got, err := p.changes(ctx, sess, src.CalendarID, token, s.now())
	if errors.Is(err, errSyncExpired) {
		token = ""
		got, err = p.changes(ctx, sess, src.CalendarID, "", s.now())
	}
	switch {
	case errors.Is(err, errAuth):
		return s.markRevoked(ctx, c)
	case errors.Is(err, errRateLimited):
		return retry(defaultPause)
	case err != nil:
		return errors.Join(err, retry(retryImport))
	}
	if err := s.apply(ctx, p, c, src.CalendarID, token == "", got.Items); err != nil {
		return errors.Join(err, retry(retryImport))
	}
	var next *string
	if got.Token != "" {
		next = &got.Token
	}
	if err := s.db.SaveSourceSync(ctx, c.ID, src.CalendarID, next, next == nil, s.now().Add(pollEvery)); err != nil {
		return err
	}
	return s.db.TouchCalendarSynced(ctx, c.ID, s.now())
}

// apply stores the busy blocks of one calendar's changes (all of them on a full sync, which replaces the calendar's
// blocks) and hands our moved or deleted events to their handlers.
func (s *Service) apply(ctx context.Context, p provider, c store.CalendarConnection, cal string, full bool, items []change) error {
	prefix := externalID(cal, "")
	var gone []string
	if full {
		var err error
		if gone, err = s.db.CalendarBusyIDs(ctx, c.ID, prefix); err != nil {
			return err
		}
	}
	now := s.now()
	var blocks []store.BusyBlock
	for _, it := range items {
		key := prefix + it.ID
		link, err := s.db.CalendarLinkByExternal(ctx, c.ID, key)
		switch {
		case err == nil:
			if err := s.ours(ctx, p, c, link, it); err != nil {
				return err
			}
			continue
		case !errors.Is(err, store.ErrNotFound):
			return err
		}
		if it.Workspace == c.WorkspaceID && it.Occurrence != "" {
			continue // ours, pushed a moment ago and not linked yet
		}
		if it.Removed || !it.Busy || it.End.Before(now.Add(-24*time.Hour)) || it.Start.After(now.Add(horizon)) {
			gone = append(gone, key)
			continue
		}
		blocks = append(blocks, store.BusyBlock{ExternalID: key, StartsAt: it.Start, EndsAt: it.End})
	}
	return s.db.SaveCalendarBusy(ctx, c.ID, blocks, gone)
}

// ours handles a change to an event we pushed: deleted outside → detached (the session stays); moved → the host's
// own reschedule of the session.
func (s *Service) ours(ctx context.Context, p provider, c store.CalendarConnection, link store.CalendarLink, it change) error {
	occ, err := s.db.SchedOccurrence(ctx, c.WorkspaceID, link.OccurrenceID, false)
	if err != nil {
		return err
	}
	if it.Removed {
		if link.State == "ok" && isOpen(occ.Status) {
			return s.detach(ctx, c, occ)
		}
		return nil
	}
	// A change of ours not pushed yet (sequence ahead of the push) shows the old time outside: the push wins.
	if !isOpen(occ.Status) || link.State != "ok" || link.PushedSequence != occ.Sequence || it.Start.IsZero() ||
		(it.Start.Equal(occ.StartsAt.Truncate(time.Second)) && it.End.Equal(occ.EndsAt.Truncate(time.Second))) {
		return nil
	}
	if s.mover == nil {
		s.log.WarnContext(ctx, "calendar move not applied: no scheduling service", "occurrence", occ.ID)
		return nil
	}
	if err := s.mover.MoveFromCalendar(ctx, c.WorkspaceID, occ.ID, it.Start, it.End, p.name()); err != nil {
		// a move Scheduling refuses (too long, closed meanwhile) is pushed back over by the next push
		s.log.WarnContext(ctx, "calendar move refused", "occurrence", occ.ID, "error", err)
		return s.db.EnqueueCalendarPush(ctx, c.WorkspaceID, []string{occ.ID}, s.now())
	}
	return nil
}
