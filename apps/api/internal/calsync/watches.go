package calsync

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Change notifications: Google channels and Microsoft subscriptions on each imported calendar, made, renewed a day
// before they expire and dropped when nothing needs them. A notification only marks its calendar due; the import job
// reads the changes. Without a public https PUBLIC_URL there are none and the 15-minute poll does the work.

const (
	watchEvery   = 10 * time.Minute
	watchBatch   = 100
	renewBefore  = 24 * time.Hour
	purgeEvery   = 24 * time.Hour
	hookMaxBytes = 64 << 10
)

// RunWatches makes, renews and drops watches every 10 minutes.
func (s *Service) RunWatches(ctx context.Context) { every(ctx, watchEvery, s.WatchTick) }

func (s *Service) WatchTick(ctx context.Context) {
	orphans, err := s.db.OrphanCalendarWatches(ctx, watchBatch)
	if err != nil {
		s.log.ErrorContext(ctx, "calendar watches: orphans", "error", err)
	}
	for _, w := range orphans {
		s.dropWatch(ctx, w)
	}
	expiring, err := s.db.ExpiringCalendarWatches(ctx, s.now().Add(renewBefore), watchBatch)
	if err != nil {
		s.log.ErrorContext(ctx, "calendar watches: expiring", "error", err)
	}
	for _, w := range expiring {
		if err := s.makeWatch(ctx, w.ConnectionID, w.CalendarID); err != nil {
			s.log.WarnContext(ctx, "calendar watch not renewed", "connection", w.ConnectionID, "error", err)
			continue
		}
		s.dropWatch(ctx, w)
	}
	missing, err := s.db.UnwatchedCalendarSources(ctx, watchBatch)
	if err != nil {
		s.log.ErrorContext(ctx, "calendar watches: missing", "error", err)
	}
	for _, src := range missing {
		if err := s.makeWatch(ctx, src.ConnectionID, src.CalendarID); err != nil {
			s.log.WarnContext(ctx, "calendar watch not made", "connection", src.ConnectionID, "error", err)
		}
	}
}

// makeWatch opens a channel or subscription on the calendar with a fresh secret, of which only the hash is kept.
func (s *Service) makeWatch(ctx context.Context, connectionID, cal string) error {
	c, err := s.db.CalendarConnectionByID(ctx, connectionID)
	if err != nil {
		return err
	}
	p := s.providers[c.Provider]
	if p == nil || c.Status != "active" || !s.webhooks(p) {
		return nil
	}
	if ok, err := s.db.FeatureAllowed(ctx, c.WorkspaceID, store.FeatureCalendarSync); err != nil || !ok {
		return err
	}
	sess, err := s.session(ctx, c, true)
	if err != nil {
		return s.failed(ctx, c, err)
	}
	id, secret := auth.NewID("cwt"), rand.Text()
	providerID, resourceID, expires, err := p.watch(ctx, sess, cal, id, secret, s.now())
	if err != nil {
		return s.failed(ctx, c, err)
	}
	hash := sha256.Sum256([]byte(secret))
	var res *string
	if resourceID != "" {
		res = &resourceID
	}
	return s.db.CreateCalendarWatch(ctx, store.CalendarWatch{ID: id, ConnectionID: c.ID, CalendarID: cal, ProviderID: providerID,
		ResourceID: res, SecretHash: hash[:], ExpiresAt: expires})
}

func (s *Service) webhooks(p provider) bool {
	switch v := p.(type) {
	case *google:
		return v.webhook != ""
	case *microsoft:
		return v.webhook != ""
	}
	return false
}

// dropWatch stops the watch at the provider when it still can, and forgets it.
func (s *Service) dropWatch(ctx context.Context, w store.CalendarWatch) {
	c, err := s.db.CalendarConnectionByID(ctx, w.ConnectionID)
	if p := s.providers[c.Provider]; err == nil && p != nil && c.Status == "active" {
		if sess, err := s.session(ctx, c, true); err == nil {
			if err := p.unwatch(ctx, sess, w); err != nil {
				s.log.WarnContext(ctx, "calendar watch not stopped", "connection", c.ID, "error", err)
			}
		}
	}
	if err := s.db.DeleteCalendarWatch(ctx, w.ID); err != nil {
		s.log.ErrorContext(ctx, "calendar watch not deleted", "watch", w.ID, "error", err)
	}
}

// RunPurge deletes past busy times daily and renews Microsoft delta windows weekly.
func (s *Service) RunPurge(ctx context.Context) { every(ctx, purgeEvery, s.PurgeTick) }

func (s *Service) PurgeTick(ctx context.Context) {
	now := s.now()
	if err := s.db.PurgePastBusy(ctx, now.Add(-24*time.Hour)); err != nil {
		s.log.ErrorContext(ctx, "calendar busy purge failed", "error", err)
	}
	// A delta link's window was fixed when it was made: the weekly full sync moves it forward. Every instance may do
	// it on Mondays; marking calendars due twice costs one more sync.
	if now.Weekday() == time.Monday {
		if err := s.db.RebaselineCalendarSources(ctx, "microsoft", now); err != nil {
			s.log.ErrorContext(ctx, "calendar re-baseline failed", "error", err)
		}
	}
}

// due marks the watch's calendar due when secret is the watch's own; false for an unknown watch or a wrong secret.
func (s *Service) due(ctx context.Context, providerID, secret string, full bool) (bool, error) {
	w, err := s.db.CalendarWatchByProviderID(ctx, providerID)
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	hash := sha256.Sum256([]byte(secret))
	if subtle.ConstantTimeCompare(hash[:], w.SecretHash) != 1 {
		return false, nil
	}
	return true, s.db.MarkSourceDue(ctx, w.ConnectionID, w.CalendarID, full, s.now())
}

// googleHook takes a channel's notification: its id and token are in the headers, the body is empty.
func (s *Service) googleHook(w http.ResponseWriter, r *http.Request) {
	if !s.hookLimit.Allow(r) {
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(r.Body, hookMaxBytes))
	ok, err := s.due(r.Context(), r.Header.Get("X-Goog-Channel-ID"), r.Header.Get("X-Goog-Channel-Token"), false)
	switch {
	case err != nil:
		s.log.ErrorContext(r.Context(), "google calendar webhook failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
	case !ok:
		w.WriteHeader(http.StatusNotFound)
	default:
		w.WriteHeader(http.StatusAccepted)
	}
}

type graphNotification struct {
	SubscriptionID string `json:"subscriptionId"`
	ClientState    string `json:"clientState"`
	LifecycleEvent string `json:"lifecycleEvent"`
}

// graphBody answers Graph's validation handshake (true when it did) or reads its notifications.
func (s *Service) graphBody(w http.ResponseWriter, r *http.Request) ([]graphNotification, bool) {
	if !s.hookLimit.Allow(r) {
		w.WriteHeader(http.StatusTooManyRequests)
		return nil, true
	}
	if v := r.URL.Query().Get("validationToken"); v != "" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = io.WriteString(w, v)
		return nil, true
	}
	var body struct {
		Value []graphNotification `json:"value"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, hookMaxBytes)).Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return nil, true
	}
	return body.Value, false
}

func (s *Service) graphHook(w http.ResponseWriter, r *http.Request) {
	list, done := s.graphBody(w, r)
	if done {
		return
	}
	known := false
	for _, n := range list {
		ok, err := s.due(r.Context(), n.SubscriptionID, n.ClientState, false)
		if err != nil {
			s.log.ErrorContext(r.Context(), "microsoft graph webhook failed", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		known = known || ok
	}
	if !known {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// graphLifecycle: reauthorizationRequired renews the subscription at the next round, subscriptionRemoved makes a new
// one then, missed syncs the calendar now (the delta link catches up).
func (s *Service) graphLifecycle(w http.ResponseWriter, r *http.Request) {
	list, done := s.graphBody(w, r)
	if done {
		return
	}
	known := false
	for _, n := range list {
		ok, err := s.due(r.Context(), n.SubscriptionID, n.ClientState, false)
		if err == nil && ok {
			var wt store.CalendarWatch
			if wt, err = s.db.CalendarWatchByProviderID(r.Context(), n.SubscriptionID); err == nil {
				switch n.LifecycleEvent {
				case "reauthorizationRequired":
					err = s.db.ExpireCalendarWatch(r.Context(), wt.ID, s.now())
				case "subscriptionRemoved":
					err = s.db.DeleteCalendarWatch(r.Context(), wt.ID)
				}
			}
		}
		if err != nil {
			s.log.ErrorContext(r.Context(), "microsoft graph lifecycle failed", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		known = known || ok
	}
	if !known {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}
