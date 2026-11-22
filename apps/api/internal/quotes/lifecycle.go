package quotes

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

const (
	maxRecipients = 10
	maxNote       = 1000
)

var titles = map[string]string{"de": "Offerte", "fr": "Offre", "it": "Offerta", "en": "Quote"}

func swissDate(d string) string {
	t, err := time.Parse(time.DateOnly, d)
	if err != nil {
		return d
	}
	return t.Format("02.01.2006")
}

// send numbers a draft on its first send, files its PDF and emails it; a sent quote is emailed again as it was.
// email false only marks it sent (handed over another way); the client sees it in the portal either way.
func (s *Service) send(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		To      []string `json:"to"`
		Cc      []string `json:"cc"`
		Subject *string  `json:"subject"`
		Message *string  `json:"message"`
		Email   *bool    `json:"email"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	email := body.Email == nil || *body.Email
	if email && s.mail == nil {
		return auth.Error(http.StatusServiceUnavailable, "mail_unavailable", "Email is not set up on this server.", nil)
	}
	ctx, id, now := r.Context(), r.PathValue("id"), s.now()
	err := s.db.Tx(ctx, func(q store.Q) error {
		t, err := q.Quote(ctx, sess.Workspace.ID, id, today(sess.Workspace, now), true)
		if err != nil {
			return err
		}
		switch t.Status {
		case "draft", "sent":
		case "expired":
			return invalidState("This quote has expired: revise it with a new valid-until date to send it again.")
		default:
			return invalidState("This quote is already answered.")
		}
		if t.Number == nil { // a refused email below rolls the counter and the count back with the rest
			if err := q.CountQuoteIssue(ctx, sess.Workspace.ID, t.ID, now); err != nil {
				return err
			}
			year, _ := strconv.Atoi(t.IssueDate[:4])
			for t.Number == nil { // an imported quote may hold a number of the series already: take the next free one
				seq, err := q.NextQuoteNumber(ctx, sess.Workspace.ID, year)
				if err != nil {
					return err
				}
				n, err := s.invoices.QuoteNumber(ctx, q, sess.Workspace.ID, t.IssueDate, seq)
				if err != nil {
					return err
				}
				if taken, err := q.SimilarQuote(ctx, sess.Workspace.ID, "", n); err != nil {
					return err
				} else if taken == nil {
					t.Number = &n
				}
			}
		}
		if t.Status == "draft" { // the client accepts the schedule with the quote: it must hold as sent
			if err := s.approvals.Gate(ctx, q, sess.Workspace.ID, approvalDoc(t)); err != nil {
				return err
			}
			if err := s.invoices.QuoteScheduleProblems(asInvoice(t)); err != nil {
				return err
			}
		}
		var m mail.Message
		if email {
			if m, err = s.message(ctx, q, sess.Workspace.ID, t, body.To, body.Cc, body.Subject, body.Message); err != nil {
				return err
			}
			if m.ReplyTo == "" { // without a company email, the member who sends gets the answer
				m.ReplyTo = sess.User.Email
			}
		}
		var pdf []byte
		if t.Status == "draft" || t.PDFKey == nil {
			if pdf, err = s.invoices.QuotePDF(ctx, q, sess.Workspace.ID, asInvoice(t), false); err != nil {
				return err
			}
			key := fmt.Sprintf("quotes/%s/%s-r%d.pdf", sess.Workspace.ID, t.ID, t.Revision)
			if err := q.ReserveObject(ctx, sess.Workspace.ID, key, int64(len(pdf)), false, now); err != nil {
				return err
			}
			if err := s.files.Put(ctx, key, bytes.NewReader(pdf), int64(len(pdf)), "application/pdf", FileName(t)); err != nil {
				return fmt.Errorf("store quote pdf: %w", err)
			}
			t.PDFKey = &key
			if err := q.FileClientRecord(ctx, sess.Workspace.ID, t.ClientID, "quotes", store.YearOf(t.IssueDate, now), sess.User.ID,
				store.RecordPDF(auth.NewID("doc"), key, FileName(t), pdf, now), "", ""); err != nil {
				return err
			}
		} else if pdf, err = s.files.Get(ctx, *t.PDFKey); err != nil {
			return err
		}
		t.Status, t.SentAt = "sent", &now
		if err := q.SaveQuote(ctx, sess.Workspace.ID, t, now); err != nil {
			return err
		}
		if !email {
			return nil
		}
		m.Attachments = []mail.Attachment{{Name: FileName(t), ContentType: "application/pdf", Data: pdf}}
		// last, so a failed email leaves the quote as it was
		if err := s.mail.Send(ctx, m); err != nil {
			return fmt.Errorf("send quote %s: %w", t.ID, err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

// message: the email of a quote, the client's address and the default wording unless given.
func (s *Service) message(ctx context.Context, q store.Q, workspaceID string, t store.Quote, to, cc []string, subject,
	message *string) (mail.Message, error) {
	invalid := map[string]string{}
	if len(to) == 0 {
		to = clientAddress(ctx, q, workspaceID, t.ClientID)
	}
	to, cc = addresses(invalid, "to", to), addresses(invalid, "cc", cc)
	if len(to) == 0 && invalid["to"] == "" {
		invalid["to"] = "Enter an address: the client has no email address."
	}
	seller, _, _, err := s.invoices.Seller(ctx, q, workspaceID)
	if err != nil {
		return mail.Message{}, err
	}
	draft, err := s.draftText(ctx, q, workspaceID, t)
	if err != nil {
		return mail.Message{}, err
	}
	// the dialog posts the rendered draft back: it passes as it is, since only a typed text is held to the limit
	if subject != nil && (strings.TrimSpace(*subject) == "" ||
		utf8.RuneCountInString(*subject) > 200 && strings.TrimSpace(*subject) != strings.TrimSpace(draft.Subject)) {
		invalid["subject"] = "Enter a subject of at most 200 characters."
	}
	if message != nil && (strings.TrimSpace(*message) == "" ||
		utf8.RuneCountInString(*message) > emailtemplate.MaxMessage && strings.TrimSpace(*message) != strings.TrimSpace(draft.Body)) {
		invalid["message"] = fmt.Sprintf("Enter a message of at most %d characters.", emailtemplate.MaxMessage)
	}
	if len(invalid) > 0 {
		return mail.Message{}, validationFailed(invalid)
	}
	m := mail.Message{Workspace: workspaceID, Language: t.Language, To: to, Cc: cc, Subject: draft.Subject, Text: draft.Body}
	if subject != nil {
		m.Subject = strings.TrimSpace(*subject)
	}
	if message != nil {
		m.Text = *message
	}
	m.HTML = "<p>" + strings.ReplaceAll(html.EscapeString(m.Text), "\n", "<br>\n") + "</p>"
	if seller.Email != nil {
		m.ReplyTo = *seller.Email
	}
	return m, nil
}

// addresses validates and lowercases a recipient list (at most maxRecipients, each once).
func addresses(invalid map[string]string, key string, in []string) []string {
	out := []string{}
	if len(in) > maxRecipients {
		invalid[key] = fmt.Sprintf("Use at most %d addresses.", maxRecipients)
		return out
	}
	for _, a := range in {
		v, msg := clients.NormaliseEmail(strings.TrimSpace(a))
		if msg != "" {
			invalid[key] = fmt.Sprintf("%q is not a valid email address.", a)
			continue
		}
		if !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return out
}

// Note reads an optional decision note: trimmed, nil when empty, at most maxNote characters.
func Note(raw *string) (*string, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	v := strings.TrimSpace(*raw)
	if utf8.RuneCountInString(v) > maxNote {
		return nil, validationFailed(map[string]string{"note": fmt.Sprintf("Use at most %d characters.", maxNote)})
	}
	return &v, nil
}

// Decide records the answer to a sent quote in the caller's transaction. clientID set is the client in the portal:
// it answers only its own quotes, not after valid_until, and its answer notifies owners and admins. Staff ("" client)
// record an answer given another way, also after valid_until.
func Decide(ctx context.Context, q store.Q, ws store.Workspace, id, clientID string, accept bool, note *string, now time.Time) (store.Quote, error) {
	t, err := q.Quote(ctx, ws.ID, id, ws.Today(now), true)
	if err != nil {
		return t, err
	}
	if clientID != "" && (t.ClientID != clientID || t.Status == "draft") {
		return t, store.ErrNotFound
	}
	switch {
	case t.Status == "expired" && clientID != "":
		return t, invalidState("This quote has expired. Ask for a new one.")
	case t.Status != "sent" && t.Status != "expired":
		return t, invalidState("Only a sent quote can be accepted or declined.")
	}
	by := "staff"
	if clientID != "" {
		by = "client"
	}
	t.Status, t.DecidedAt, t.DecidedBy, t.DecisionNote = "declined", &now, &by, note
	if accept {
		t.Status = "accepted"
	}
	if err := q.SaveQuote(ctx, ws.ID, t, now); err != nil {
		return t, err
	}
	if clientID == "" {
		return t, nil
	}
	payload := map[string]any{"quote_id": t.ID, "quote_number": *t.Number, "client_id": t.ClientID, "client_name": t.Client.Name}
	if note != nil {
		payload["note"] = *note
	}
	return t, notifications.Notify(ctx, q, ws.ID, "quote."+t.Status, payload, store.NotifyTo{Roles: notifications.Managers}, now)
}

func (s *Service) decide(accept bool) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		var body struct {
			Note *string `json:"note"`
		}
		if !s.auth.Decode(w, r, &body) {
			return nil
		}
		note, err := Note(body.Note)
		if err != nil {
			return err
		}
		ctx, id := r.Context(), r.PathValue("id")
		if err := s.db.Tx(ctx, func(q store.Q) error {
			_, err := Decide(ctx, q, sess.Workspace, id, "", accept, note, s.now())
			return err
		}); err != nil {
			return err
		}
		return s.respond(w, r, sess, http.StatusOK, id)
	}
}

// revise turns a sent, expired or declined quote back into a draft of the next revision, keeping its number; the
// client sees it again once it is sent.
func (s *Service) revise(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id, now := r.Context(), r.PathValue("id"), s.now()
	err := s.db.Tx(ctx, func(q store.Q) error {
		t, err := q.Quote(ctx, sess.Workspace.ID, id, today(sess.Workspace, now), true)
		if err != nil {
			return err
		}
		switch t.Status {
		case "sent", "expired", "declined":
		case "draft":
			return invalidState("This quote is already a draft.")
		default:
			return invalidState("An accepted quote is agreed: make an invoice from it instead.")
		}
		t.Status, t.Revision, t.PDFKey = "draft", t.Revision+1, nil
		t.DecidedAt, t.DecidedBy, t.DecisionNote = nil, nil, nil
		if err := q.SaveQuote(ctx, sess.Workspace.ID, t, now); err != nil {
			return err
		}
		// the approval was for the revision sent: the next one is approved again
		return s.approvals.Reset(ctx, q, sess, approvalDoc(t))
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

// duplicate makes a new draft with another quote's content, dated today and valid for as many days as the original;
// it gets its own number on its first send.
func (s *Service) duplicate(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, now, id := r.Context(), s.now(), auth.NewID("quo")
	day := today(sess.Workspace, now)
	err := s.db.Tx(ctx, func(q store.Q) error {
		src, err := q.Quote(ctx, sess.Workspace.ID, r.PathValue("id"), day, false)
		if err != nil {
			return err
		}
		if _, err := q.Client(ctx, sess.Workspace.ID, src.ClientID); errors.Is(err, store.ErrNotFound) {
			return invalidState("The client of this quote was deleted.")
		} else if err != nil {
			return err
		}
		t := src
		t.ID, t.Number, t.Revision, t.Status, t.PDFKey, t.Invoice = id, nil, 1, "draft", nil, nil
		t.SentAt, t.DecidedAt, t.DecidedBy, t.DecisionNote = nil, nil, nil, nil
		t.IssueDate, t.ValidUntil = day, addDays(day, validDays(src))
		t.Lines = make([]store.InvoiceLine, len(src.Lines))
		for i, l := range src.Lines {
			l.ID = auth.NewID("lin")
			t.Lines[i] = l
		}
		t.Instalments = carrySchedule(src.Instalments, day)
		if t.Instalments != nil { // as on create: the invoice made from it needs the feature
			if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureInvoiceInstalments); err != nil {
				return err
			}
		}
		return q.SaveQuote(ctx, sess.Workspace.ID, t, now)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, id)
}

// validDays: how long the quote was valid from its date, the default for a span that cannot be read.
func validDays(t store.Quote) int {
	from, err1 := time.Parse(time.DateOnly, t.IssueDate)
	until, err2 := time.Parse(time.DateOnly, t.ValidUntil)
	if err1 != nil || err2 != nil || until.Before(from) {
		return defaultValidDays
	}
	return int(until.Sub(from).Hours() / 24)
}

var errInvoiced = auth.Error(http.StatusConflict, "quote_invoiced", "An invoice was already made from this quote.", nil)

// toInvoice makes an invoice draft of an accepted quote, once: the quote and the draft name each other.
func (s *Service) toInvoice(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id, now := r.Context(), r.PathValue("id"), s.now()
	err := s.db.Tx(ctx, func(q store.Q) error {
		t, err := q.Quote(ctx, sess.Workspace.ID, id, today(sess.Workspace, now), true)
		if err != nil {
			return err
		}
		if t.Status != "accepted" {
			return invalidState("Only an accepted quote becomes an invoice.")
		}
		if t.Invoice != nil {
			return errInvoiced
		}
		invoiceID, err := s.invoices.CreateDraft(ctx, q, sess, t.ClientID, func(inv *store.Invoice) {
			inv.Currency, inv.Language, inv.VATMode, inv.DiscountPercent = t.Currency, t.Language, t.VATMode, t.DiscountPercent
			inv.Intro, inv.Footer = t.Intro, t.Footer
			if t.Reference != nil {
				inv.Reference = t.Reference
			}
			inv.ClientNumberDisplay, inv.ContractReference, inv.ContractDocument = t.ClientNumberDisplay, t.ContractReference, t.ContractDocument
			inv.Lines = slices.Clone(t.Lines)
			inv.Instalments = carrySchedule(t.Instalments, inv.IssueDate)
		})
		if err != nil {
			return err
		}
		t.Invoice = &store.InvoiceRef{ID: invoiceID}
		return q.SaveQuote(ctx, sess.Workspace.ID, t, now)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, id)
}

// carrySchedule: the accepted schedule for the invoice dated issueDate, amounts as accepted. When the first instalment
// would fall due before that date, every one moves by the same number of days, so they keep the spacing the client
// accepted; the quote keeps its own.
func carrySchedule(sched *store.InstalmentSchedule, issueDate string) *store.InstalmentSchedule {
	if sched == nil || len(sched.Items) == 0 {
		return nil
	}
	shift := 0
	first, err1 := time.Parse(time.DateOnly, sched.Items[0].DueDate)
	issue, err2 := time.Parse(time.DateOnly, issueDate)
	if err1 == nil && err2 == nil && first.Before(issue) {
		shift = int(issue.Sub(first).Hours() / 24)
	}
	out := &store.InstalmentSchedule{Interval: sched.Interval, Items: make([]store.InstalmentItem, len(sched.Items))}
	for i, it := range sched.Items {
		out.Items[i] = store.InstalmentItem{Seq: it.Seq, DueDate: addDays(it.DueDate, shift), Amount: it.Amount}
	}
	return out
}
