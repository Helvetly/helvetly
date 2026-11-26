package invoices

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// revolutLabel is the label of the Revolut payment link line in each language.
var revolutLabel = map[string]string{"de": "Mit Revolut bezahlen", "fr": "Payer avec Revolut", "it": "Paga con Revolut",
	"en": "Pay with Revolut"}

const maxRecipients = 10

// ErrAlreadySent releases an unused worker reservation after another send won.
var ErrAlreadySent = errors.New("invoice already sent or delivery unconfirmed")

type sendOptions struct {
	ExpectedAmountDue *store.Money    `json:"expected_amount_due"`
	To                []string        `json:"to"`
	Cc                []string        `json:"cc"`
	Bcc               []string        `json:"bcc"`
	Subject           json.RawMessage `json:"subject"`
	Message           json.RawMessage `json:"message"`
	Email             *bool           `json:"email"`
	Sent              *bool           `json:"sent"`
}

func (s *Service) send(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body sendOptions
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, id := r.Context(), r.PathValue("id")
	inv, err := s.db.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	if inv.Status == "draft" || inv.Status == "void" || inv.Status == "replaced" {
		return invalidState("Only a current issued document can be sent.")
	}
	if inv.IssuedElsewhere() {
		return ErrIssuedElsewhere
	}
	if body.Email != nil && !*body.Email {
		if body.Sent != nil && !*body.Sent {
			return s.unmarkSent(w, r, sess, inv)
		}
		return s.markSent(w, r, sess, inv)
	}
	if err := s.emailInvoice(ctx, sess, inv, body, &sess.User.ID); err != nil {
		if errors.Is(err, mail.ErrUncertain) {
			return auth.Error(http.StatusBadGateway, "delivery_uncertain", "The mail server may have accepted the invoice. Check with the recipient before sending it again.", nil)
		}
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

func (s *Service) emailInvoice(ctx context.Context, sess store.Session, inv store.Invoice, body sendOptions, by *string) error {
	if body.ExpectedAmountDue != nil && *body.ExpectedAmountDue != inv.AmountDue {
		return invalidState("The balance changed. Review the invoice before sending.")
	}
	if s.mail == nil {
		return auth.Error(http.StatusServiceUnavailable, "mail_unavailable", "Email is not set up on this server.", nil)
	}
	client, clientErr, to := s.recipients(ctx, sess.Workspace.ID, inv, body.To)
	if clientErr != nil && !errors.Is(clientErr, store.ErrNotFound) {
		return clientErr
	}
	p := newParser()
	to = addresses(p, "to", to)
	cc, bcc := mail.Copies(to, addresses(p, "cc", body.Cc), addresses(p, "bcc", body.Bcc))
	if len(to) == 0 {
		p.fail("to", "Enter an address: the client has no email address.")
	}
	subject, message, err := s.draft(ctx, s.db.Q, sess.Workspace.ID, inv)
	if err != nil {
		return err
	}
	if body.Subject != nil {
		if v := p.text("subject", body.Subject, limitFor(body.Subject, subject, 200), nil); v != nil {
			subject = *v
		}
	}
	if body.Message != nil {
		if v := p.text("message", body.Message, limitFor(body.Message, message, emailtemplate.MaxMessage), nil); v != nil {
			message = withRevolut(*v, inv)
		}
	}
	if err := p.err(); err != nil {
		return err
	}
	pdf, err := s.files.Get(ctx, deref(inv.PDFKey))
	if err != nil {
		return err
	}
	m := mail.Message{Workspace: sess.Workspace.ID, Language: inv.Language, To: to, Cc: cc, Bcc: bcc, Subject: subject, Text: message,
		Attachments: []mail.Attachment{{Name: fileName(inv), ContentType: "application/pdf", Data: pdf}}}
	if inv.Seller != nil && inv.Seller.Email != nil {
		m.ReplyTo = *inv.Seller.Email
	} else { // without a company email, the member who sends gets the answer
		m.ReplyTo = sess.User.Email
	}
	if clientErr == nil && client.EInvoiceFormat != "" && client.EInvoiceFormat != "none" {
		// a client that asked for XML gets it or nothing: a PDF alone would not be the invoice it can process
		if err := s.db.RequireFeature(ctx, sess.Workspace.ID, store.FeatureEInvoiceXML); err != nil {
			return err
		}
		if s.einvoice == nil {
			return fmt.Errorf("e-invoice exporter unavailable")
		}
		format := strings.ReplaceAll(client.EInvoiceFormat, "_", "-")
		name, file, err := s.einvoice(ctx, sess, inv, format)
		if err != nil {
			return err
		}
		if format == "factur-x" { // the same pages with the XML inside: one PDF, not two
			m.Attachments[0].Data = file
		} else {
			m.Attachments = append(m.Attachments, mail.Attachment{Name: name, ContentType: "application/xml", Data: file})
		}
	}
	m = withLetter(m, inv)
	at := s.now()
	begun, err := s.db.BeginInvoiceSend(ctx, sess.Workspace.ID, inv, by != nil, at)
	if err != nil {
		return err
	}
	if !begun {
		if by == nil {
			return ErrAlreadySent
		}
		return invalidState("Another send is in progress or the invoice changed. Review it before sending.")
	}
	recordCtx := context.WithoutCancel(ctx)
	var sendErr error
	accepted := false
	err = s.db.Tx(recordCtx, func(q store.Q) error {
		current, err := q.LockInvoiceSend(recordCtx, inv, at)
		if err != nil {
			return err
		}
		if !current {
			sendErr = invalidState("The invoice changed. Review it before sending.")
		} else if err := s.mail.Send(ctx, m); err != nil {
			sendErr = fmt.Errorf("send invoice %s: %w", inv.ID, err)
		} else {
			accepted = true
			now := s.now()
			d := store.Delivery{ID: auth.NewID("dlv"), To: to, Cc: cc, Bcc: bcc, SentAt: now}
			if err := q.CreateDelivery(recordCtx, inv.ID, by, d); err != nil {
				return err
			}
			if err := q.MarkSent(recordCtx, inv.ID, now); err != nil {
				return err
			}
		}
		return q.FinishInvoiceSend(recordCtx, inv.ID, at, errors.Is(sendErr, mail.ErrUncertain))
	})
	if err != nil && (accepted || errors.Is(sendErr, mail.ErrUncertain)) {
		// If recording the receipt failed, the committed intent still prevents an automatic retry.
		return errors.Join(mail.ErrUncertain, sendErr, err, s.db.FinishInvoiceSend(recordCtx, inv.ID, at, true))
	}
	return errors.Join(sendErr, err)
}

// markSent records an issued invoice as sent without an email (its PDF handed over another way): no delivery, since
// deliveries are emails that went out. An invoice sent already keeps its first date, so a repeat changes nothing.
func (s *Service) markSent(w http.ResponseWriter, r *http.Request, sess store.Session, inv store.Invoice) error {
	if inv.Status == "void" || inv.Status == "replaced" {
		return invalidState("A voided or replaced invoice cannot be marked as sent.")
	}
	if inv.SentAt == nil {
		if err := s.db.MarkSent(r.Context(), inv.ID, s.now()); err != nil {
			return fmt.Errorf("mark invoice %s sent: %w", inv.ID, err)
		}
	}
	return s.respond(w, r, sess, http.StatusOK, inv.ID)
}

// unmarkSent takes back a mark as sent (the undo of markSent). An invoice that went out by email stays sent: the
// client has it.
func (s *Service) unmarkSent(w http.ResponseWriter, r *http.Request, sess store.Session, inv store.Invoice) error {
	if inv.Status == "void" || inv.Status == "replaced" {
		return invalidState("A voided or replaced invoice cannot be changed.")
	}
	if inv.SentAt != nil {
		cleared, err := s.db.UnmarkSent(r.Context(), inv.ID, s.now())
		if err != nil {
			return fmt.Errorf("unmark invoice %s sent: %w", inv.ID, err)
		}
		if !cleared {
			return invalidState("This invoice was emailed to the client, so it stays sent.")
		}
	}
	return s.respond(w, r, sess, http.StatusOK, inv.ID)
}

// addresses validates and lowercases a recipient list (at most maxRecipients, each once).
func addresses(p *parser, key string, in []string) []string {
	out := []string{}
	if len(in) > maxRecipients {
		p.fail(key, fmt.Sprintf("Use at most %d addresses.", maxRecipients))
		return out
	}
	for _, a := range in {
		v, msg := clients.NormaliseEmail(strings.TrimSpace(a))
		if msg != "" {
			p.fail(key, fmt.Sprintf("%q is not a valid email address.", a))
			continue
		}
		if !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	return out
}

func swissDate(d string) string {
	t, err := time.Parse(time.DateOnly, d)
	if err != nil {
		return d
	}
	return t.Format("02.01.2006")
}
