package engagements

import (
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

var errSettingsForbidden = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can change the engagement settings.", nil)

func (s *Service) registerSettings(mux *http.ServeMux) {
	handle := func(pattern string, h func(http.ResponseWriter, *http.Request, store.Session) error) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/engagement-settings", func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		got, err := s.db.EngagementSettings(r.Context(), sess.Workspace.ID)
		if err != nil {
			return err
		}
		auth.WriteJSON(w, http.StatusOK, data(got))
		return nil
	})
	handle("PUT /api/v1/engagement-settings", func(w http.ResponseWriter, r *http.Request, sess store.Session) error {
		if !canManage(sess) {
			return errSettingsForbidden
		}
		var body struct {
			Digest *bool `json:"digest"`
		}
		if !s.auth.Decode(w, r, &body) {
			return nil
		}
		if body.Digest == nil {
			return validationFailed(map[string]string{"digest": "Choose on or off."})
		}
		put := store.EngagementSettings{Digest: *body.Digest}
		if put.Digest { // switching the digest off stays possible on every plan
			if err := s.db.RequireFeature(r.Context(), sess.Workspace.ID, store.FeatureEngagementAutomation); err != nil {
				return err
			}
		}
		if err := s.db.PutEngagementSettings(r.Context(), sess.Workspace.ID, put, s.now()); err != nil {
			return err
		}
		auth.WriteJSON(w, http.StatusOK, data(put))
		return nil
	})
}
