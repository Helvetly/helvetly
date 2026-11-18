package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"time"

	"helvetly.com/api/internal/store"
)

// Sessions: the cookie carries a random token, the database only its SHA-256. Every sign-in makes a new
// session (no fixation). A cookie-authenticated request that changes something must carry the session's
// CSRF token in X-CSRF-Token.

const (
	sessionCookie = "helvetly_session"
	csrfHeader    = "X-CSRF-Token"
)

type newSession struct {
	token, csrf string
	challenge   string
	linked      bool
	expires     time.Time
}

func (s *Service) createSession(ctx context.Context, q store.Q, userID, workspaceID string) (newSession, error) {
	now := s.now()
	ns := newSession{token: rand.Text(), csrf: rand.Text(), expires: now.Add(s.cfg.SessionTTL)}
	id := NewID("ses")
	if err := q.CreateSession(ctx, id, hashSecret(ns.token), ns.csrf, userID, workspaceID, now, ns.expires); err != nil {
		return newSession{}, err
	}
	if client, ok := ctx.Value(sessionClientKey{}).(sessionClient); ok {
		if err := q.SetSessionMetadata(ctx, id, client.agent, client.ip); err != nil {
			return newSession{}, err
		}
	}
	return ns, nil
}

type sessionClientKey struct{}
type sessionClient struct{ agent, ip string }

func withSessionClient(r *http.Request) context.Context {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	return context.WithValue(r.Context(), sessionClientKey{}, sessionClient{truncateRunes(r.UserAgent(), 512), ip})
}

func (s *Service) setSessionCookie(w http.ResponseWriter, ns newSession) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: ns.token, Path: "/", Expires: ns.expires,
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
}

// SignedIn lets the request through with its session, or answers 401; unsafe methods also need the CSRF token.
// A request with an Authorization header is an API token instead (tokens.go): no cookie, no CSRF.
func (s *Service) SignedIn(next func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h := r.Header.Get("Authorization"); h != "" {
			sess, r, err := s.bearerSession(r, h)
			if err != nil {
				s.WriteError(w, r, err)
				return
			}
			next(w, r, sess)
			return
		}
		c, err := r.Cookie(sessionCookie)
		if err != nil {
			s.WriteError(w, r, errUnauthenticated)
			return
		}
		sess, err := s.db.SessionByToken(r.Context(), hashSecret(c.Value), s.now())
		if errors.Is(err, store.ErrNotFound) {
			s.WriteError(w, r, errUnauthenticated)
			return
		}
		if err != nil {
			s.WriteError(w, r, err)
			return
		}
		safe := r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions
		if !safe && subtle.ConstantTimeCompare([]byte(r.Header.Get(csrfHeader)), []byte(sess.CSRFToken)) != 1 {
			s.WriteError(w, r, &apiError{status: http.StatusForbidden, code: "csrf_failed", message: "Missing or invalid X-CSRF-Token header."})
			return
		}
		if s.now().Sub(sess.LastActiveAt) >= 5*time.Minute {
			if err := s.db.TouchSession(r.Context(), sess.ID, s.now()); err != nil {
				s.WriteError(w, r, err)
				return
			}
		}
		next(w, r, sess)
	}
}

func (s *Service) getSession(w http.ResponseWriter, _ *http.Request, sess store.Session) {
	u := sess.User
	// effective: owners and admins have every scope a "*" reaches, plus the HR areas they hold (permissions.EffectiveHR)
	scopes := sess.Scopes
	switch sess.Role {
	case "owner":
		scopes = []string{"*:*", "write:employees", "write:payroll"}
	case "admin":
		hr := sess.Scopes
		if hr == nil {
			hr = store.AdminHR
		}
		scopes = append([]string{"*:*"}, hr...)
	}
	WriteJSON(w, http.StatusOK, map[string]any{
		"user": map[string]string{"id": u.ID, "email": u.Email, "name": u.Name, "avatar_url": u.AvatarURL},
		"workspace": map[string]any{"id": sess.Workspace.ID, "name": sess.Workspace.Name, "timezone": sess.Workspace.Timezone,
			"logo_url": store.WorkspaceLogoURL(sess.Workspace.ID, sess.Workspace.LogoFileID)},
		"role":   sess.Role,
		"scopes": scopes,
		// false shows the welcome: only to the owner of a workspace that isn't set up yet.
		"onboarded":  sess.Workspace.Onboarded || sess.Role != "owner",
		"csrf_token": sess.CSRFToken,
		// Pseudonyms for the platform's Google Analytics: Google never gets our ids, and they cannot be reversed.
		"analytics": map[string]string{"user_id": s.analyticsID("user", u.ID), "workspace_id": s.analyticsID("workspace", sess.Workspace.ID)},
	})
}

// analyticsID: a stable keyed hash of an id, the same for every session of it and unlinkable without SECRET_KEY.
func (s *Service) analyticsID(kind, id string) string {
	mac := hmac.New(sha256.New, s.cfg.SecretKey)
	mac.Write([]byte("analytics-" + kind + ":" + id))
	return hex.EncodeToString(mac.Sum(nil)[:12])
}

// finishOnboarding: the workspace's welcome was finished (its company step cannot be skipped: the stored company
// details must be complete); it is not shown again.
func (s *Service) finishOnboarding(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if sess.Role != "owner" && sess.Role != "admin" {
		s.WriteError(w, r, &apiError{status: http.StatusForbidden, code: "forbidden", message: "Only an owner or admin can set up the workspace."})
		return
	}
	if sess.Workspace.Onboarded { // finished before: nothing to check again, nothing reset
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if s.CompleteOnboarding == nil {
		s.WriteError(w, r, Error(http.StatusServiceUnavailable, "onboarding_unavailable", "The workspace cannot be set up right now. Try again later.", nil))
		return
	}
	err := s.CompleteOnboarding(r.Context(), sess.Workspace.ID, func(q store.Q) error {
		return q.SetWorkspaceOnboarded(r.Context(), sess.Workspace.ID, s.now())
	})
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) deleteSession(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if err := s.db.DeleteSession(r.Context(), sess.ID); err != nil {
		s.WriteError(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

// signedInResponse: the answer to a sign-in by email code or passkey.
func (s *Service) signedInResponse(w http.ResponseWriter, ns newSession, next string) {
	if ns.challenge != "" {
		WriteJSON(w, http.StatusOK, map[string]any{"two_factor_required": true, "challenge_id": ns.challenge})
		return
	}
	s.setSessionCookie(w, ns)
	WriteJSON(w, http.StatusCreated, map[string]string{"csrf_token": ns.csrf, "next": next})
}
