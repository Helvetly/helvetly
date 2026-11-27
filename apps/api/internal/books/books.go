// Package books keeps financial records trustworthy after the fact: closed periods, the audit log and
// self-billing agreements (docs/books-contract.md).
package books

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

type Service struct {
	db   *store.Store
	auth Auth
	now  func() time.Time
}

func New(db *store.Store, a Auth) *Service {
	return &Service{db: db, auth: a, now: func() time.Time { return time.Now().UTC() }}
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/periods", s.periods)
	handle("POST /api/v1/periods", s.closePeriod)
	handle("GET /api/v1/periods/activity", s.periodActivity)
	handle("POST /api/v1/periods/{month}/reopen", s.reopenPeriod)
	handle("GET /api/v1/audit-log", s.auditLog)
	handle("GET /api/v1/audit-log/export", s.exportLog)
	handle("GET /api/v1/audit-log/verify", s.verifyLog)
	handle("GET /api/v1/audit-log/people", s.auditPeople)
	handle("GET /api/v1/clients/{id}/self-billing-agreements", s.agreements)
	handle("POST /api/v1/clients/{id}/self-billing-agreements", s.createAgreement)
	handle("DELETE /api/v1/clients/{id}/self-billing-agreements/{agreementId}", s.deleteAgreement)
}

var errForbidden = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can do this.", nil)

func canManage(sess store.Session) bool { return sess.Role == "owner" || sess.Role == "admin" }

func data(v any) map[string]any { return map[string]any{"data": v} }

func badQuery(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
		map[string]any{"fields": fields})
}

type person struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"` // "" without a photo
}

// people resolves user ids to {id, name, avatar_url} once per request; a deleted account is nil.
type people struct {
	q     store.Q
	known map[string]*person
}

func (p *people) get(ctx context.Context, id *string) (*person, error) {
	if id == nil {
		return nil, nil
	}
	if v, ok := p.known[*id]; ok {
		return v, nil
	}
	u, err := p.q.User(ctx, *id)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	var v *person
	if err == nil {
		v = &person{ID: u.ID, Name: u.Name, AvatarURL: u.AvatarURL}
	}
	p.known[*id] = v
	return v, nil
}

func (s *Service) people() *people { return &people{q: s.db.Q, known: map[string]*person{}} }

// ---- closed periods ----

type period struct {
	Month    string    `json:"month"`
	ClosedAt time.Time `json:"closed_at"`
	ClosedBy *person   `json:"closed_by"`
}

const monthLayout = "2006-01"

func (s *Service) periods(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.db.Periods(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	names, out := s.people(), make([]period, len(list))
	for i, p := range list {
		by, err := names.get(r.Context(), p.ClosedBy)
		if err != nil {
			return err
		}
		out[i] = period{Month: p.Month, ClosedAt: p.ClosedAt, ClosedBy: by}
	}
	// first_month: where the books' months start, from the records this session may read.
	first, err := s.db.FirstRecordMonth(r.Context(), sess.Workspace.ID,
		permissions.Allows(sess.Role, sess.Scopes, "read:invoices"), permissions.Allows(sess.Role, sess.Scopes, "read:expenses"))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out, "first_month": first})
	return nil
}

func periodEvent(sess store.Session, kind, month, reason string, at time.Time) store.FinancialEvent {
	fields := map[string]string{"month": month}
	if reason != "" {
		fields["reason"] = reason
	}
	payload, _ := json.Marshal(fields) // a map of strings always marshals
	return store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: kind, SubjectType: "period", SubjectID: month,
		ActorID: &sess.User.ID, At: at, Payload: payload}
}

// notifyPeriod tells the other owners and admins, naming the month as people do ("October 2026").
func notifyPeriod(ctx context.Context, q store.Q, sess store.Session, event, month string, at time.Time) error {
	m, _ := time.Parse(monthLayout, month) // validated by the caller
	return notifications.Notify(ctx, q, sess.Workspace.ID, event, map[string]any{"month": m.Format("January 2006"),
		"actor": notifications.Actor(sess.User), "actor_id": sess.User.ID}, store.NotifyTo{Roles: notifications.Managers, Except: sess.User.ID}, at)
}

func (s *Service) closePeriod(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Month string `json:"month"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	now := s.now().Truncate(time.Microsecond) // what timestamptz keeps
	if _, err := time.Parse(monthLayout, body.Month); err != nil {
		return validationFailed(map[string]string{"month": "Use a month such as 2026-10."})
	}
	// YYYY-MM strings sort as months do
	if body.Month >= now.In(sess.Workspace.Location()).Format(monthLayout) {
		return validationFailed(map[string]string{"month": "That month has not ended yet."})
	}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		closed, err := q.ClosePeriod(r.Context(), sess.Workspace.ID, body.Month, &sess.User.ID, now)
		if err != nil {
			return err
		}
		if !closed {
			return auth.Error(http.StatusConflict, "conflict", "That month is already closed.", nil)
		}
		if err := q.LogEvent(r.Context(), periodEvent(sess, "period.closed", body.Month, "", now)); err != nil {
			return err
		}
		return notifyPeriod(r.Context(), q, sess, "period.closed", body.Month, now)
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(period{Month: body.Month, ClosedAt: now,
		ClosedBy: &person{ID: sess.User.ID, Name: sess.User.Name, AvatarURL: sess.User.AvatarURL}}))
	return nil
}

func (s *Service) reopenPeriod(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	month := r.PathValue("month")
	if _, err := time.Parse(monthLayout, month); err != nil {
		return badQuery("month must look like 2026-10.")
	}
	// The reason is optional for older clients; it goes into the audit log with the reopening.
	var body struct {
		Reason string `json:"reason"`
	}
	if r.ContentLength != 0 && !s.auth.Decode(w, r, &body) {
		return nil
	}
	reason := strings.TrimSpace(body.Reason)
	if utf8.RuneCountInString(reason) > maxReason {
		return validationFailed(map[string]string{"reason": "Keep the reason under 500 characters."})
	}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		reopened, err := q.ReopenPeriod(r.Context(), sess.Workspace.ID, month)
		if err != nil {
			return err
		}
		if !reopened {
			return store.ErrNotFound
		}
		if err := q.LogEvent(r.Context(), periodEvent(sess, "period.reopened", month, reason, s.now())); err != nil {
			return err
		}
		return notifyPeriod(r.Context(), q, sess, "period.reopened", month, s.now())
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]string{"month": month}))
	return nil
}

const maxReason = 500

// maxActivityMonths bounds one activity request: three years of months.
const maxActivityMonths = 36

type activityTotal struct {
	Currency string      `json:"currency"`
	Amount   store.Money `json:"amount"`
}

type activitySource struct {
	Recorded int             `json:"recorded"`
	Drafts   int             `json:"drafts"`
	Totals   []activityTotal `json:"totals"`
}

type monthActivity struct {
	Month string `json:"month"`
	// nil when the session may not read that kind of record.
	Invoices *activitySource `json:"invoices"`
	Expenses *activitySource `json:"expenses"`
}

// periodActivity: per month from..to, what was issued and booked, its totals per currency and the drafts dated in
// it, so a month can be checked before it is closed.
func (s *Service) periodActivity(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	q := r.URL.Query()
	from, errFrom := time.Parse(monthLayout, q.Get("from"))
	to, errTo := time.Parse(monthLayout, q.Get("to"))
	if errFrom != nil || errTo != nil {
		return badQuery("from and to must look like 2026-10.")
	}
	months := (to.Year()-from.Year())*12 + int(to.Month()-from.Month()) + 1
	if months < 1 || months > maxActivityMonths {
		return badQuery("from must not be after to, and at most 36 months apart.")
	}
	invoices := permissions.Allows(sess.Role, sess.Scopes, "read:invoices")
	expenses := permissions.Allows(sess.Role, sess.Scopes, "read:expenses")
	rows, err := s.db.PeriodActivity(r.Context(), sess.Workspace.ID, from.Format(monthLayout), to.Format(monthLayout),
		invoices, expenses)
	if err != nil {
		return err
	}
	out := make([]monthActivity, months)
	index := map[string]*monthActivity{}
	source := func() *activitySource { return &activitySource{Totals: []activityTotal{}} }
	for i := range out {
		m := &out[i]
		m.Month = from.AddDate(0, i, 0).Format(monthLayout)
		if invoices {
			m.Invoices = source()
		}
		if expenses {
			m.Expenses = source()
		}
		index[m.Month] = m
	}
	for _, row := range rows {
		m := index[row.Month]
		src := m.Invoices
		if row.Source == "expenses" {
			src = m.Expenses
		}
		src.Recorded += row.Recorded
		src.Drafts += row.Drafts
		if row.Total != 0 {
			src.Totals = append(src.Totals, activityTotal{Currency: row.Currency, Amount: row.Total})
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

// ---- audit log ----

type event struct {
	Seq         int64           `json:"seq"`
	Kind        string          `json:"kind"`
	Category    string          `json:"category"`
	SubjectType string          `json:"subject_type"`
	SubjectID   string          `json:"subject_id"`
	Subject     *subject        `json:"subject"`
	Actor       *person         `json:"actor"`
	Origin      *string         `json:"origin"` // "imported" for what an import wrote, else null
	At          time.Time       `json:"at"`
	Payload     json.RawMessage `json:"payload"`
	PrevHash    string          `json:"prev_hash"`
	Hash        string          `json:"hash"`
}

// subject is the event's record as it is now, for a readable entry; the hashed payload stays the record of the time.
type subject struct {
	Number   *string `json:"number"`
	Party    *string `json:"party"`
	Currency *string `json:"currency"`
}

func (s *Service) auditLog(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	f, limit, err := auditQuery(r.URL.Query())
	if err != nil {
		return err
	}
	list, err := s.db.AuditEntries(r.Context(), sess.Workspace.ID, f, limit+1)
	if err != nil {
		return err
	}
	var next *string
	if len(list) > limit {
		list = list[:limit]
		v := strconv.FormatInt(list[limit-1].Seq, 10)
		next = &v
	}
	names, out := s.people(), make([]event, len(list))
	for i, e := range list {
		actor, err := names.get(r.Context(), e.ActorID)
		if err != nil {
			return err
		}
		var sub *subject
		if e.Number != nil || e.Party != nil || e.Currency != nil {
			sub = &subject{e.Number, e.Party, e.Currency}
		}
		out[i] = event{e.Seq, e.Kind, e.Category, e.SubjectType, e.SubjectID, sub, actor, e.Origin, e.At, e.Payload, e.PrevHash, e.Hash}
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out, "meta": map[string]any{"next_cursor": next}})
	return nil
}

// auditQuery reads the list's paging and filters.
func auditQuery(q url.Values) (store.AuditFilter, int, error) {
	var f store.AuditFilter
	if v := q.Get("cursor"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			return f, 0, badQuery("cursor must be the last seq read.")
		}
		f.After = n
	}
	limit := 50
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 200 {
			return f, 0, badQuery("limit must be a whole number from 1 to 200.")
		}
		limit = n
	}
	switch q.Get("order") {
	case "", "oldest":
	case "newest":
		f.Newest = true
	default:
		return f, 0, badQuery("order must be oldest or newest.")
	}
	if f.Category = q.Get("category"); f.Category != "" && !slices.Contains(store.AuditCategories, f.Category) {
		return f, 0, badQuery("category must be one of " + strings.Join(store.AuditCategories, ", ") + ".")
	}
	f.ActorID = q.Get("actor")
	if f.Origin = q.Get("origin"); f.Origin != "" && f.Origin != "imported" {
		return f, 0, badQuery("origin must be imported.")
	}
	for name, dst := range map[string]**time.Time{"since": &f.Since, "before": &f.Before} {
		if v := q.Get(name); v != "" {
			t, err := time.Parse(time.RFC3339, v)
			if err != nil {
				return f, 0, badQuery(name + " must be an RFC 3339 time.")
			}
			*dst = &t
		}
	}
	f.Search = strings.TrimSpace(q.Get("q"))
	if utf8.RuneCountInString(f.Search) > 200 {
		return f, 0, badQuery("q must be at most 200 characters.")
	}
	return f, limit, nil
}

// auditPeople lists who appears in the log, for the person filter.
func (s *Service) auditPeople(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	users, err := s.db.AuditActors(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	out := make([]person, len(users))
	for i, u := range users {
		out[i] = person{u.ID, u.Name, u.AvatarURL}
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

func (s *Service) exportLog(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	const pageSize = 1000
	// read the first page before writing headers, so a failing query still answers with an error
	page, err := s.db.Events(r.Context(), sess.Workspace.ID, 0, pageSize)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition",
		`attachment; filename="audit-log-`+sess.Workspace.Today(s.now())+`.csv"`)
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte("\ufeff")) // headers are sent; a write error means the client left
	out := csv.NewWriter(w)
	_ = out.Write([]string{"seq", "at", "kind", "subject_type", "subject_id", "actor", "payload", "prev_hash", "hash"})
	names := s.people()
	for {
		for _, e := range page {
			actor, err := names.get(r.Context(), e.ActorID)
			if err != nil {
				return err
			}
			name := ""
			if actor != nil {
				name = actor.Name
			}
			row := []string{strconv.FormatInt(e.Seq, 10), e.At.UTC().Format(time.RFC3339Nano), e.Kind, e.SubjectType,
				e.SubjectID, name, string(e.Payload), e.PrevHash, e.Hash}
			for i := range row {
				row[i] = cell(row[i])
			}
			_ = out.Write(row)
		}
		if len(page) < pageSize {
			break
		}
		if page, err = s.db.Events(r.Context(), sess.Workspace.ID, page[len(page)-1].Seq, pageSize); err != nil {
			return err
		}
	}
	out.Flush()
	return nil
}

// cell keeps a spreadsheet from running a value as a formula, as the clients export does: text starting with
// = + - @ tab or CR gets a leading apostrophe, unless it is just a number.
func cell(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		if _, err := strconv.ParseFloat(v, 64); err != nil {
			return "'" + v
		}
	}
	return v
}

func (s *Service) verifyLog(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ok, brokenAt, err := s.db.VerifyChain(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	var at *int64
	if !ok {
		at = &brokenAt
	}
	entries, err := s.db.EventCount(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"ok": ok, "broken_at": at, "entries": entries}))
	return nil
}

// ---- self-billing agreements ----

// clientAgreements lists the agreements of a client of the workspace; ErrNotFound for any other client.
func (s *Service) clientAgreements(ctx context.Context, sess store.Session, clientID string) ([]store.SelfBillingAgreement, error) {
	if _, err := s.db.Client(ctx, sess.Workspace.ID, clientID); err != nil {
		return nil, err
	}
	return s.db.Agreements(ctx, sess.Workspace.ID, clientID)
}

func (s *Service) agreements(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.clientAgreements(r.Context(), sess, r.PathValue("id"))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

type agreementInput struct {
	StartsOn   string  `json:"starts_on"`
	EndsOn     *string `json:"ends_on"`
	AcceptedAt *string `json:"accepted_at"`
	AcceptedBy *string `json:"accepted_by"`
	Note       *string `json:"note"`
}

// agreement validates the input into a new agreement of the client.
func (in agreementInput) agreement(sess store.Session, clientID string, now time.Time) (store.SelfBillingAgreement, error) {
	a := store.SelfBillingAgreement{ID: auth.NewID("sba"), WorkspaceID: sess.Workspace.ID, ClientID: clientID,
		StartsOn: in.StartsOn, EndsOn: in.EndsOn, CreatedAt: now}
	invalid := map[string]string{}
	if _, err := time.Parse(time.DateOnly, in.StartsOn); err != nil {
		invalid["starts_on"] = "Use a date such as 2026-01-01."
	}
	if in.EndsOn != nil {
		if _, err := time.Parse(time.DateOnly, *in.EndsOn); err != nil {
			invalid["ends_on"] = "Use a date such as 2026-12-31."
		} else if *in.EndsOn < in.StartsOn {
			invalid["ends_on"] = "The end cannot be before the start."
		}
	}
	if in.AcceptedAt != nil {
		t, err := time.Parse(time.RFC3339, *in.AcceptedAt)
		if err != nil {
			invalid["accepted_at"] = "Use a date and time such as 2026-01-01T10:00:00Z."
		} else if t.After(now) {
			invalid["accepted_at"] = "The supplier's acceptance cannot be in the future."
		}
		t = t.UTC()
		a.AcceptedAt = &t
	}
	var ok bool
	if a.AcceptedBy, ok = text(in.AcceptedBy, 200); !ok {
		invalid["accepted_by"] = "Use at most 200 characters."
	}
	if a.Note, ok = text(in.Note, 1000); !ok {
		invalid["note"] = "Use at most 1000 characters."
	}
	if len(invalid) > 0 {
		return a, validationFailed(invalid)
	}
	return a, nil
}

// text trims v, blank meaning nil; ok is false past max characters.
func text(v *string, max int) (*string, bool) {
	if v == nil {
		return nil, true
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil, true
	}
	return &t, utf8.RuneCountInString(t) <= max
}

func (s *Service) createAgreement(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	clientID := r.PathValue("id")
	if _, err := s.db.Client(r.Context(), sess.Workspace.ID, clientID); err != nil {
		return err
	}
	var in agreementInput
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	a, err := in.agreement(sess, clientID, s.now().Truncate(time.Microsecond))
	if err != nil {
		return err
	}
	if err := s.db.CreateAgreement(r.Context(), a); err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(a))
	return nil
}

func (s *Service) deleteAgreement(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canManage(sess) {
		return errForbidden
	}
	list, err := s.clientAgreements(r.Context(), sess, r.PathValue("id"))
	if err != nil {
		return err
	}
	id := r.PathValue("agreementId")
	found := false
	for _, a := range list {
		found = found || a.ID == id
	}
	if !found {
		return store.ErrNotFound
	}
	if err := s.db.DeleteAgreement(r.Context(), sess.Workspace.ID, id); err != nil {
		if errors.Is(err, store.ErrAgreementUsed) {
			return auth.Error(http.StatusConflict, "invalid_state",
				"Issued invoices relied on this agreement, so it stays on record.", nil)
		}
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
