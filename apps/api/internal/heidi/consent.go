package heidi

import (
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// setConsent records an owner's or admin's choice to send Heidi content to OpenAI (nDSG Art. 16–17 disclosure
// abroad); it is the only switch: without a granted row, chat never calls the provider.
func (s *Service) setConsent(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if sess.Role != "owner" && sess.Role != "admin" {
		return auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can change whether Heidi uses OpenAI.", nil)
	}
	var in struct {
		Granted *bool `json:"granted"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if in.Granted == nil {
		return invalid("Say whether OpenAI may be used: granted true or false.")
	}
	ctx := r.Context()
	var c store.AIConsent
	err := s.db.Tx(ctx, func(q store.Q) error {
		current, err := q.AIConsent(ctx, sess.Workspace.ID)
		if err != nil {
			return err
		}
		if current.ChangedAt == nil || current.Granted != *in.Granted {
			if err := q.SetAIConsent(ctx, sess.Workspace.ID, sess.User.ID, *in.Granted, s.now()); err != nil {
				return err
			}
		}
		c, err = q.AIConsent(ctx, sess.Workspace.ID)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": c})
	return nil
}
