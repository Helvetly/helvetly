// Package calsync syncs each member's sessions with their own Google Calendar or Microsoft 365 calendar and serves
// their private iCal feed. Helvetly is the source of truth: occurrences are pushed (one external event each, no
// attendees, so providers never invite the client), the member's other events come back as busy times without
// titles, a pushed event moved outside is the host's own reschedule (Mover), and one deleted outside is detached,
// never a cancelled session. Tokens are sealed; jobs claim due rows, so any number of instances may run them.
package calsync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"golang.org/x/oauth2"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/schedpolicy"
	"helvetly.com/api/internal/store"
)

type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Mover applies a pushed session its host moved in their own calendar as the host's "this" reschedule: the client
// is emailed and the change audited with source google or microsoft (internal/scheduling).
type Mover interface {
	MoveFromCalendar(ctx context.Context, workspaceID, occurrenceID string, startsAt, endsAt time.Time, source string) error
}

type Service struct {
	db           *store.Store
	auth         Auth
	providers    map[string]provider // configured ones only
	seal         sealer
	publicURL    string
	cookieSecure bool
	mover        Mover
	fake         *Fake // HELVETLY_E2E_FAKE_CALENDARS: the fake providers this binary serves
	log          *slog.Logger
	now          func() time.Time
	// async runs work that outlives a request (removing a disconnected calendar's events); tests run it inline.
	async     func(func())
	syncLimit *auth.RateLimiter
	feedLimit *auth.RateLimiter
	hookLimit *auth.RateLimiter
}

const (
	// horizon: how far ahead busy times are imported and the feed lists sessions.
	horizon = 400 * 24 * time.Hour
	// meetingTimeout bounds making a Meet or Teams link while the request that asked for it waits.
	meetingTimeout = 10 * time.Second
	stateCookie    = "helvetly_calendar_oauth"
	statePath      = "/api/v1/scheduling/calendars"
	stateTTL       = 10 * time.Minute
)

// New wires calendar sync; a provider without its client settings is not offered (and its routes answer 404).
func New(db *store.Store, a Auth, cfg config.Config, log *slog.Logger) *Service {
	s := &Service{db: db, auth: a, providers: map[string]provider{}, seal: newSealer(cfg.SecretKey), publicURL: cfg.PublicURL,
		cookieSecure: cfg.CookieSecure, log: log, now: func() time.Time { return time.Now().UTC() }, async: func(f func()) { go f() },
		syncLimit: auth.NewRateLimiter(1, 10*time.Second), feedLimit: auth.NewRateLimiter(60, time.Minute),
		hookLimit: auth.NewRateLimiter(600, time.Minute)}
	c := cfg.Calendars
	if c.Fake {
		s.fake = NewFake()
		root := cfg.PublicURL + fakePath
		c.GoogleClientID, c.GoogleClientSecret, c.GoogleAPIURL = cmpOr(c.GoogleClientID, "fake-google"), cmpOr(c.GoogleClientSecret, "x"), root+"/google"
		c.MicrosoftClientID, c.MicrosoftSecret, c.MicrosoftGraphURL = cmpOr(c.MicrosoftClientID, "fake-microsoft"), cmpOr(c.MicrosoftSecret, "x"), root+"/microsoft"
	}
	webhook := ""
	if u, err := url.Parse(cfg.PublicURL); err == nil && u.Scheme == "https" && !local(u.Hostname()) {
		webhook = cfg.PublicURL + "/api/webhooks"
	}
	callback := cfg.PublicURL + "/api/v1/scheduling/calendars/%s/callback"
	if c.Google() {
		s.providers["google"] = newGoogle(c.GoogleClientID, c.GoogleClientSecret, fmt.Sprintf(callback, "google"), c.GoogleAPIURL, webhook)
	}
	if c.Microsoft() {
		s.providers["microsoft"] = newMicrosoft(c.MicrosoftClientID, c.MicrosoftSecret, c.MicrosoftTenant, fmt.Sprintf(callback, "microsoft"),
			c.MicrosoftGraphURL, webhook)
	}
	return s
}

// SetMover connects external moves to the scheduling service.
func (s *Service) SetMover(m Mover) { s.mover = m }

func local(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".test")
}

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h func(http.ResponseWriter, *http.Request, store.Session) error) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/scheduling/calendars", s.list)
	handle("GET /api/v1/scheduling/calendars/{provider}/connect", s.connect)
	handle("GET /api/v1/scheduling/calendars/{provider}/callback", s.callback)
	handle("PATCH /api/v1/scheduling/calendars/{id}", s.patch)
	handle("POST /api/v1/scheduling/calendars/{id}/sync", s.syncNow)
	handle("DELETE /api/v1/scheduling/calendars/{id}", s.disconnect)
	handle("GET /api/v1/scheduling/feed", s.feedGet)
	handle("POST /api/v1/scheduling/feed", s.feedRotate)
	handle("DELETE /api/v1/scheduling/feed", s.feedDelete)
	mux.HandleFunc("GET /api/v1/public/calendar/{file}", s.feed)
	mux.HandleFunc("POST /api/webhooks/google-calendar", s.googleHook)
	mux.HandleFunc("POST /api/webhooks/microsoft-graph", s.graphHook)
	mux.HandleFunc("POST /api/webhooks/microsoft-graph/lifecycle", s.graphLifecycle)
	if s.fake != nil {
		mux.Handle(fakePath+"/", http.StripPrefix(fakePath, s.fake.Handler()))
	}
}

// Calendar is what internal/scheduling uses: pushes queued in its transactions, meeting links and busy times.

// Enqueue records pushes of the occurrences in the caller's transaction (coalesced per connection and occurrence).
func (s *Service) Enqueue(ctx context.Context, q store.Q, workspaceID string, occurrenceIDs []string) error {
	return q.EnqueueCalendarPush(ctx, workspaceID, occurrenceIDs, s.now())
}

// Busy is the hosts' imported busy blocks overlapping [from, to).
func (s *Service) Busy(ctx context.Context, q store.Q, workspaceID string, hostIDs []string, from, to time.Time) ([]schedpolicy.Block, error) {
	list, err := q.CalendarBusy(ctx, workspaceID, hostIDs, from, to)
	if err != nil {
		return nil, err
	}
	out := make([]schedpolicy.Block, len(list))
	for i, b := range list {
		out[i] = schedpolicy.Block{Start: b.StartsAt, End: b.EndsAt}
	}
	return out, nil
}

var (
	errNoProvider = auth.Error(http.StatusNotFound, "not_found", "Not found.", nil)
	errSyncSoon   = auth.Error(http.StatusTooManyRequests, "rate_limited", "This calendar was synced a moment ago. Try again in a few seconds.", nil)
)

type calendarView struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Primary bool   `json:"primary"`
}

type connectionView struct {
	ID              string         `json:"id"`
	Provider        string         `json:"provider"`
	AccountEmail    string         `json:"account_email"`
	Status          string         `json:"status"`
	PushCalendarID  *string        `json:"push_calendar_id"`
	BusyCalendarIDs []string       `json:"busy_calendar_ids"`
	Calendars       []calendarView `json:"calendars"`
	LastSyncedAt    *time.Time     `json:"last_synced_at"`
	Error           *string        `json:"error"`
}

func (s *Service) view(ctx context.Context, c store.CalendarConnection) (connectionView, error) {
	sources, err := s.db.CalendarSources(ctx, c.ID)
	if err != nil {
		return connectionView{}, err
	}
	v := connectionView{ID: c.ID, Provider: c.Provider, AccountEmail: c.AccountEmail, Status: c.Status, PushCalendarID: c.PushCalendarID,
		BusyCalendarIDs: []string{}, Calendars: []calendarView{}, LastSyncedAt: c.LastSyncedAt, Error: c.Error}
	for _, src := range sources {
		v.Calendars = append(v.Calendars, calendarView{ID: src.CalendarID, Name: src.Name, Primary: src.Primary})
		if src.Busy {
			v.BusyCalendarIDs = append(v.BusyCalendarIDs, src.CalendarID)
		}
	}
	return v, nil
}

func (s *Service) configured() []string {
	out := []string{}
	for _, p := range []string{"google", "microsoft"} {
		if s.providers[p] != nil {
			out = append(out, p)
		}
	}
	return out
}

// list answers the person's own connections in the workspace, of providers this installation offers.
func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	conns, err := s.db.CalendarConnections(r.Context(), sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return err
	}
	out := []connectionView{}
	for _, c := range conns {
		if s.providers[c.Provider] == nil {
			continue
		}
		v, err := s.view(r.Context(), c)
		if err != nil {
			return err
		}
		out = append(out, v)
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"providers": s.configured(), "data": out})
	return nil
}

// own is the person's connection id of the workspace; another person's or another workspace's is 404.
func (s *Service) own(ctx context.Context, sess store.Session, id string) (store.CalendarConnection, error) {
	c, err := s.db.CalendarConnection(ctx, sess.Workspace.ID, id)
	if err == nil && (c.UserID != sess.User.ID || s.providers[c.Provider] == nil) {
		err = store.ErrNotFound
	}
	return c, err
}

// requireFeature: Google and Microsoft calendars are a paid feature; the iCal feed comes with scheduling.
func (s *Service) requireFeature(ctx context.Context, workspaceID string) error {
	return s.db.RequireFeature(ctx, workspaceID, store.FeatureCalendarSync)
}

func (s *Service) patch(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	c, err := s.own(r.Context(), sess, r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := s.requireFeature(r.Context(), sess.Workspace.ID); err != nil {
		return err
	}
	var in struct {
		PushCalendarID  *string   `json:"push_calendar_id"`
		BusyCalendarIDs *[]string `json:"busy_calendar_ids"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	sources, err := s.db.CalendarSources(r.Context(), c.ID)
	if err != nil {
		return err
	}
	known := func(id string) bool {
		return slices.ContainsFunc(sources, func(src store.CalendarSource) bool { return src.CalendarID == id })
	}
	fields := map[string]string{}
	if in.PushCalendarID != nil && !known(*in.PushCalendarID) {
		fields["push_calendar_id"] = "unknown"
	}
	if in.BusyCalendarIDs != nil && (len(*in.BusyCalendarIDs) > 50 || slices.ContainsFunc(*in.BusyCalendarIDs, func(id string) bool { return !known(id) })) {
		fields["busy_calendar_ids"] = "unknown"
	}
	if len(fields) > 0 {
		return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Choose calendars of this account.", map[string]any{"fields": fields})
	}
	now := s.now()
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if in.BusyCalendarIDs != nil {
			if err := q.SetBusyCalendars(r.Context(), c.ID, *in.BusyCalendarIDs, now); err != nil {
				return err
			}
		}
		if in.PushCalendarID == nil || (c.PushCalendarID != nil && *c.PushCalendarID == *in.PushCalendarID) {
			return nil
		}
		if err := q.SetPushCalendar(r.Context(), sess.Workspace.ID, c.ID, in.PushCalendarID, now); err != nil {
			return err
		}
		return s.enqueueAll(r.Context(), q, c) // each push moves its event to the new calendar
	})
	if err != nil {
		return err
	}
	c, err = s.db.CalendarConnection(r.Context(), sess.Workspace.ID, c.ID)
	if err != nil {
		return err
	}
	v, err := s.view(r.Context(), c)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": v})
	return nil
}

// enqueueAll queues a push of the host's open sessions from now on and of every event the connection pushed.
func (s *Service) enqueueAll(ctx context.Context, q store.Q, c store.CalendarConnection) error {
	now := s.now()
	open, err := q.SchedOccurrences(ctx, c.WorkspaceID, store.SchedOccurrenceFilter{From: &now, HostIDs: []string{c.UserID},
		Statuses: openStatuses})
	if err != nil {
		return err
	}
	links, err := q.CalendarLinksOfConnection(ctx, c.ID)
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(open)+len(links))
	for _, o := range open {
		ids = append(ids, o.ID)
	}
	for _, l := range links {
		ids = append(ids, l.OccurrenceID)
	}
	if len(ids) == 0 {
		return nil
	}
	return q.EnqueueCalendarPush(ctx, c.WorkspaceID, ids, now)
}

var openStatuses = []string{"requested", "scheduled", "rescheduled"}

func isOpen(status string) bool { return slices.Contains(openStatuses, status) }

// syncNow refreshes the account's calendar list and makes every imported calendar due at once.
func (s *Service) syncNow(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	c, err := s.own(r.Context(), sess, r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := s.requireFeature(r.Context(), sess.Workspace.ID); err != nil {
		return err
	}
	if !s.syncLimit.AllowKey(c.ID) {
		return errSyncSoon
	}
	if c.Status == "active" {
		ctx, cancel := context.WithTimeout(r.Context(), meetingTimeout)
		defer cancel()
		if err := s.refreshCalendars(ctx, c); err != nil {
			s.log.WarnContext(r.Context(), "calendar list refresh failed", "connection", c.ID, "error", err)
		}
	}
	sources, err := s.db.CalendarSources(r.Context(), c.ID)
	if err != nil {
		return err
	}
	for _, src := range sources {
		if src.Busy {
			if err := s.db.MarkSourceDue(r.Context(), c.ID, src.CalendarID, false, s.now()); err != nil {
				return err
			}
		}
	}
	w.WriteHeader(http.StatusAccepted)
	return nil
}

func (s *Service) refreshCalendars(ctx context.Context, c store.CalendarConnection) error {
	p := s.providers[c.Provider]
	sess, err := s.session(ctx, c, true)
	if err != nil {
		return err
	}
	cals, err := p.calendars(ctx, sess)
	if err != nil {
		return s.failed(ctx, c, err)
	}
	return s.db.SaveCalendarSources(ctx, c.ID, sourcesOf(c.ID, cals, nil), s.now())
}

// sourcesOf makes calendars sources; busy ticks those ids (existing sources keep their own choice).
func sourcesOf(connectionID string, cals []calendar, busy []string) []store.CalendarSource {
	out := make([]store.CalendarSource, len(cals))
	for i, c := range cals {
		out[i] = store.CalendarSource{ConnectionID: connectionID, CalendarID: c.ID, Name: c.Name, Primary: c.Primary, Busy: slices.Contains(busy, c.ID)}
	}
	return out
}

// disconnect removes the connection at once; its pushed events (unless keep_events=true), watches and the grant are
// removed at the provider afterwards.
func (s *Service) disconnect(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	c, err := s.db.CalendarConnection(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	if c.UserID != sess.User.ID && sess.Role != "owner" && sess.Role != "admin" {
		return store.ErrNotFound
	}
	keep := r.URL.Query().Get("keep_events") == "true"
	var links []store.CalendarLink
	if !keep {
		if links, err = s.db.CalendarLinksOfConnection(r.Context(), c.ID); err != nil {
			return err
		}
	}
	watches, err := s.db.CalendarWatches(r.Context(), c.ID)
	if err != nil {
		return err
	}
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.DeleteCalendarConnection(r.Context(), sess.Workspace.ID, c.ID); err != nil {
			return err
		}
		return s.audit(r.Context(), q, c.WorkspaceID, &sess.User.ID, c.ID, "scheduling.calendar_disconnected", map[string]any{"provider": c.Provider})
	})
	if err != nil {
		return err
	}
	if p := s.providers[c.Provider]; p != nil && c.Status != "revoked" {
		ctx := context.WithoutCancel(r.Context())
		s.async(func() { s.cleanUp(ctx, p, c, links, watches) })
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// cleanUp removes a disconnected connection's events and watches, then revokes its grant (Google). shortcut: in
// memory; an instance stopping meanwhile leaves the rest in the member's calendar. Queue it if that matters.
func (s *Service) cleanUp(ctx context.Context, p provider, c store.CalendarConnection, links []store.CalendarLink, watches []store.CalendarWatch) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	sess, err := s.session(ctx, c, false)
	if err != nil {
		s.log.WarnContext(ctx, "calendar clean-up: no access", "connection", c.ID, "error", err)
		return
	}
	for _, l := range links {
		cal, id := splitExternal(l.ExternalID)
		if err := p.remove(ctx, sess, cal, id); err != nil {
			s.log.WarnContext(ctx, "calendar clean-up: event not removed", "connection", c.ID, "error", err)
		}
	}
	for _, wt := range watches {
		if err := p.unwatch(ctx, sess, wt); err != nil {
			s.log.WarnContext(ctx, "calendar clean-up: watch not stopped", "connection", c.ID, "error", err)
		}
	}
	if refresh, err := s.seal.open(c.WorkspaceID, c.ID, "refresh", c.RefreshToken); err == nil {
		if err := p.revoke(ctx, refresh); err != nil {
			s.log.WarnContext(ctx, "calendar clean-up: grant not revoked", "connection", c.ID, "error", err)
		}
	}
}

// session opens the connection's access token, refreshing it when it expires within a minute; save stores the new
// one (false for a connection already deleted). A refused refresh is errAuth.
func (s *Service) session(ctx context.Context, c store.CalendarConnection, save bool) (session, error) {
	if c.AccessExpiresAt != nil && c.AccessExpiresAt.After(s.now().Add(time.Minute)) && c.AccessToken != nil {
		access, err := s.seal.open(c.WorkspaceID, c.ID, "access", c.AccessToken)
		if err == nil {
			return session{id: c.ID, access: access}, nil
		}
	}
	p := s.providers[c.Provider]
	if p == nil || c.RefreshToken == nil {
		return session{}, errAuth
	}
	refresh, err := s.seal.open(c.WorkspaceID, c.ID, "refresh", c.RefreshToken)
	if err != nil {
		return session{}, fmt.Errorf("open refresh token: %w", err)
	}
	tok, err := p.oauth().TokenSource(s.httpContext(ctx, p), &oauth2.Token{RefreshToken: refresh, Expiry: time.Unix(1, 0)}).Token()
	if re, ok := errors.AsType[*oauth2.RetrieveError](err); ok && (re.ErrorCode == "invalid_grant" || (re.Response != nil && re.Response.StatusCode == http.StatusUnauthorized)) {
		return session{}, errAuth
	}
	if err != nil {
		return session{}, fmt.Errorf("refresh %s token: %w", c.Provider, err)
	}
	if save {
		sealedAccess, err := s.seal.seal(c.WorkspaceID, c.ID, "access", tok.AccessToken)
		if err != nil {
			return session{}, err
		}
		var sealedRefresh []byte
		if tok.RefreshToken != "" && tok.RefreshToken != refresh { // Microsoft rotates it
			if sealedRefresh, err = s.seal.seal(c.WorkspaceID, c.ID, "refresh", tok.RefreshToken); err != nil {
				return session{}, err
			}
		}
		expiry := tok.Expiry.UTC()
		if err := s.db.SaveCalendarTokens(ctx, c.ID, sealedAccess, sealedRefresh, &expiry, s.now()); err != nil {
			return session{}, err
		}
	}
	return session{id: c.ID, access: tok.AccessToken}, nil
}

// httpContext makes the oauth2 package use the provider's client (its timeout).
func (s *Service) httpContext(ctx context.Context, p provider) context.Context {
	var hc *http.Client
	switch v := p.(type) {
	case *google:
		hc = v.http
	case *microsoft:
		hc = v.http
	}
	return context.WithValue(ctx, oauth2.HTTPClient, hc)
}

// failed turns a refused token into a revoked connection (the member is told) and hands err back.
func (s *Service) failed(ctx context.Context, c store.CalendarConnection, err error) error {
	if errors.Is(err, errAuth) {
		if rerr := s.markRevoked(ctx, c); rerr != nil {
			return errors.Join(err, rerr)
		}
	}
	return err
}

// markRevoked stops a connection whose grant the provider refused, drops its tokens and tells its member.
func (s *Service) markRevoked(ctx context.Context, c store.CalendarConnection) error {
	reason := "revoked"
	return s.db.Tx(ctx, func(q store.Q) error {
		if err := q.SetCalendarStatus(ctx, c.ID, "revoked", &reason, s.now()); err != nil {
			return err
		}
		return s.notify(ctx, q, c, "scheduling.calendar_disconnected", map[string]any{"provider": c.Provider, "account_email": c.AccountEmail}, true)
	})
}

// notify tells the connection's member (scheduling notifications contract); email only for what needs them to act.
func (s *Service) notify(ctx context.Context, q store.Q, c store.CalendarConnection, event string, data map[string]any, email bool) error {
	return q.Notify(ctx, c.WorkspaceID, event, data, store.EventDefaults{Bell: true, Email: email, EmailOffered: true},
		store.NotifyTo{UserIDs: []string{c.UserID}}, s.now())
}

func (s *Service) audit(ctx context.Context, q store.Q, workspaceID string, actor *string, subject, kind string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: workspaceID, Kind: kind, SubjectType: "calendar", SubjectID: subject,
		ActorID: actor, At: s.now(), Payload: raw})
}

// Enabled reports whether any calendar provider is offered (the sync jobs have nothing to do otherwise).
func (s *Service) Enabled() bool { return len(s.providers) > 0 }
