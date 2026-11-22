package workspaces

import (
	"encoding/json"
	"net/http"
	"net/mail"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func (s *Service) registerReplyTo(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/workspace/reply-to", s.auth.SignedIn(s.getReplyTo))
	mux.HandleFunc("PUT /api/v1/workspace/reply-to", s.auth.SignedIn(s.putReplyTo))
}

var errReplyToAdminOnly = auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can change the reply-to email.", nil)

func writeReplyTo(w http.ResponseWriter, address *string) {
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"reply_to_email": address}})
}

// getReplyTo is the workspace's reply address for its client email, null when it uses the company email.
func (s *Service) getReplyTo(w http.ResponseWriter, r *http.Request, sess store.Session) {
	a, err := s.db.WorkspaceReplyTo(r.Context(), sess.Workspace.ID)
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	writeReplyTo(w, a)
}

// replyAddress: a blank one clears it (nil); otherwise one plain, lower-cased address, or ok false.
func replyAddress(raw string) (*string, bool) {
	v := strings.ToLower(strings.TrimSpace(raw))
	if v == "" {
		return nil, true
	}
	if a, err := mail.ParseAddress(v); err != nil || a.Address != v || len(v) > 254 {
		return nil, false
	}
	return &v, true
}

// putReplyTo sets where clients' answers to the workspace's email go (owner or admin), audited when it changes.
func (s *Service) putReplyTo(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" && sess.Role != "admin" {
		s.auth.WriteError(w, r, errReplyToAdminOnly)
		return
	}
	var in struct {
		ReplyToEmail *string `json:"reply_to_email"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	address, ok := replyAddress(deref(in.ReplyToEmail))
	if !ok {
		s.auth.WriteError(w, r, auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Enter a valid email address.",
			map[string]any{"fields": map[string]string{"reply_to_email": "Enter a valid email address."}}))
		return
	}
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		before, err := q.LockWorkspaceReplyTo(r.Context(), sess.Workspace.ID)
		if err != nil || deref(before) == deref(address) {
			return err
		}
		if err := q.SetWorkspaceReplyTo(r.Context(), sess.Workspace.ID, address); err != nil {
			return err
		}
		payload, err := json.Marshal(map[string]string{"to": deref(address)})
		if err != nil {
			return err
		}
		actor := sess.User.ID
		return q.LogEvent(r.Context(), store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: "workspace.reply_to_changed",
			SubjectType: "workspace", SubjectID: sess.Workspace.ID, ActorID: &actor, At: s.now(), Payload: payload})
	})
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	writeReplyTo(w, address)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
