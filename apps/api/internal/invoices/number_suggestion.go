package invoices

import (
	"context"
	"net/http"
	"strconv"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// suggestionJSON: the format the imported invoices follow, the last number of its latest year, and the number the
// next invoice issued today would take with it.
type suggestionJSON struct {
	NumberSuggestion
	Next string `json:"next"`
}

// numberSuggestion: what a workspace that has issued no invoice of its own could take over from its imported ones;
// nil when they suggest nothing, or nothing its numbering does not already do.
func (s *Service) numberSuggestion(ctx context.Context, q store.Q, ws store.Workspace, set Settings) (*suggestionJSON, error) {
	numbers, err := q.ImportedInvoiceNumbers(ctx, ws.ID)
	if err != nil {
		return nil, err
	}
	sug, ok := suggestFormat(numbers)
	if !ok {
		return nil, nil
	}
	taken, err := q.PeekInvoiceSeq(ctx, ws.ID, "invoice", sug.Year)
	if err != nil {
		return nil, err
	}
	if sug.Format == set.NumberFormat && taken > sug.Last {
		return nil, nil
	}
	today := s.today(ws)
	next := int64(1)
	if strconv.Itoa(sug.Year) == today[:4] {
		next = max(taken, sug.Last+1)
	}
	return &suggestionJSON{sug, documentNumber(sug.Format, "", "invoice", today, next)}, nil
}

func (s *Service) getNumberSuggestion(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	set, err := loadSettings(r.Context(), s.db.Q, sess.Workspace.ID)
	if err != nil {
		return err
	}
	sug, err := s.numberSuggestion(r.Context(), s.db.Q, sess.Workspace, set)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(sug))
	return nil
}

// applyNumberSuggestion takes the suggested format and continues its latest year after the last imported number.
func (s *Service) applyNumberSuggestion(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var saved Settings
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockInvoiceSettings(r.Context(), sess.Workspace.ID); err != nil {
			return err
		}
		set, err := loadSettings(r.Context(), q, sess.Workspace.ID)
		if err != nil {
			return err
		}
		sug, err := s.numberSuggestion(r.Context(), q, sess.Workspace, set)
		if err != nil {
			return err
		}
		if sug == nil {
			return auth.Error(http.StatusConflict, "no_number_suggestion",
				"The imported invoices suggest no other numbering, or an invoice was issued meanwhile.", nil)
		}
		if err := q.RaiseInvoiceCounter(r.Context(), sess.Workspace.ID, "invoice", sug.Year, sug.Last); err != nil {
			return err
		}
		set.NumberFormat = sug.Format
		saved = set
		return q.PutInvoiceSettings(r.Context(), sess.Workspace.ID, set, s.now())
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(saved))
	return nil
}
