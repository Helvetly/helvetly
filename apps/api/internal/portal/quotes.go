package portal

import (
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/quotes"
	"helvetly.com/api/internal/store"
)

func (s *Service) registerQuotes(handle func(string, handler)) {
	handle("GET /api/v1/public/portal/quotes", s.quotes)
	handle("GET /api/v1/public/portal/quotes/{id}/pdf", s.quotePDF)
	handle("POST /api/v1/public/portal/quotes/{id}/accept", s.decideQuote(true))
	handle("POST /api/v1/public/portal/quotes/{id}/decline", s.decideQuote(false))
}

// quoteView: what the client sees of a quote it was sent (never a draft, an internal note or the invoice link).
type quoteView struct {
	ID           string      `json:"id"`
	Number       string      `json:"number"` // set on the first send, and the portal shows sent quotes only
	Revision     int         `json:"revision"`
	Status       string      `json:"status"`
	IssueDate    string      `json:"issue_date"`
	ValidUntil   string      `json:"valid_until"`
	Currency     string      `json:"currency"`
	Total        store.Money `json:"total"`
	DecidedAt    *time.Time  `json:"decided_at"`
	DecisionNote *string     `json:"decision_note"`
}

func viewOf(t store.Quote) quoteView {
	number := ""
	if t.Number != nil {
		number = *t.Number
	}
	return quoteView{t.ID, number, t.Revision, t.Status, t.IssueDate, t.ValidUntil, t.Currency, t.PayableTotal, t.DecidedAt, t.DecisionNote}
}

func (s *Service) quotes(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	list, err := s.db.Q.Quotes(r.Context(), sess.Workspace.ID, sess.ClientID, s.today(sess))
	if err != nil {
		return err
	}
	out := []quoteView{}
	for _, t := range list {
		if t.Status != "draft" {
			out = append(out, viewOf(t))
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}

// ownQuote: a quote sent to the session's client; anything else is not found.
func (s *Service) ownQuote(r *http.Request, sess store.PortalSession) (store.Quote, error) {
	t, err := s.db.Q.Quote(r.Context(), sess.Workspace.ID, r.PathValue("id"), s.today(sess), false)
	if err == nil && (t.ClientID != sess.ClientID || t.Status == "draft" || t.PDFKey == nil) {
		err = auth.ErrNotFound
	}
	return t, err
}

func (s *Service) quotePDF(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	t, err := s.ownQuote(r, sess)
	if err != nil {
		return err
	}
	pdf, err := s.files.Get(r.Context(), *t.PDFKey)
	if err != nil {
		return err
	}
	quotes.WritePDF(w, "attachment", t, pdf)
	return nil
}

func (s *Service) decideQuote(accept bool) handler {
	return func(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
		var body struct {
			Note *string `json:"note"`
		}
		if !s.auth.Decode(w, r, &body) {
			return nil
		}
		note, err := quotes.Note(body.Note)
		if err != nil {
			return err
		}
		var t store.Quote
		err = s.db.Tx(r.Context(), func(q store.Q) error {
			t, err = quotes.Decide(r.Context(), q, sess.Workspace, r.PathValue("id"), sess.ClientID, accept, note, s.now())
			return err
		})
		if err != nil {
			return err
		}
		auth.WriteJSON(w, http.StatusOK, data(viewOf(t)))
		return nil
	}
}
