package invoices

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/store"
)

// recipients resolves the client and the address list: the given one, else the client's billing email, else the
// buyer's on the document. The client is missing for a deleted one (the error says so).
func (s *Service) recipients(ctx context.Context, ws string, inv store.Invoice, given []string) (store.Client, error, []string) {
	client, err := s.db.Client(ctx, ws, inv.ClientID)
	to := given
	if len(to) == 0 {
		if err == nil && buyerOf(client).Email != nil {
			to = []string{*buyerOf(client).Email}
		} else if inv.Buyer != nil && inv.Buyer.Email != nil {
			to = []string{*inv.Buyer.Email}
		}
	}
	return client, err, to
}

// draft is the subject and message of an invoice's email: the workspace's template for its kind and language,
// else the built-in text, with the variables filled in.
func (s *Service) draft(ctx context.Context, q store.Q, ws string, inv store.Invoice) (string, string, error) {
	kind := "invoice"
	if inv.Kind == "credit_note" || inv.Kind == "proforma" {
		kind = inv.Kind
	}
	lang := emailLanguage(inv)
	t, err := template(ctx, q, ws, kind, lang)
	if err != nil {
		return "", "", err
	}
	if adjustedBalance(inv) {
		// A saved invoice template can contain an unconditional request for the original payment.
		t.Subject = emailtemplate.Default(kind, lang).Subject
		t.Body = map[string]string{
			"de": "Im Anhang finden Sie die Kopie der Rechnung {number} über {amount}. Der offene Betrag ist {balance}.",
			"en": "Attached is a copy of invoice {number} for {amount}. The outstanding balance is {balance}.",
			"fr": "Vous trouverez en pièce jointe une copie de la facture {number} de {amount}. Le solde restant est de {balance}.",
			"it": "In allegato trova una copia della fattura {number} di {amount}. Il saldo residuo è di {balance}.",
		}[lang]
	}
	var company, client string
	if inv.Seller != nil {
		company = inv.Seller.Name
	}
	if inv.Buyer != nil {
		client = inv.Buyer.Name
	}
	r := emailtemplate.Render(t, map[string]string{"document": Title(inv), "number": deref(inv.Number), "client": client,
		"amount": inv.Currency + " " + inv.Payable().Swiss("'"), "balance": inv.Currency + " " + inv.AmountDue.Swiss("'"), "due_date": swissDate(inv.DueDate), "company": company})
	return r.Subject, withRevolut(r.Body, inv), nil
}

func emailLanguage(inv store.Invoice) string {
	if slices.Contains(emailtemplate.Languages, inv.Language) {
		return inv.Language
	}
	return "en"
}

// template is the workspace's own text of a kind in a language, else the built-in one.
func template(ctx context.Context, q store.Q, ws, kind, lang string) (emailtemplate.Template, error) {
	own, err := q.EmailTemplate(ctx, ws, kind, lang)
	if errors.Is(err, store.ErrNotFound) {
		return emailtemplate.Default(kind, lang), nil
	}
	return emailtemplate.Template{Subject: own.Subject, Body: own.Body}, err
}

// limitFor is the length limit of a typed text: the dialog posts the rendered draft back, which passes as it is,
// so only another text is held to limit.
func limitFor(raw json.RawMessage, draft string, limit int) int {
	var v string
	if json.Unmarshal(raw, &v) == nil && strings.TrimSpace(strings.ReplaceAll(v, "\r\n", "\n")) == strings.TrimSpace(draft) {
		return max(limit, utf8.RuneCountInString(draft))
	}
	return limit
}

func adjustedBalance(inv store.Invoice) bool {
	return takesPayments(inv.Kind) && (inv.Status == "paid" || inv.AmountPaid > 0 || inv.AmountCredited > 0)
}

// withRevolut adds the Revolut payment link to a message that does not hold it yet.
func withRevolut(message string, inv store.Invoice) string {
	if (adjustedBalance(inv) && inv.AmountDue == 0) || inv.Payment.RevolutURL == nil || strings.Contains(message, *inv.Payment.RevolutURL) {
		return message
	}
	return message + "\n\n" + revolutPaymentLine(inv)
}

func revolutPaymentLine(inv store.Invoice) string {
	return revolutPaymentLabel(inv.Language) + ": " + deref(inv.Payment.RevolutURL)
}

func revolutPaymentLabel(language string) string {
	label, ok := revolutLabel[language]
	if !ok {
		label = revolutLabel["en"]
	}
	return label
}

// emailDraft: GET /email, what the Send by email dialog starts with.
func (s *Service) emailDraft(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	inv, err := s.db.Invoice(ctx, sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	if inv.Status == "draft" || inv.Status == "void" || inv.Status == "replaced" {
		return invalidState("Issue the document before sending it.")
	}
	if inv.IssuedElsewhere() {
		return ErrIssuedElsewhere
	}
	subject, message, err := s.draft(ctx, s.db.Q, sess.Workspace.ID, inv)
	if err != nil {
		return err
	}
	_, _, to := s.recipients(ctx, sess.Workspace.ID, inv, nil)
	replyTo, err := s.ReplyTo(ctx, sess)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"to": append([]string{}, to...), "subject": subject, "message": message,
		"reply_to": replyTo, "amount_due": inv.AmountDue}))
	return nil
}
