package invoices

import (
	"errors"
	"net/http"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// bulkLimit keeps a request short: each issue renders and stores a PDF.
const bulkLimit = 100

type bulkResult struct {
	ID      string `json:"id"`
	OK      bool   `json:"ok"`
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// bulk issues drafts or marks issued invoices paid, each in its own transaction through the single actions' paths;
// what one cannot do is reported per id and the rest still go ahead.
func (s *Service) bulk(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Action string   `json:"action"`
		IDs    []string `json:"ids"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	ids := slices.Compact(slices.Sorted(slices.Values(body.IDs)))
	invalid := map[string]string{}
	if len(ids) < 1 || len(ids) > bulkLimit {
		invalid["ids"] = "Choose 1 to 100 invoices."
	}
	if body.Action != "mark_paid" && body.Action != "issue" {
		invalid["action"] = "Choose mark_paid or issue."
	}
	if len(invalid) > 0 {
		return validationFailed(invalid)
	}
	ctx, today := r.Context(), s.today(sess.Workspace)
	results := make([]bulkResult, 0, len(ids))
	for _, id := range ids {
		var err error
		if body.Action == "issue" {
			err = s.issueOne(ctx, sess, id)
		} else {
			err = s.payDue(ctx, sess, id, today, "bank_transfer")
		}
		res := bulkResult{ID: id, OK: err == nil}
		if errors.Is(err, store.ErrNotFound) {
			err = auth.ErrNotFound
		}
		if status, code, message, ok := auth.Describe(err); ok && status < 500 {
			res.Error, res.Message = code, message
		} else if err != nil {
			return err
		}
		results = append(results, res)
	}
	auth.WriteJSON(w, http.StatusOK, data(results))
	return nil
}
