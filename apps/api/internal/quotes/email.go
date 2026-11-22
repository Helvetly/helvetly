package quotes

import (
	"context"
	"errors"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/store"
)

// draftText is the subject and message of a quote's email: the workspace's own template for the quote's
// language, else the built-in text, with the variables filled in. A quote without a number renders {number} as "".
func (s *Service) draftText(ctx context.Context, q store.Q, workspaceID string, t store.Quote) (emailtemplate.Template, error) {
	seller, _, _, err := s.invoices.Seller(ctx, q, workspaceID)
	if err != nil {
		return emailtemplate.Template{}, err
	}
	tpl := emailtemplate.Default("quote", t.Language)
	own, err := q.EmailTemplate(ctx, workspaceID, "quote", t.Language)
	switch {
	case err == nil:
		tpl = emailtemplate.Template{Subject: own.Subject, Body: own.Body}
	case !errors.Is(err, store.ErrNotFound):
		return emailtemplate.Template{}, err
	}
	number := ""
	if t.Number != nil {
		number = *t.Number
	}
	return emailtemplate.Render(tpl, map[string]string{
		"document":    titles[t.Language],
		"number":      number,
		"client":      t.Client.Name,
		"amount":      t.Currency + " " + t.PayableTotal.Swiss("'"),
		"company":     seller.Name,
		"valid_until": swissDate(t.ValidUntil),
	}), nil
}

// clientAddress is the client's email, else its billing email; empty when it has neither.
func clientAddress(ctx context.Context, q store.Q, workspaceID, clientID string) []string {
	if c, err := q.Client(ctx, workspaceID, clientID); err == nil {
		if c.Email != nil {
			return []string{*c.Email}
		} else if c.BillingEmail != nil {
			return []string{*c.BillingEmail}
		}
	}
	return nil
}

// emailDraft answers what the send dialog shows: the client's address and the rendered subject and message.
func (s *Service) emailDraft(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	t, err := s.db.Quote(ctx, sess.Workspace.ID, r.PathValue("id"), today(sess.Workspace, s.now()), false)
	if err != nil {
		return err
	}
	tpl, err := s.draftText(ctx, s.db.Q, sess.Workspace.ID, t)
	if err != nil {
		return err
	}
	to := clientAddress(ctx, s.db.Q, sess.Workspace.ID, t.ClientID)
	if to == nil {
		to = []string{}
	}
	replyTo, err := s.invoices.ReplyTo(ctx, sess)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"to": to, "subject": tpl.Subject, "message": tpl.Body, "reply_to": replyTo}))
	return nil
}
