package workspaces

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// The footer is a few short lines of plain text under every branded client email.
const (
	maxFooter      = 300
	maxFooterLines = 4
)

func (s *Service) registerClientEmails(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/workspace/client-emails", s.auth.SignedIn(s.getClientEmails))
	mux.HandleFunc("PUT /api/v1/workspace/client-emails", s.auth.SignedIn(s.putClientEmails))
}

var errClientEmailsAdminOnly = auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can change the client emails.", nil)

func writeClientEmails(w http.ResponseWriter, c store.ClientEmails) {
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": c})
}

func (s *Service) getClientEmails(w http.ResponseWriter, r *http.Request, sess store.Session) {
	c, err := s.db.WorkspaceClientEmails(r.Context(), sess.Workspace.ID)
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	writeClientEmails(w, c)
}

// emailFooter: the footer as stored, each line trimmed and the ends cut; ok false when it is too long.
func emailFooter(raw string) (string, bool) {
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimSpace(l)
	}
	v := strings.TrimSpace(strings.Join(lines, "\n"))
	return v, utf8.RuneCountInString(v) <= maxFooter && strings.Count(v, "\n") < maxFooterLines
}

// putClientEmails changes the fields sent (owner or admin), audited when something changes.
func (s *Service) putClientEmails(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" && sess.Role != "admin" {
		s.auth.WriteError(w, r, errClientEmailsAdminOnly)
		return
	}
	var in struct {
		Footer            *string `json:"email_footer"`
		PortalInvitations *bool   `json:"portal_invitations"`
		SessionReminders  *bool   `json:"session_reminders"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	footer, ok := emailFooter(deref(in.Footer))
	if !ok {
		msg := "Enter at most 4 lines and 300 characters."
		s.auth.WriteError(w, r, auth.Error(http.StatusUnprocessableEntity, "validation_failed", msg,
			map[string]any{"fields": map[string]string{"email_footer": msg}}))
		return
	}
	var after store.ClientEmails
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		before, err := q.LockWorkspaceClientEmails(r.Context(), sess.Workspace.ID)
		if err != nil {
			return err
		}
		after = before
		if in.Footer != nil {
			after.Footer = footer
		}
		if in.PortalInvitations != nil {
			after.PortalInvitations = *in.PortalInvitations
		}
		if in.SessionReminders != nil {
			after.SessionReminders = *in.SessionReminders
		}
		if after == before {
			return nil
		}
		if err := q.SetWorkspaceClientEmails(r.Context(), sess.Workspace.ID, after); err != nil {
			return err
		}
		payload, err := json.Marshal(after)
		if err != nil {
			return err
		}
		actor := sess.User.ID
		return q.LogEvent(r.Context(), store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: "workspace.client_emails_changed",
			SubjectType: "workspace", SubjectID: sess.Workspace.ID, ActorID: &actor, At: s.now(), Payload: payload})
	})
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	writeClientEmails(w, after)
}
