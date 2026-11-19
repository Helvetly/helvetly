package portal

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
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
		if err := q.CreatePortalSession(r.Context(), auth.NewID("pse"), hashToken(token), csrf, email, a.ClientID, a.WorkspaceID, scopeWorkspace(r) != "", now, expires); err != nil {
			return err
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
	email := strings.TrimSpace(in.Email)
	if _, err := mail.ParseAddress(email); err != nil {
		s.fail(w, r, auth.Error(http.StatusBadRequest, "invalid_email", "Enter a valid email address.", nil))
		return
	}
	access, err := s.access(r, email)
	if err == nil {
		// Every address goes through the same cooldown and limits; only one with access gets the code.
		err = s.auth.SendEmailCode(r, email, len(access) > 0)
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
	}
	if !s.auth.Decode(w, r, &in) {
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
	}
}

// signedIn lets the request through with its portal session, or answers 401; unsafe methods also need the CSRF token.
func (s *Service) signedIn(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName(r))
		if err != nil {
			s.fail(w, r, errUnauthenticated)
			return
		}
		sess, err := s.db.Q.PortalSessionByToken(r.Context(), hashToken(c.Value), s.now())
		// A session is valid only under the scope it was opened in: one workspace's never reads another's.
		if err == nil && (sess.Scoped != (scopeWorkspace(r) != "") || sess.Scoped && sess.Workspace.ID != scopeWorkspace(r)) {
			err = store.ErrNotFound
		}
		if err == store.ErrNotFound {
			s.fail(w, r, errUnauthenticated)
			return
		}
		if err != nil {
			s.fail(w, r, err)
			return
		}
		safe := r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions
		if !safe && subtle.ConstantTimeCompare([]byte(r.Header.Get(csrfHeader)), []byte(sess.CSRFToken)) != 1 {
			s.fail(w, r, errCSRF)
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
		if err := s.db.Q.TouchPortalSession(r.Context(), sess.ID, s.now()); err != nil {
			s.fail(w, r, err)
			return
		}
		if err := h(w, r, sess); err != nil {
			s.fail(w, r, err)
		}
	}
}

func (s *Service) getSession(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	access, err := s.access(r, sess.Email)
	if err != nil {
		return err
	}
	type clientRef struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		WorkspaceName string `json:"workspace_name"`
	}
	avatar, err := s.sessionAvatarURL(r, sess)
	if err != nil {
		return err
	}
	clients := make([]clientRef, 0, len(access))
	for _, a := range access {
		clients = append(clients, clientRef{a.ClientID, a.ClientName, a.WorkspaceName})
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{
		"email":      sess.Email,
		"avatar_url": avatar,
		"client":     map[string]string{"id": sess.ClientID, "name": sess.ClientName},
		"workspace":  map[string]string{"name": sess.Workspace.Name},
		"csrf_token": sess.CSRFToken,
		"clients":    clients,
	})
	return nil
}

func (s *Service) switchClient(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	var in struct {
		ClientID string `json:"client_id"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	access, err := s.access(r, sess.Email)
	if err != nil {
		return err
	}
	for _, a := range access {
		if a.ClientID == in.ClientID {
			return s.open(w, r, sess.Email, a, sess.ID)
		}
	}
	return auth.ErrNotFound
}

func (s *Service) deleteSession(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	if err := s.db.Q.DeletePortalSession(r.Context(), sess.ID); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName(r), Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
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
