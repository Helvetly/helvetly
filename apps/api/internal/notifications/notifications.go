// Package notifications tells people what happened in their workspaces (docs/notifications-contract.md): a bell
// per person and workspace, batched emails, each person's settings and the unsubscribe link in every email.
package notifications

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// Categories group the events in the settings and the Notifications page's filter, in this order.
var Categories = []string{"invoices", "clients", "documents", "expenses", "engagements", "team", "billing", "books", "ai"}

// Events are what a person can be told about, in the order the settings list them (docs/notifications-contract.md).
// Every event is in the bell by default; emails says whether it can email at all and emailOn whether it does
// for someone who never changed it. An event whose own feature already emails it (signatures send the PDF and the
// decline reason) offers no email, and frequent or routine ones start with the email off, so nobody is spammed.
var Events = []event{
	{"invoice.paid", "invoices", true, true},
	{"invoice.partly_paid", "invoices", true, false},
	{"invoice.overdue", "invoices", true, false},
	{"dunning.sent", "invoices", true, false},
	{"instalment.issued", "invoices", true, false},
	{"einvoice.delivery_failed", "invoices", true, true},
	{"einvoice.delivered", "invoices", true, false},
	{"quote.accepted", "invoices", true, true},
	{"quote.declined", "invoices", true, true},
	{"client.change_requested", "clients", true, true},
	{"portal.first_sign_in", "clients", true, false},
	{"portal.document_viewed", "clients", true, false},
	{"portal.domain_active", "clients", true, false},
	{"portal.domain_failed", "clients", true, true},
	{"portal.domain_released", "clients", true, true},
	{"signature.viewed", "documents", false, false},
	{"signature.signed", "documents", false, false},
	{"signature.completed", "documents", false, false},
	{"signature.declined", "documents", false, false},
	{"expense.reimbursed", "expenses", true, true},
	{"engagement.draft_created", "engagements", true, false},
	{"engagement.over_committed", "engagements", true, false},
	{"member.invited", "team", true, false},
	{"member.joined", "team", true, true},
	{"member.role_changed", "team", true, true},
	{"member.removed", "team", true, false},
	{"billing.trial_ending", "billing", true, true},
	{"billing.payment_failed", "billing", true, true},
	{"billing.payment_disputed", "billing", true, true},
	{"billing.subscription_changed", "billing", true, false},
	{"billing.limit_near", "billing", true, true},
	{"period.closed", "books", true, false},
	{"period.reopened", "books", true, false},
	{"vat.return_due", "books", true, true},
	{"import.ready", "ai", true, false},
	{"import.failed", "ai", true, false},
}

type event struct {
	Name, Category string
	emails         bool
	emailOn        bool
}

// Managers are the people who look after a workspace; Owners only the owners (the subscription is theirs).
var (
	Managers = []string{"owner", "admin"}
	Owners   = []string{"owner"}
)

func lookup(name string) (event, bool) {
	i := slices.IndexFunc(Events, func(e event) bool { return e.Name == name })
	if i < 0 {
		return event{}, false
	}
	return Events[i], true
}

func emails(name string) bool {
	e, _ := lookup(name)
	return e.emails
}

func (e event) defaults() store.EventDefaults {
	return store.EventDefaults{Bell: true, Email: e.emails && e.emailOn, EmailOffered: e.emails}
}

// Notify records the event for its recipients in the caller's transaction, so a rolled-back change tells nobody.
func Notify(ctx context.Context, q store.Q, workspaceID, name string, data map[string]any, to store.NotifyTo, now time.Time) error {
	e, ok := lookup(name)
	if !ok {
		return fmt.Errorf("notify: unknown event %s", name)
	}
	if err := q.Notify(ctx, workspaceID, name, data, e.defaults(), to, now); err != nil {
		return fmt.Errorf("notify %s: %w", name, err)
	}
	return nil
}

// MemberJoined tells the managers someone joined, by accepting an invitation or signing in with its address.
func MemberJoined(ctx context.Context, q store.Q, workspaceID string, u store.User, role string, now time.Time) error {
	return Notify(ctx, q, workspaceID, "member.joined", map[string]any{"user_id": u.ID, "name": u.Name, "email": u.Email, "role": role},
		store.NotifyTo{Roles: Managers, Except: u.ID}, now)
}

// Actor is how a notification names the person who did something: their name, else their email.
func Actor(u store.User) string {
	if u.Name != "" {
		return u.Name
	}
	return u.Email
}

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Mailer sends the emails; nil means no SMTP and only the bell works.
type Mailer interface {
	Send(context.Context, mail.Message) error
}

type Service struct {
	db        *store.Store
	auth      Auth
	mailer    Mailer
	publicURL string
	key       []byte
	limit     *auth.RateLimiter
	log       *slog.Logger
	now       func() time.Time
}

func New(db *store.Store, a Auth, mailer Mailer, publicURL string, secretKey []byte, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, mailer: mailer, publicURL: publicURL, key: secretKey,
		limit: auth.NewRateLimiter(30, 10*time.Minute), log: log, now: time.Now}
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
	handle("GET /api/v1/notifications", s.list)
	handle("POST /api/v1/notifications/read", s.read)
	handle("POST /api/v1/notifications/{id}/read", s.readOne(true))
	handle("POST /api/v1/notifications/{id}/unread", s.readOne(false))
	handle("GET /api/v1/account/notifications", s.prefs)
	handle("PUT /api/v1/account/notifications", s.setPrefs)
	mux.HandleFunc("POST /api/v1/public/notifications/unsubscribe", func(w http.ResponseWriter, r *http.Request) {
		if err := s.unsubscribe(w, r); err != nil {
			s.auth.WriteError(w, r, err)
		}
	})
}

type notification struct {
	ID        string     `json:"id"`
	Event     string     `json:"event"`
	Category  string     `json:"category"`
	Title     string     `json:"title"`
	Body      *string    `json:"body"`
	Actor     *string    `json:"actor"`
	Href      string     `json:"href"`
	CreatedAt time.Time  `json:"created_at"`
	Read      bool       `json:"read"`
	ReadAt    *time.Time `json:"read_at"`
	// NeedsYou: the reader has something to do (the bell's "Needs you"); Action labels the button to Href.
	NeedsYou bool   `json:"needs_you"`
	Action   string `json:"action"`
	// Resolved: what later settled one that needs you (the invoice was paid), else null.
	Resolved *resolution `json:"resolved"`
}

type resolution struct {
	Title     string    `json:"title"`
	Body      *string   `json:"body"`
	Action    string    `json:"action"`
	CreatedAt time.Time `json:"created_at"`
}

// needsYou: the events that ask the reader to act; every other event is an update.
var needsYou = map[string]bool{
	"invoice.overdue": true, "einvoice.delivery_failed": true, "quote.accepted": true, "client.change_requested": true,
	"portal.domain_failed": true, "signature.declined": true, "engagement.draft_created": true,
	"billing.trial_ending": true, "billing.payment_failed": true, "billing.payment_disputed": true,
	"vat.return_due": true, "import.ready": true, "import.failed": true,
}

// settledBy: the later event about the same record (the same href) that settles one that needs you.
var settledBy = map[string]string{
	"invoice.overdue":          "invoice.paid",
	"einvoice.delivery_failed": "einvoice.delivered",
	"portal.domain_failed":     "portal.domain_active",
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// view is a notification as the bell shows it; settled is what settled it, if anything did.
func view(n store.Notification, settled *store.Notification) notification {
	m := render(n)
	e, _ := lookup(n.Event)
	v := notification{ID: strconv.FormatInt(n.ID, 10), Event: n.Event, Category: e.Category, Title: m.title, Href: m.href,
		CreatedAt: n.CreatedAt, Read: n.ReadAt != nil, ReadAt: n.ReadAt, Body: optional(m.body), Actor: optional(m.actor),
		NeedsYou: needsYou[n.Event], Action: m.action}
	if settled != nil {
		r := render(*settled)
		v.Resolved = &resolution{Title: r.title, Body: optional(r.body), Action: r.action, CreatedAt: settled.CreatedAt}
	}
	return v
}

// settled finds, for each row that needs you, the later notification about the same record that settled it.
func (s *Service) settled(ctx context.Context, sess store.Session, rows []store.Notification) (map[int64]*store.Notification, error) {
	out := map[int64]*store.Notification{}
	var after int64
	events := []string{}
	for _, n := range rows {
		if e, ok := settledBy[n.Event]; ok {
			if after == 0 || n.ID < after {
				after = n.ID
			}
			if !slices.Contains(events, e) {
				events = append(events, e)
			}
		}
	}
	if len(events) == 0 {
		return out, nil
	}
	// shortcut: looks at the next 500 settling events only; page by id if a workspace ever has more in its bell.
	later, err := s.db.LaterNotifications(ctx, sess.Workspace.ID, sess.User.ID, after, events, 500)
	if err != nil {
		return nil, err
	}
	hrefs := make([]string, len(later))
	for i, l := range later {
		hrefs[i] = render(l).href
	}
	for _, n := range rows {
		e, ok := settledBy[n.Event]
		if !ok {
			continue
		}
		href := render(n).href
		for i := range later {
			if later[i].ID > n.ID && later[i].Event == e && hrefs[i] == href {
				out[n.ID] = &later[i]
				break
			}
		}
	}
	return out, nil
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	query := r.URL.Query()
	f := store.NotificationFilter{Limit: 20, Unread: query.Get("unread") == "true"}
	if v := query.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 50 {
			return invalid("limit", "Use a limit from 1 to 50.")
		}
		f.Limit = n
	}
	if v := query.Get("before"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			return invalid("before", "Use the next value of the previous page.")
		}
		f.Before = n
	}
	if v := query.Get("category"); v != "" {
		if !slices.Contains(Categories, v) {
			return invalid("category", "Unknown category "+v+".")
		}
		f.Events = []string{}
		for _, e := range Events {
			if e.Category == v {
				f.Events = append(f.Events, e.Name)
			}
		}
	}
	if v := query.Get("read_after"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return invalid("read_after", "Use an RFC 3339 time.")
		}
		f.ReadAfter = &t
	}
	limit := f.Limit
	f.Limit++
	ctx := r.Context()
	rows, err := s.db.Notifications(ctx, sess.Workspace.ID, sess.User.ID, f)
	if err != nil {
		return err
	}
	unread, err := s.db.UnreadNotifications(ctx, sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return err
	}
	var next *string
	if len(rows) > limit {
		rows = rows[:limit]
		id := strconv.FormatInt(rows[limit-1].ID, 10)
		next = &id
	}
	settled, err := s.settled(ctx, sess, rows)
	if err != nil {
		return err
	}
	out := make([]notification, 0, len(rows))
	for _, n := range rows {
		out = append(out, view(n, settled[n.ID]))
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out, "unread": unread, "next": next})
	return nil
}

func (s *Service) read(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.db.ReadNotifications(r.Context(), sess.Workspace.ID, sess.User.ID, s.now()); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// readOne marks one notification read (keeping when it was first read) or unread again.
func (s *Service) readOne(read bool) func(http.ResponseWriter, *http.Request, store.Session) error {
	return func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id < 1 {
			return auth.ErrNotFound
		}
		var at *time.Time
		if read {
			now := s.now()
			at = &now
		}
		ok, err := s.db.SetNotificationRead(r.Context(), sess.Workspace.ID, sess.User.ID, id, at)
		if err != nil {
			return err
		}
		if !ok {
			return auth.ErrNotFound
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func invalid(field, msg string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
		map[string]any{"fields": map[string]string{field: msg}})
}

// ---- settings ----

type choice struct {
	Event          string `json:"event"`
	Category       string `json:"category"`
	Email          bool   `json:"email"`
	InApp          bool   `json:"in_app"`
	EmailAvailable bool   `json:"email_available"`
}

// get: the person's setting for the event, or the event's default when they never changed it.
func get(p store.NotificationPrefs, event string) store.NotificationChoice {
	if c, ok := p[event]; ok {
		return c
	}
	e, _ := lookup(event)
	return store.NotificationChoice{Email: e.emails && e.emailOn, InApp: true}
}

func (s *Service) writePrefs(w http.ResponseWriter, ctx context.Context, sess store.Session) error {
	p, err := s.db.UserNotificationPrefs(ctx, sess.User.ID, false)
	if err != nil {
		return err
	}
	out := make([]choice, 0, len(Events))
	for _, e := range Events {
		c := get(p, e.Name)
		out = append(out, choice{Event: e.Name, Category: e.Category, Email: c.Email && e.emails, InApp: c.InApp, EmailAvailable: e.emails})
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"email": sess.User.Email, "mail_ready": s.mailer != nil, "events": out})
	return nil
}

func (s *Service) prefs(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.writePrefs(w, r.Context(), sess)
}

func (s *Service) setPrefs(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Events []struct {
			Event string `json:"event"`
			Email bool   `json:"email"`
			InApp bool   `json:"in_app"`
		} `json:"events"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	for _, c := range body.Events {
		if !slices.ContainsFunc(Events, func(e event) bool { return e.Name == c.Event }) {
			return invalid("events", "Unknown event "+c.Event+".")
		}
	}
	err := s.update(r.Context(), sess.User.ID, func(p store.NotificationPrefs) {
		for _, c := range body.Events {
			p[c.Event] = store.NotificationChoice{Email: c.Email, InApp: c.InApp}
		}
	})
	if err != nil {
		return err
	}
	return s.writePrefs(w, r.Context(), sess)
}

// update reads and writes the settings under the person's row lock, so a save and an unsubscribe link merge.
func (s *Service) update(ctx context.Context, userID string, change func(store.NotificationPrefs)) error {
	return s.db.Tx(ctx, func(q store.Q) error {
		p, err := q.UserNotificationPrefs(ctx, userID, true)
		if err != nil {
			return err
		}
		change(p)
		return q.SetUserNotificationPrefs(ctx, userID, p, s.now())
	})
}

// ---- unsubscribe links ----

var errBadLink = auth.Error(http.StatusBadRequest, "invalid_link", "This unsubscribe link is not valid.", nil)

// token: "<user id>:<event>" and its HMAC under SECRET_KEY, so a link turns off one kind of email for one person
// without signing in and cannot be forged for anyone else.
func (s *Service) token(userID, event string) string {
	msg := userID + ":" + event
	return base64.RawURLEncoding.EncodeToString([]byte(msg)) + "." + base64.RawURLEncoding.EncodeToString(s.mac(msg))
}

func (s *Service) mac(msg string) []byte {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte("unsubscribe:" + msg))
	return m.Sum(nil)
}

func (s *Service) unsubscribe(w http.ResponseWriter, r *http.Request) error {
	if !s.limit.Allow(r) {
		return auth.Error(http.StatusTooManyRequests, "rate_limited", "Too many requests. Try again later.", nil)
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		var body struct {
			Token string `json:"token"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
		token = body.Token
	}
	raw, sig, ok := strings.Cut(strings.TrimSpace(token), ".")
	if !ok {
		return errBadLink
	}
	msg, err1 := base64.RawURLEncoding.DecodeString(raw)
	mac, err2 := base64.RawURLEncoding.DecodeString(sig)
	if err1 != nil || err2 != nil || !hmac.Equal(mac, s.mac(string(msg))) {
		return errBadLink
	}
	userID, event, _ := strings.Cut(string(msg), ":")
	if !emails(event) {
		return errBadLink
	}
	err := s.update(r.Context(), userID, func(p store.NotificationPrefs) {
		p[event] = store.NotificationChoice{Email: false, InApp: get(p, event).InApp}
	})
	if errors.Is(err, store.ErrNotFound) {
		return errBadLink
	}
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]string{"event": event})
	return nil
}
