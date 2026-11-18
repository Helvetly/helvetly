package heidi

import (
	"net/http"

	"helvetly.com/api/internal/ainotice"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// consent is the signed-in person's own approval in this workspace and the notice it is given for, in ?lang (English
// for any other).
func (s *Service) consent(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	c, err := s.db.AIConsent(r.Context(), sess.Workspace.ID, sess.User.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": c, "notice": ainotice.For(r.URL.Query().Get("lang"))})
	return nil
}

// setConsent records the signed-in person's own choice, in this workspace, to send content to OpenAI (nDSG
// Art. 16–17 disclosure abroad); every AI feature checks it (auth.RequireAIConsent). Any role decides only for
// itself: the row's user is always the session's. An approval names the notice version the person read and is
// refused unless it is the one in force; a withdrawal needs no version.
func (s *Service) setConsent(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in struct {
		Granted *bool  `json:"granted"`
		Version string `json:"version"`
		// Refused when sent: the session alone says whose approval and which workspace.
		UserID      *string `json:"user_id"`
		WorkspaceID *string `json:"workspace_id"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if in.UserID != nil || in.WorkspaceID != nil {
		return invalid("You can only approve AI use for yourself, in the workspace you are signed in to.")
	}
	if in.Granted == nil {
		return invalid("Say whether OpenAI may be used: granted true or false.")
	}
	if *in.Granted && in.Version != ainotice.Version {
		return auth.Error(http.StatusConflict, "ai_consent_version_changed", "The AI notice has changed since it was shown. Read the current notice, then approve again.",
			map[string]any{"current_version": ainotice.Version})
	}
	ctx := r.Context()
	var c store.AIConsent
	err := s.db.Tx(ctx, func(q store.Q) error {
		current, err := q.AIConsent(ctx, sess.Workspace.ID, sess.User.ID)
		if err != nil {
			return err
		}
		if current.ChangedAt == nil || current.Granted != *in.Granted || current.Version != ainotice.Version {
			if err := q.SetAIConsent(ctx, sess.Workspace.ID, sess.User.ID, *in.Granted, s.now()); err != nil {
				return err
			}
		}
		c, err = q.AIConsent(ctx, sess.Workspace.ID, sess.User.ID)
		return err
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": c})
	return nil
}
