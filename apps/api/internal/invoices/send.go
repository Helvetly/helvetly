package invoices

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
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

func (s *Service) send(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		To      []string        `json:"to"`
		Cc      []string        `json:"cc"`
		Bcc     []string        `json:"bcc"`
		Subject json.RawMessage `json:"subject"`
		Message json.RawMessage `json:"message"`
		Email   *bool           `json:"email"`
		Sent    *bool           `json:"sent"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ctx, id := r.Context(), r.PathValue("id")
	inv, err := s.db.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	if inv.Status == "draft" {
		return invalidState("Issue the document before sending it.")
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
	if s.mail == nil {
		return auth.Error(http.StatusServiceUnavailable, "mail_unavailable", "Email is not set up on this server.", nil)
	}
	client, clientErr, to := s.recipients(ctx, sess.Workspace.ID, inv, body.To)
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
		HTML:        "<p>" + strings.ReplaceAll(html.EscapeString(message), "\n", "<br>\n") + "</p>",
		Attachments: []mail.Attachment{{Name: fileName(inv), ContentType: "application/pdf", Data: pdf}}}
	if inv.Seller != nil && inv.Seller.Email != nil {
		m.ReplyTo = *inv.Seller.Email
	} else { // without a company email, the member who sends gets the answer
		m.ReplyTo = sess.User.Email
	}
	if clientErr == nil && client.EInvoiceFormat != "none" && s.einvoice != nil {
		// a client that asked for XML gets it or nothing: a PDF alone would not be the invoice it can process
		if err := s.db.RequireFeature(ctx, sess.Workspace.ID, store.FeatureEInvoiceXML); err != nil {
			return err
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
	// a double-click must not email the client twice: an overlapping send of the same document is refused
	err = s.db.Tx(ctx, func(q store.Q) error {
		if free, err := q.TryLockInvoiceSend(ctx, inv.ID); err != nil {
			return err
		} else if !free {
			return invalidState("This document is being sent already.")
		}
		if err := s.mail.Send(ctx, m); err != nil {
			return fmt.Errorf("send invoice %s: %w", inv.ID, err)
		}
		return s.recordDelivery(ctx, inv.ID, &sess.User.ID, to, cc, bcc)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
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

// recordDelivery writes a sent mail's delivery and sent_at. The mail is already out, so neither a client disconnect
// nor a shutdown may cancel its record.
func (s *Service) recordDelivery(ctx context.Context, invoiceID string, by *string, to, cc, bcc []string) error {
	ctx = context.WithoutCancel(ctx)
	return s.db.Tx(ctx, func(q store.Q) error {
		now := s.now()
		d := store.Delivery{ID: auth.NewID("dlv"), To: to, Cc: cc, Bcc: bcc, SentAt: now}
		if err := q.CreateDelivery(ctx, invoiceID, by, d); err != nil {
			return fmt.Errorf("record delivery of %s: %w", invoiceID, err)
		}
		return q.MarkSent(ctx, invoiceID, now)
	})
}
