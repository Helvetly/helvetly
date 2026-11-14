package auth

import (
	"errors"
	"net/http"

	"helvetly.com/api/internal/store"
)

// listWorkspaces: the workspaces the person belongs to, by name.
func (s *Service) listWorkspaces(w http.ResponseWriter, r *http.Request, sess store.Session) {
	list, err := s.db.UserWorkspaces(r.Context(), sess.User.ID)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, ws := range list {
		out = append(out, map[string]any{"id": ws.ID, "name": ws.Name, "role": ws.Role, "current": ws.ID == sess.Workspace.ID})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": out})
}

func (s *Service) switchWorkspace(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var in struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if !s.Decode(w, r, &in) {
		return
	}
	if err := s.SwitchWorkspace(w, r, sess, in.WorkspaceID); err != nil {
		s.WriteError(w, r, err)
	}
}

// SwitchWorkspace swaps the session for a new one in the workspace and answers {csrf_token}. A workspace
// the person is not a member of is ErrNotFound, with nothing written.
func (s *Service) SwitchWorkspace(w http.ResponseWriter, r *http.Request, sess store.Session, workspaceID string) error {
	var ns newSession
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if _, err := q.MemberRole(r.Context(), workspaceID, sess.User.ID); err != nil {
			return err
		}
		var err error
		if ns, err = s.createSession(withSessionClient(r), q, sess.User.ID, workspaceID); err != nil {
			return err
		}
		return q.DeleteSession(r.Context(), sess.ID)
	})
	if errors.Is(err, store.ErrNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	s.setSessionCookie(w, ns)
	WriteJSON(w, http.StatusOK, map[string]string{"csrf_token": ns.csrf})
	return nil
}
