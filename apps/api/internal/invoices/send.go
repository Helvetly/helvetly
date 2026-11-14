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
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// emailText is the default email of one language: greeting, the sentence for an invoice (number, currency,
// amount, due date), a credit note or a proforma invoice (number, currency, amount), sign-off, and the "from" of
// the subject.
type emailText struct{ greeting, invoice, creditNote, signOff, from, revolut, proforma string }

var emailTexts = map[string]emailText{
	"de": {"Guten Tag", "Im Anhang finden Sie unsere Rechnung %s über %s %s, zahlbar bis %s.",
		"Im Anhang finden Sie unsere Gutschrift %s über %s %s.", "Freundliche Grüsse", "von", "Mit Revolut bezahlen",
		"Im Anhang finden Sie unsere Proforma-Rechnung %s über %s %s."},
	"fr": {"Bonjour", "Veuillez trouver ci-joint notre facture %s d'un montant de %s %s, payable jusqu'au %s.",
		"Veuillez trouver ci-joint notre note de crédit %s d'un montant de %s %s.", "Meilleures salutations", "de", "Payer avec Revolut",
		"Veuillez trouver ci-joint notre facture proforma %s d'un montant de %s %s."},
	"it": {"Buongiorno", "In allegato trovate la nostra fattura %s di %s %s, pagabile entro il %s.",
		"In allegato trovate la nostra nota di credito %s di %s %s.", "Cordiali saluti", "di", "Paga con Revolut",
		"In allegato trovate la nostra fattura proforma %s di %s %s."},
	"en": {"Hello", "Please find attached our invoice %s for %s %s, payable by %s.",
		"Please find attached our credit note %s for %s %s.", "Kind regards", "from", "Pay with Revolut",
		"Please find attached our proforma invoice %s for %s %s."},
}

const maxRecipients = 10

func (s *Service) send(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		To      []string        `json:"to"`
		Cc      []string        `json:"cc"`
		Subject json.RawMessage `json:"subject"`
		Message json.RawMessage `json:"message"`
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
	if s.mail == nil {
		return auth.Error(http.StatusServiceUnavailable, "mail_unavailable", "Email is not set up on this server.", nil)
	}
	client, clientErr := s.db.Client(ctx, sess.Workspace.ID, inv.ClientID) // missing for a deleted client
	to := body.To
	if len(to) == 0 {
		if clientErr == nil && buyerOf(client).Email != nil {
			to = []string{*buyerOf(client).Email}
		} else if inv.Buyer != nil && inv.Buyer.Email != nil {
			to = []string{*inv.Buyer.Email}
		}
	}
	p := newParser()
	to = addresses(p, "to", to)
	cc := addresses(p, "cc", body.Cc)
	if len(to) == 0 {
		p.fail("to", "Enter an address: the client has no email address.")
	}
	subject, message := defaultEmail(inv)
	if body.Subject != nil {
		if v := p.text("subject", body.Subject, 200, nil); v != nil {
			subject = *v
		}
	}
	revolut := ""
	if inv.Payment.RevolutURL != nil {
		revolut = emailTexts[inv.Language].revolut + ": " + *inv.Payment.RevolutURL
	}
	if body.Message != nil {
		if v := p.text("message", body.Message, 5000, nil); v != nil {
			message = *v
			if revolut != "" && !strings.Contains(message, *inv.Payment.RevolutURL) {
				message += "\n\n" + revolut
			}
		}
	}
	if err := p.err(); err != nil {
		return err
	}
	pdf, err := s.files.Get(ctx, deref(inv.PDFKey))
	if err != nil {
		return err
	}
	m := mail.Message{To: to, Cc: cc, Subject: subject, Text: message,
		HTML:        "<p>" + strings.ReplaceAll(html.EscapeString(message), "\n", "<br>\n") + "</p>",
		Attachments: []mail.Attachment{{Name: fileName(inv), ContentType: "application/pdf", Data: pdf}}}
	if inv.Seller != nil && inv.Seller.Email != nil {
		m.ReplyTo = *inv.Seller.Email
	}
	if clientErr == nil && client.EInvoiceFormat != "none" && s.einvoice != nil {
		// a client that asked for XML gets it or nothing: a PDF alone would not be the invoice it can process
		name, xml, err := s.einvoice(ctx, sess, inv, strings.ReplaceAll(client.EInvoiceFormat, "_", "-"))
		if err != nil {
			return err
		}
		m.Attachments = append(m.Attachments, mail.Attachment{Name: name, ContentType: "application/xml", Data: xml})
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
		return s.recordDelivery(ctx, inv.ID, &sess.User.ID, to, cc)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
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
func (s *Service) recordDelivery(ctx context.Context, invoiceID string, by *string, to, cc []string) error {
	ctx = context.WithoutCancel(ctx)
	return s.db.Tx(ctx, func(q store.Q) error {
		now := s.now()
		if err := q.CreateDelivery(ctx, invoiceID, by, store.Delivery{ID: auth.NewID("dlv"), To: to, Cc: cc, SentAt: now}); err != nil {
			return fmt.Errorf("record delivery of %s: %w", invoiceID, err)
		}
		return q.MarkSent(ctx, invoiceID, now)
	})
}
