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
	lang := inv.Language
	if !slices.Contains(emailtemplate.Languages, lang) {
		lang = "en"
	}
	t := emailtemplate.Default(kind, lang)
	if own, err := q.EmailTemplate(ctx, ws, kind, lang); err == nil {
		t = emailtemplate.Template{Subject: own.Subject, Body: own.Body}
	} else if !errors.Is(err, store.ErrNotFound) {
		return "", "", err
	}
	var company, client string
	if inv.Seller != nil {
		company = inv.Seller.Name
	}
	if inv.Buyer != nil {
		client = inv.Buyer.Name
	}
	r := emailtemplate.Render(t, map[string]string{"document": Title(inv), "number": deref(inv.Number), "client": client,
		"amount": inv.Currency + " " + inv.Payable().Swiss("'"), "due_date": swissDate(inv.DueDate), "company": company})
	return r.Subject, withRevolut(r.Body, inv), nil
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

// withRevolut adds the Revolut payment link to a message that does not hold it yet.
func withRevolut(message string, inv store.Invoice) string {
	if inv.Payment.RevolutURL == nil || strings.Contains(message, *inv.Payment.RevolutURL) {
		return message
	}
	label, ok := revolutLabel[inv.Language]
	if !ok {
		label = revolutLabel["en"]
	}
	return message + "\n\n" + label + ": " + *inv.Payment.RevolutURL
}

// emailDraft: GET /email, what the Send by email dialog starts with.
func (s *Service) emailDraft(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	inv, err := s.db.Invoice(ctx, sess.Workspace.ID, r.PathValue("id"), s.today(sess.Workspace), false)
	if err != nil {
		return err
	}
	if inv.Status == "draft" {
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
		"reply_to": replyTo}))
	return nil
}
