package approvals

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/store"
)

// Load reads the document of the request's {id} for approvals; lock true locks its row in q's transaction, so an
// approval step serialises with edits and the gated action.
type Load func(ctx context.Context, q store.Q, sess store.Session, id string, lock bool) (Doc, error)

// Routes registers a document type's approval under base (e.g. "/api/v1/quotes/{id}/approval"): GET reads it,
// POST submits, and withdraw, approve and reject decide. Each step runs in one transaction with the document locked
// and answers the approval as it then is. handle is the document package's signed-in route helper.
func (s *Service) Routes(handle func(pattern string, h func(http.ResponseWriter, *http.Request, store.Session) error), base string, load Load) {
	view := func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		doc, err := load(r.Context(), s.db.Q, sess, r.PathValue("id"), false)
		if err != nil {
			return err
		}
		v, err := s.View(r.Context(), s.db.Q, sess, doc)
		if err != nil {
			return err
		}
		return writeJSON(w, http.StatusOK, v)
	}
	step := func(run func(context.Context, store.Q, store.Session, Doc, string, *string) error) func(http.ResponseWriter, *http.Request, store.Session) error {
		return func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
			var body struct {
				RequestID string  `json:"request_id"`
				Comment   *string `json:"comment"`
			}
			if r.ContentLength != 0 && !s.auth.Decode(w, r, &body) {
				return nil
			}
			var comment *string
			if body.Comment != nil {
				if c := strings.TrimSpace(*body.Comment); c != "" {
					if utf8.RuneCountInString(c) > 1000 {
						return validation("comment", "Keep the comment to 1000 characters.")
					}
					comment = &c
				}
			}
			ctx := r.Context()
			err := s.db.Tx(ctx, func(q store.Q) error {
				doc, err := load(ctx, q, sess, r.PathValue("id"), true)
				if err != nil {
					return err
				}
				return run(ctx, q, sess, doc, body.RequestID, comment)
			})
			if err != nil {
				return err
			}
			return view(w, r, sess)
		}
	}
	handle("GET "+base, view)
	handle("POST "+base, step(func(ctx context.Context, q store.Q, sess store.Session, d Doc, _ string, _ *string) error {
		return s.Submit(ctx, q, sess, d)
	}))
	handle("POST "+base+"/withdraw", step(func(ctx context.Context, q store.Q, sess store.Session, d Doc, _ string, _ *string) error {
		return s.Withdraw(ctx, q, sess, d)
	}))
	handle("POST "+base+"/approve", step(s.Approve))
	handle("POST "+base+"/reject", step(s.Reject))
}
