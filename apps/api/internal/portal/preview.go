package portal

import (
	"crypto/rand"
	"encoding/json"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/store"
)

// previewTTL is the longest a member's read-only preview session lasts.
const previewTTL = 30 * time.Minute

var errPreviewReadOnly = auth.Error(http.StatusForbidden, "preview_read_only", "This is a read-only preview: nothing can be changed.", nil)

// previewCookieName is the preview's own cookie, beside (never instead of) a client's session of the same workspace.
func previewCookieName(r *http.Request) string { return cookieName(r) + "_preview" }

// startPreview takes a member's one-use preview link (clients/portal_preview.go), opens the read-only session as its
// client and goes to the portal's start page; a link used, expired or of another workspace goes to the sign-in page,
// which says so. Nothing is recorded on the client: no sign-in, no notification.
func (s *Service) startPreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	scope, ok := portalscope.FromContext(r.Context())
	if !ok {
		s.fail(w, r, errUseSupplierLink)
		return
	}
	if !s.publicLimit.Allow(r) {
		s.fail(w, r, errTooMany)
		return
	}
	home := portalscope.PathPrefix(scope) + "/"
	now := s.now()
	token, csrf, expires := rand.Text(), rand.Text(), now.Add(previewTTL)
	// Taken outside the transaction: a link is used up by any try, whatever comes of it.
	preview, err := s.db.Q.TakePortalPreviewLink(r.Context(), hashToken(r.URL.Query().Get("token")), scope.WorkspaceID, now)
	open := false
	if err == nil {
		open, err = s.db.Q.FeatureAllowed(r.Context(), scope.WorkspaceID, store.FeatureClientPortal)
	}
	if err == nil && !open {
		err = store.ErrNotFound
	}
	if err == nil {
		err = s.db.Tx(r.Context(), func(q store.Q) error {
			id := auth.NewID("pse")
			if err := q.CreatePortalPreviewSession(r.Context(), id, hashToken(token), csrf, scope.WorkspaceID, preview, now, expires); err != nil {
				return err
			}
			return s.logPreview(r, q, "portal.preview_started", scope.WorkspaceID, preview.UserID, preview.ClientID, preview.ClientName, id)
		})
	}
	if err == store.ErrNotFound {
		http.Redirect(w, r, home+"login?preview=expired", http.StatusFound)
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: previewCookieName(r), Value: token, Path: "/", Expires: expires,
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, home, http.StatusFound)
}

// logPreview audits a preview's start or end as the member's step on the client.
func (s *Service) logPreview(r *http.Request, q store.Q, kind, workspaceID, userID, clientID, clientName, sessionID string) error {
	payload, err := json.Marshal(map[string]string{"client_id": clientID, "client_name": clientName, "session_id": sessionID})
	if err != nil {
		return err
	}
	return q.LogEvent(r.Context(), store.FinancialEvent{WorkspaceID: workspaceID, Kind: kind, SubjectType: "client",
		SubjectID: clientID, ActorID: &userID, At: s.now(), Payload: payload})
}

// readOnly: a preview may read and end itself, nothing else; one check here for every portal write.
func readOnly(r *http.Request, sess store.PortalSession) bool {
	return sess.PreviewBy != "" && r.Pattern != "DELETE /api/v1/public/portal/session"
}
