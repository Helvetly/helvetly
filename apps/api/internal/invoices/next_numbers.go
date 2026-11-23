package invoices

import (
	"net/http"
	"strconv"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// nextCounters is what the next document of a series takes: its counter this year, and the one a format without a
// year uses for ever.
type nextCounters struct {
	Year int64 `json:"year"`
	Ever int64 `json:"ever"`
}

type nextNumbersJSON struct {
	Series   map[string]nextCounters `json:"series"`
	Quote    int64                   `json:"quote"`
	Contract int64                   `json:"contract"`
}

// getNextNumbers: the counters behind the settings' "Next numbers", per series and for quotes and contracts; the page fills the
// format being edited with them, since the saved one may differ.
func (s *Service) getNextNumbers(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	id := sess.Workspace.ID
	year, _ := strconv.Atoi(s.today(sess.Workspace)[:4])
	out := nextNumbersJSON{Series: map[string]nextCounters{}}
	for _, kind := range []string{"invoice", "credit_note", "proforma", "self_billed"} {
		var c nextCounters
		var err error
		if c.Year, err = s.db.Q.PeekInvoiceSeq(ctx, id, kind, year); err != nil {
			return err
		}
		if c.Ever, err = s.db.Q.PeekInvoiceSeq(ctx, id, kind, 0); err != nil {
			return err
		}
		out.Series[kind] = c
	}
	var err error
	if out.Quote, err = s.db.Q.PeekQuoteNumber(ctx, id, year); err != nil {
		return err
	}
	if out.Contract, err = s.db.Q.PeekContractNumber(ctx, id, year); err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(out))
	return nil
}
