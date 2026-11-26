package calsync

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/ical"
	"helvetly.com/api/internal/store"
)

// The private iCal feed: each member's open sessions from 30 days ago to 400 days ahead, for Apple Calendar and any
// other subscriber, read-only. The URL's 32-byte token is the only key: stored as its SHA-256 for lookup and sealed
// to show again; rotating replaces it, and the old URL stops at once.

const feedPath = "/api/v1/public/calendar/"

type feedView struct {
	URL           string     `json:"url"`
	CreatedAt     time.Time  `json:"created_at"`
	LastFetchedAt *time.Time `json:"last_fetched_at"`
}

func (s *Service) feedURL(token string) string { return s.publicURL + feedPath + token + ".ics" }

func (s *Service) feedGet(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	f, err := s.db.CalendarFeed(r.Context(), sess.Workspace.ID, sess.User.ID)
	if errors.Is(err, store.ErrNotFound) {
		auth.WriteJSON(w, http.StatusOK, map[string]any{"data": nil})
		return nil
	}
	if err != nil {
		return err
	}
	token, err := s.seal.open(f.WorkspaceID, f.UserID, "feed", f.TokenSealed)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": feedView{URL: s.feedURL(token), CreatedAt: f.CreatedAt, LastFetchedAt: f.LastFetchedAt}})
	return nil
}

// feedRotate makes the member's feed, or gives it a new URL.
func (s *Service) feedRotate(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.db.RequireFeature(r.Context(), sess.Workspace.ID, store.FeatureScheduling); err != nil {
		return err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	sealed, err := s.seal.seal(sess.Workspace.ID, sess.User.ID, "feed", token)
	if err != nil {
		return err
	}
	hash := sha256.Sum256([]byte(token))
	f := store.CalendarFeed{WorkspaceID: sess.Workspace.ID, UserID: sess.User.ID, TokenHash: hash[:], TokenSealed: sealed, CreatedAt: s.now()}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.SaveCalendarFeed(r.Context(), f); err != nil {
			return err
		}
		return s.audit(r.Context(), q, sess.Workspace.ID, &sess.User.ID, sess.User.ID, "scheduling.feed_rotated", map[string]any{})
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": feedView{URL: s.feedURL(token), CreatedAt: f.CreatedAt}})
	return nil
}

func (s *Service) feedDelete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.db.DeleteCalendarFeed(r.Context(), sess.Workspace.ID, sess.User.ID); err != nil && !errors.Is(err, store.ErrNotFound) {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// feed serves GET /api/v1/public/calendar/{token}.ics: 404 for anything that is not a live feed of a member of a
// live workspace whose plan includes Scheduling.
func (s *Service) feed(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex")
	if !s.feedLimit.Allow(r) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}
	token, ok := strings.CutSuffix(r.PathValue("file"), ".ics")
	if !ok || len(token) != 43 {
		http.NotFound(w, r)
		return
	}
	hash := sha256.Sum256([]byte(token))
	body, err := s.feedBody(r.Context(), hash[:])
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		s.log.ErrorContext(r.Context(), "calendar feed failed", "error", err)
		http.Error(w, "Something went wrong", http.StatusInternalServerError)
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=300")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	_, _ = w.Write(body)
}

// feedBody is the calendar of the feed whose token hashes to hash; store.ErrNotFound when it is not served.
func (s *Service) feedBody(ctx context.Context, hash []byte) ([]byte, error) {
	f, err := s.db.LiveCalendarFeed(ctx, hash)
	if err != nil {
		return nil, err
	}
	if ok, err := s.db.FeatureAllowed(ctx, f.WorkspaceID, store.FeatureScheduling); err != nil || !ok {
		return nil, errors.Join(err, store.ErrNotFound)
	}
	settings, err := s.db.SchedulingSettings(ctx, f.WorkspaceID)
	if err != nil {
		return nil, err
	}
	workspace, err := s.db.AdmissionWorkspace(ctx, f.WorkspaceID)
	if err != nil {
		return nil, err
	}
	now := s.now().In(workspace.Location())
	year, month, day := now.Date()
	from := time.Date(year, month, day, 0, 0, 0, 0, now.Location())
	to := now.Add(horizon)
	occs, err := s.db.SchedOccurrences(ctx, f.WorkspaceID, store.SchedOccurrenceFilter{From: &from, To: &to, HostIDs: []string{f.UserID},
		Statuses: openStatuses})
	if err != nil {
		return nil, err
	}
	host := "helvetly"
	if u, err := url.Parse(s.publicURL); err == nil && u.Hostname() != "" {
		host = u.Hostname()
	}
	cal := ical.Calendar{Method: ical.Publish, Name: workspace.Name + " · Helvetly", Stamp: now}
	busy := settings.FeedDetails == "busy"
	cache := &lookups{events: map[string]store.SchedEvent{}, clients: map[string]string{}}
	for _, o := range occs {
		ev := ical.Event{UID: o.ID + "@" + host, Sequence: o.Sequence, Start: o.StartsAt, End: o.EndsAt, Summary: "Busy"}
		if o.Status == "requested" {
			ev.Status = "TENTATIVE"
		}
		if !busy {
			full, err := s.eventOf(ctx, o, cache)
			if err != nil {
				return nil, err
			}
			ev.Summary, ev.Description, ev.Location, ev.URL = full.Summary, full.Description, full.Location, s.publicURL+"/scheduling?occurrence="+o.ID
		}
		cal.Events = append(cal.Events, ev)
	}
	if err := s.db.TouchCalendarFeed(ctx, f.WorkspaceID, f.UserID, now); err != nil {
		return nil, err
	}
	return cal.Bytes(), nil
}
