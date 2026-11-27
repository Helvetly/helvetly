package portal

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/store"
)

const (
	sessionCookie = "helvetly_portal_session"
	csrfHeader    = "X-CSRF-Token"
	// Mirror staff email sign-in's answer (internal/auth keeps them private).
	resendIn  = 30
	expiresIn = 600
)

var (
	errUnauthenticated = auth.Error(http.StatusUnauthorized, "unauthenticated", "Sign in to continue.", nil)
	errNoAccess        = auth.Error(http.StatusForbidden, "no_portal_access", "This address has no access to a client portal.", nil)
	errCSRF            = auth.Error(http.StatusForbidden, "csrf_failed", "Missing or invalid X-CSRF-Token header.", nil)
	errTooMany         = auth.Error(http.StatusTooManyRequests, "rate_limited", "Too many requests: try again in a minute.", nil)
	// The shared portal signs nobody in: a client signs in at their supplier's own portal address.
	errUseSupplierLink = auth.Error(http.StatusNotFound, "portal_link_required", "Sign in through your supplier's portal link.", nil)
)

func hashToken(v string) string {
	h := sha256.Sum256([]byte(v))
	return hex.EncodeToString(h[:])
}

// cookieName keeps one session per portal scope in the browser: signing in to one workspace's portal leaves the
// others' sessions alone, and a cookie of one scope is never even read under another.
func cookieName(r *http.Request) string {
	if scope, ok := portalscope.FromContext(r.Context()); ok {
		return sessionCookie + "_" + scope.WorkspaceID
	}
	return sessionCookie
}

// scopeWorkspace is the workspace the request is scoped to, "" for the unscoped portal.
func scopeWorkspace(r *http.Request) string {
	scope, _ := portalscope.FromContext(r.Context())
	return scope.WorkspaceID
}

func (s *Service) cookie(r *http.Request, token string, expires time.Time) *http.Cookie {
	return &http.Cookie{Name: cookieName(r), Value: token, Path: "/", Expires: expires,
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode}
}

// open makes a new session for email on the access (ending replaces, when set, in the same transaction), sets its cookie and answers 201 with its CSRF token.
func (s *Service) open(w http.ResponseWriter, r *http.Request, email string, a store.PortalAccess, replaces string) error {
	now := s.now()
	token, csrf, expires := rand.Text(), rand.Text(), now.Add(s.cfg.SessionTTL)
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if replaces != "" {
			if err := q.DeletePortalSession(r.Context(), replaces); err != nil {
				return err
			}
		}
		id := auth.NewID("pse")
		if err := q.CreatePortalSession(r.Context(), id, hashToken(token), csrf, email, a.ClientID, a.ParticipantID, a.WorkspaceID, scopeWorkspace(r) != "", now, expires); err != nil {
			return err
		}
		if a.ParticipantID != "" { // a participant's access is audited; the client's first sign-in stays the client's own
			return s.logParticipant(r, q, "portal.participant_signed_in", a.WorkspaceID, a.ClientID, a.ClientName, a.ParticipantID, a.ParticipantName, id)
		}
		if first, err := q.MarkPortalSignedIn(r.Context(), a.ClientID, now); err != nil || !first {
			return err
		}
		return notifications.Notify(r.Context(), q, a.WorkspaceID, "portal.first_sign_in",
			map[string]any{"client_id": a.ClientID, "client_name": a.ClientName, "contact_name": email},
			store.NotifyTo{Roles: notifications.Managers}, now)
	})
	if err != nil {
		return err
	}
	http.SetCookie(w, s.cookie(r, token, expires))
	auth.WriteJSON(w, http.StatusCreated, map[string]string{"csrf_token": csrf})
	return nil
}

func (s *Service) start(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	if scopeWorkspace(r) == "" {
		s.fail(w, r, errUseSupplierLink)
		return
	}
	email := strings.TrimSpace(in.Email)
	if _, err := mail.ParseAddress(email); err != nil {
		s.fail(w, r, auth.Error(http.StatusBadRequest, "invalid_email", "Enter a valid email address.", nil))
		return
	}
	access, err := s.access(r, email)
	if err == nil {
		// Every address goes through the same cooldown and limits; only one with access gets the code.
		err = s.auth.SendEmailCode(r, email, scopeWorkspace(r), len(access) > 0)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	auth.WriteJSON(w, http.StatusAccepted, map[string]int{"resend_in": resendIn, "expires_in": expiresIn})
}

func (s *Service) verify(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
		Code  string `json:"code"`
		// TimeZone is the browser's zone; the client's first one is kept (clients.time_zone) for its sessions' times.
		TimeZone string `json:"time_zone"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	if scopeWorkspace(r) == "" {
		s.fail(w, r, errUseSupplierLink)
		return
	}
	email, err := s.auth.ConsumeEmailCode(r.Context(), in.Email, in.Code)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	access, err := s.access(r, email)
	if err == nil && len(access) == 0 {
		err = errNoAccess
	}
	if err == nil {
		err = s.open(w, r, email, access[0], "")
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if zone := in.TimeZone; zone != "" && len(zone) <= 64 && validZone(zone) {
		if err := s.db.Q.SetClientTimeZone(r.Context(), access[0].WorkspaceID, access[0].ClientID, &zone, true); err != nil {
			s.log.WarnContext(r.Context(), "client time zone not saved", "error", err)
		}
	}
}

// validZone: an IANA zone name (LoadLocation refuses paths), never the server's "Local".
func validZone(name string) bool {
	_, err := time.LoadLocation(name)
	return err == nil && name != "Local"
}

// signedIn lets the request through with its portal session, or answers 401; unsafe methods also need the CSRF token.
func (s *Service) signedIn(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, err := s.session(r)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		safe := r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions
		if !safe && subtle.ConstantTimeCompare([]byte(r.Header.Get(csrfHeader)), []byte(sess.CSRFToken)) != 1 {
			s.fail(w, r, errCSRF)
			return
		}
		if !safe && readOnly(r, sess) {
			s.fail(w, r, errPreviewReadOnly)
			return
		}
		if !participantAllows(r, sess) {
			s.fail(w, r, auth.ErrNotFound)
			return
		}
		if err := s.participantOwns(r, sess); err != nil {
			s.fail(w, r, schedFail(err))
			return
		}
		// A workspace whose plan no longer has the portal ends its sessions on their next request, without saying why:
		// the client is not told the workspace's plan.
		if open, err := s.db.Q.FeatureAllowed(r.Context(), sess.Workspace.ID, store.FeatureClientPortal); err != nil || !open {
			if err == nil {
				err = s.db.Q.DeletePortalSession(r.Context(), sess.ID)
			}
			if err == nil {
				err = errUnauthenticated
			}
			s.fail(w, r, err)
			return
		}
		// A preview leaves no trace of activity.
		if err := s.touch(r, sess); err != nil {
			s.fail(w, r, err)
			return
		}
		if err := h(w, r, sess); err != nil {
			s.fail(w, r, err)
		}
	}
}

// session is the request's live session under its scope: a member's preview (its own cookie) before the client's own.
func (s *Service) session(r *http.Request) (store.PortalSession, error) {
	// Only a workspace's own address has sessions; one opened on the shared portal before it stopped signing in
	// is not read.
	if scopeWorkspace(r) == "" {
		return store.PortalSession{}, errUnauthenticated
	}
	for _, name := range []string{previewCookieName(r), cookieName(r)} {
		c, err := r.Cookie(name)
		if err != nil {
			continue
		}
		sess, err := s.db.Q.PortalSessionByToken(r.Context(), hashToken(c.Value), s.now())
		if err == store.ErrNotFound {
			continue
		}
		if err != nil {
			return sess, err
		}
		// A session is valid only under the scope it was opened in (one workspace's never reads another's), and a
		// preview only from its own cookie.
		if sess.Scoped && sess.Workspace.ID == scopeWorkspace(r) && (sess.PreviewBy != "") == (name == previewCookieName(r)) {
			return sess, nil
		}
	}
	return store.PortalSession{}, errUnauthenticated
}

func (s *Service) touch(r *http.Request, sess store.PortalSession) error {
	if sess.PreviewBy != "" {
		return nil
	}
	return s.db.Q.TouchPortalSession(r.Context(), sess.ID, s.now())
}

func (s *Service) getSession(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	access, err := s.access(r, sess.Email)
	if err != nil {
		return err
	}
	type clientRef struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		WorkspaceName   string `json:"workspace_name"`
		ParticipantID   string `json:"participant_id,omitempty"`
		ParticipantName string `json:"participant_name,omitempty"`
	}
	avatar, err := s.sessionAvatarURL(r, sess)
	if err != nil {
		return err
	}
	var preview any
	if sess.PreviewBy != "" {
		preview = map[string]string{"started_by": sess.PreviewByName}
	}
	clients := make([]clientRef, 0, len(access))
	for _, a := range access {
		clients = append(clients, clientRef{a.ClientID, a.ClientName, a.WorkspaceName, a.ParticipantID, a.ParticipantName})
	}
	// participant: the session is one participant's, who sees only their sessions (and, in participants mode, the
	// invoices and documents addressed to them).
	var participant any
	if sess.ParticipantID != "" {
		participant = map[string]any{"id": sess.ParticipantID, "name": sess.ParticipantName, "documents": sess.ParticipantsMode}
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{
		"email":       sess.Email,
		"avatar_url":  avatar,
		"client":      map[string]string{"id": sess.ClientID, "name": sess.ClientName},
		"workspace":   map[string]string{"name": sess.Workspace.Name},
		"csrf_token":  sess.CSRFToken,
		"clients":     clients,
		"preview":     preview,
		"participant": participant,
	})
	return nil
}

func (s *Service) switchClient(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	var in struct {
		ClientID      string `json:"client_id"`
		ParticipantID string `json:"participant_id"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	access, err := s.access(r, sess.Email)
	if err != nil {
		return err
	}
	for _, a := range access {
		if a.ClientID == in.ClientID && a.ParticipantID == in.ParticipantID {
			return s.open(w, r, sess.Email, a, sess.ID)
		}
	}
	return auth.ErrNotFound
}

func (s *Service) deleteSession(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	name := cookieName(r)
	err := s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.DeletePortalSession(r.Context(), sess.ID); err != nil {
			return err
		}
		if sess.ParticipantID != "" {
			return s.logParticipant(r, q, "portal.participant_signed_out", sess.Workspace.ID, sess.ClientID, sess.ClientName,
				sess.ParticipantID, sess.ParticipantName, sess.ID)
		}
		if sess.PreviewBy == "" {
			return nil
		}
		name = previewCookieName(r)
		return s.logPreview(r, q, "portal.preview_ended", sess.Workspace.ID, sess.PreviewBy, sess.ClientID, sess.ClientName, sess.ID)
	})
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: name, Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// access is the clients email may open in the portal: those of workspaces whose plan includes it, and only the
// scope's workspace under a scope.
func (s *Service) access(r *http.Request, email string) ([]store.PortalAccess, error) {
	ctx := r.Context()
	all, err := s.db.Q.PortalAccessByEmail(ctx, email, scopeWorkspace(r))
	if err != nil {
		return nil, err
	}
	out := make([]store.PortalAccess, 0, len(all))
	for _, a := range all {
		open, err := s.db.Q.FeatureAllowed(ctx, a.WorkspaceID, store.FeatureClientPortal)
		if err != nil {
			return nil, err
		}
		if open {
			out = append(out, a)
		}
	}
	return out, nil
}

// logParticipant audits a participant's portal session starting or ending, on the client.
func (s *Service) logParticipant(r *http.Request, q store.Q, kind, workspaceID, clientID, clientName, participantID, participantName, sessionID string) error {
	payload, err := json.Marshal(map[string]string{"client_id": clientID, "client_name": clientName, "participant_id": participantID,
		"participant_name": participantName, "session_id": sessionID})
	if err != nil {
		return err
	}
	return q.LogEvent(r.Context(), store.FinancialEvent{WorkspaceID: workspaceID, Kind: kind, SubjectType: "client",
		SubjectID: clientID, At: s.now(), Payload: payload})
}
