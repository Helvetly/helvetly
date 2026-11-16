// Package dunning sends payment reminders for open invoices in up to ten steps, notes before the due date among them
// (docs/invoices-contract.md "Dunning"): the hourly job, the endpoints of an invoice's dunning, the emails and the digest's "Dunning" section.
// Amounts and dates come from internal/dunningcalc, the letter from internal/invoicepdf.
package dunning

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/dunningcalc"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
}

// Storage reads the issued invoice PDFs attached to the emails.
type Storage interface {
	Get(ctx context.Context, key string) ([]byte, error)
}

// Mailer sends the notices (internal/mail); nil when no mail server is configured.
type Mailer interface {
	Send(context.Context, mail.Message) error
}

type Service struct {
	db     *store.Store
	auth   Auth
	inv    *invoices.Service
	files  Storage
	mailer Mailer
	log    *slog.Logger
	now    func() time.Time
}

func New(db *store.Store, a Auth, inv *invoices.Service, files Storage, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, inv: inv, files: files, log: log, now: func() time.Time { return time.Now().UTC() }}
}

// SetMailer enables sending.
func (s *Service) SetMailer(m Mailer) { s.mailer = m }

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
	handle("GET /api/v1/invoices/{id}/dunning", s.get)
	handle("POST /api/v1/invoices/{id}/dunning/send", s.sendNow)
	handle("POST /api/v1/invoices/{id}/dunning/pause", s.pause(true))
	handle("POST /api/v1/invoices/{id}/dunning/resume", s.pause(false))
	handle("GET /api/v1/invoices/{id}/dunning/{level}/pdf", s.pdf)
}

// Notice is a sent notice with its title in the invoice's language.
type Notice struct {
	store.DunningNotice
	Title string `json:"title"`
}

// Next is the step that goes out next and the day it is due.
type Next struct {
	Level  int    `json:"level"`
	Levels int    `json:"levels"`
	Title  string `json:"title"`
	DueOn  string `json:"due_on"`
}

// Status is an invoice's dunning (GET /invoices/{id}/dunning).
type Status struct {
	Applies       bool     `json:"applies"`        // issued, open, receivable, no instalments
	Enabled       bool     `json:"enabled"`        // settings.dunning.enabled
	ClientEnabled bool     `json:"client_enabled"` // the client's dunning_enabled
	Paused        bool     `json:"paused"`
	Next          *Next    `json:"next"` // null when no step is left or nothing is open
	Notices       []Notice `json:"notices"`
}

// state is what one invoice's dunning needs, read in one go.
type state struct {
	inv     store.Invoice
	set     invoices.DunningSettings
	notices []store.DunningNotice
	Status
}

func (s *Service) load(ctx context.Context, q store.Q, ws store.Workspace, id string) (state, error) {
	var st state
	var err error
	today := ws.Today(s.now())
	if st.inv, err = q.Invoice(ctx, ws.ID, id, today, false); err != nil {
		return st, err
	}
	if st.set, err = s.inv.DunningSettingsOf(ctx, q, ws.ID); err != nil {
		return st, fmt.Errorf("dunning settings: %w", err)
	}
	if st.Applies, st.Paused, st.ClientEnabled, err = q.DunningFlags(ctx, ws.ID, id); err != nil {
		return st, err
	}
	if st.notices, err = q.DunningNotices(ctx, ws.ID, id); err != nil {
		return st, err
	}
	st.Enabled, st.Notices = st.set.Enabled, make([]Notice, len(st.notices))
	for i, n := range st.notices {
		_, title := st.words(n)
		st.Notices[i] = Notice{DunningNotice: n, Title: title}
	}
	steps := st.set.CalcSteps()
	last, lastSentOn := 0, ""
	if len(st.notices) > 0 {
		last, lastSentOn = st.notices[len(st.notices)-1].Level, st.notices[len(st.notices)-1].SentOn
	}
	if step := dunningcalc.Next(st.inv.IssueDate, st.inv.DueDate, today, last, steps); st.Applies && st.inv.AmountDue > 0 && step > 0 {
		_, title := st.set.Words(st.inv.Language, step, steps[step-1].Timing == dunningcalc.BeforeDue)
		st.Next = &Next{Level: step, Levels: len(steps), Title: title, DueOn: dunningcalc.DueOn(st.inv.DueDate, lastSentOn, steps, step)}
	}
	return st, nil
}

// words: the wording and title of sent notice n. One sent before titles were stored is named as it was then, by its
// level of the three levels; the step's current text replaces the sentence either way.
func (st state) words(n store.DunningNotice) (invoicepdf.Words, string) {
	if n.StoredTitle == nil {
		w := invoicepdf.ReminderWords(st.inv.Language, n.Level, n.Levels, false)
		return w, w.Title
	}
	w, _ := st.set.Words(st.inv.Language, n.Level, beforeDue(st.inv, n.SentOn))
	return w, *n.StoredTitle
}

// beforeDue: a notice sent on or before the due date is a friendly note: no fee, no interest, no overdue wording.
func beforeDue(inv store.Invoice, on string) bool { return on <= inv.DueDate }

// notice: the next notice of st, sent on the civil date on to email; its interest runs from the day after the due
// date or after the first notice after it (settings), at the rate configured now. A note before the due date
// charges no fee.
func (st state) notice(on, email string, at time.Time) store.DunningNotice {
	step := st.set.Steps[st.Next.Level-1]
	first := ""
	for _, n := range st.notices {
		if !beforeDue(st.inv, n.SentOn) {
			first = n.SentOn
			break
		}
	}
	rate, from := st.set.Rate(), ""
	if rate > 0 {
		from = dunningcalc.InterestFrom(st.set.InterestFrom == "due_date", st.inv.DueDate, first)
	}
	fee := step.Fee
	if beforeDue(st.inv, on) {
		fee = 0
	}
	_, title := st.set.Words(st.inv.Language, st.Next.Level, beforeDue(st.inv, on))
	a := dunningcalc.Notice(st.inv.AmountDue, fee, rate, from, on, st.inv.Currency)
	n := store.DunningNotice{InvoiceID: st.inv.ID, Level: st.Next.Level, Levels: st.Next.Levels, SentAt: at, SentOn: on, Open: a.Open,
		Fee: a.Fee, Interest: a.Interest, Total: a.Total, Email: email, StoredTitle: &title, QRBill: step.QRBill}
	if a.Interest > 0 {
		n.InterestRate, n.InterestFrom = rate, &from
	}
	return n
}

var errChanged = auth.Error(http.StatusConflict, "invalid_state", "The invoice changed while the reminder was prepared: try again.", nil)

var errNoMail = auth.Error(http.StatusServiceUnavailable, "mail_unavailable", "Email is not set up on this server.", nil)

// send sends the next notice of invoice id: the notice row goes in first, in a transaction that rolls back when the
// email fails, so a failed send leaves no row and a concurrent run waits on the row's key, then sends nothing.
// by is who pressed "Send now" (the next step goes whether or not it is due, paused or opted out), nil for the
// hourly job. It reports whether a notice went out.
func (s *Service) send(ctx context.Context, ws store.Workspace, id string, by *store.User) (bool, error) {
	if s.mailer == nil {
		return false, errNoMail
	}
	// Reminders wait while the plan lacks them: the job sends nothing and resumes on a plan with them.
	if err := s.db.RequireFeature(ctx, ws.ID, store.FeatureInvoiceReminders); err != nil {
		if by == nil && errors.Is(err, store.ErrFeatureDenied) {
			return false, nil
		}
		return false, err
	}
	st, err := s.load(ctx, s.db.Q, ws, id)
	if err != nil {
		return false, err
	}
	now := s.now()
	if by == nil && (st.Next == nil || !st.Enabled || st.Paused || !st.ClientEnabled || ws.Today(now) < st.Next.DueOn) {
		return false, nil // changed since the job listed it
	}
	if st.Next == nil {
		return false, auth.Error(http.StatusConflict, "invalid_state", "No reminder is left to send for this invoice.", nil)
	}
	email, err := s.db.DunningRecipient(ctx, ws.ID, id)
	if err != nil {
		return false, err
	}
	if email == "" {
		return false, auth.Error(http.StatusConflict, "invalid_state", "The client has no email address.", nil)
	}
	n := st.notice(ws.Today(now), email, now)
	letter, err := s.letter(ctx, ws, st, n)
	if err != nil {
		return false, err
	}
	invoicePDF, err := s.invoicePDF(ctx, st.inv)
	if err != nil {
		return false, err
	}
	// One automatic action per notice, whoever pressed "Send now" (running an automation now is still one).
	action := "dunning:" + id + ":" + strconv.Itoa(n.Level)
	if err := s.db.ReserveAutomation(ctx, ws.ID, action, now); err != nil {
		if by == nil && errors.Is(err, store.ErrAdmissionDenied) {
			return false, nil // paused: the notice waits for a plan with room, a new month or more seats
		}
		return false, err
	}
	sent := false
	err = s.db.Tx(ctx, func(q store.Q) error {
		var sentBy *string
		data := map[string]any{"invoice_id": st.inv.ID, "number": deref(st.inv.Number), "client": st.inv.Client.Name,
			"level": n.Level, "title": *n.StoredTitle, "amount": n.Total.String(), "currency": st.inv.Currency}
		to := store.NotifyTo{Roles: notifications.Managers}
		if by != nil {
			sentBy, to.Except, data["actor"] = &by.ID, by.ID, notifications.Actor(*by)
		}
		// The notice was computed outside this transaction: under the invoice's lock (a payment, credit or void takes
		// it too) it goes out only if the invoice is still what it was computed from.
		cur, err := q.Invoice(ctx, ws.ID, id, ws.Today(now), true)
		if err != nil {
			return err
		}
		if cur.Status != st.inv.Status || cur.AmountDue != st.inv.AmountDue {
			return errChanged
		}
		won, err := q.LogDunningNotice(ctx, ws.ID, n, sentBy)
		if err != nil || !won {
			return err
		}
		if err := q.SettleAutomation(ctx, ws.ID, action, now); err != nil {
			return err
		}
		if err := notifications.Notify(ctx, q, ws.ID, "dunning.sent", data, to, now); err != nil {
			return err
		}
		if err := s.mailer.Send(ctx, st.message(n, letter, invoicePDF)); err != nil {
			return fmt.Errorf("send: %w", err)
		}
		sent = true
		return nil
	})
	if err == nil && !sent || errors.Is(err, errChanged) { // nothing went: what is due is computed again next time
		if rerr := s.db.ReleaseAutomation(context.WithoutCancel(ctx), ws.ID, action); rerr != nil {
			return false, errors.Join(err, rerr)
		}
	}
	if errors.Is(err, errChanged) && by == nil {
		return false, nil // the next run computes it again
	}
	return sent, err
}

// text: the own text of step (1-based), nil for the standard sentence.
func (st state) text(step int) *string {
	if step > len(st.set.Steps) {
		return nil
	}
	return st.set.Steps[step-1].Text
}

// letter renders the PDF of notice n.
func (s *Service) letter(ctx context.Context, ws store.Workspace, st state, n store.DunningNotice) ([]byte, error) {
	from := ""
	if n.InterestFrom != nil {
		from = *n.InterestFrom
	}
	w, title := st.words(n)
	out, err := s.inv.ReminderPDF(ctx, ws, st.inv, invoicepdf.Notice{Words: w, Title: title, SentOn: n.SentOn, Rate: n.InterestRate,
		InterestFrom: from, Amounts: dunningcalc.Amounts{Open: n.Open, Fee: n.Fee, Interest: n.Interest, Total: n.Total,
			Days: dunningcalc.Days(from, n.SentOn)}, Text: st.text(n.Level)}, n.QRBill)
	if err != nil {
		return nil, fmt.Errorf("reminder pdf: %w", err)
	}
	return out, nil
}

func (s *Service) invoicePDF(ctx context.Context, inv store.Invoice) ([]byte, error) {
	if inv.PDFKey == nil {
		return nil, nil
	}
	out, err := s.files.Get(ctx, *inv.PDFKey)
	if err != nil {
		return nil, fmt.Errorf("load invoice pdf: %w", err)
	}
	return out, nil
}

// ---- handlers ----

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respond(w, r, sess)
}

func (s *Service) respond(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	st, err := s.load(r.Context(), s.db.Q, sess.Workspace, r.PathValue("id"))
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": st.Status})
	return nil
}

func (s *Service) sendNow(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	sent, err := s.send(r.Context(), sess.Workspace, r.PathValue("id"), &sess.User)
	if err != nil {
		return err
	}
	if !sent {
		return auth.Error(http.StatusConflict, "invalid_state", "This reminder was just sent.", nil)
	}
	return s.respond(w, r, sess)
}

func (s *Service) pause(paused bool) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		if err := s.db.SetDunningPaused(r.Context(), sess.Workspace.ID, r.PathValue("id"), paused); err != nil {
			return err
		}
		return s.respond(w, r, sess)
	}
}

func (s *Service) pdf(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	level, err := strconv.Atoi(r.PathValue("level"))
	if err != nil {
		return auth.ErrNotFound
	}
	st, err := s.load(ctx, s.db.Q, sess.Workspace, r.PathValue("id"))
	if err != nil {
		return err
	}
	for _, n := range st.notices {
		if n.Level != level {
			continue
		}
		out, err := s.letter(ctx, sess.Workspace, st, n)
		if err != nil {
			return err
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `inline; filename="`+st.letterName(n)+`"`)
		w.Header().Set("Cache-Control", "private, no-store")
		_, _ = w.Write(out)
		return nil
	}
	return auth.ErrNotFound
}
