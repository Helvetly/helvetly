package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/store"
)

// Personal access tokens (docs/api-tokens-contract.md): `Authorization: Bearer hvt_…` stands for one person in one
// workspace, through the same SignedIn checks as a cookie, without CSRF, on the public routes only.

const tokenPrefix = "hvt_"

var (
	errTokenNotAllowed = &apiError{status: http.StatusForbidden, code: "token_not_allowed",
		message: "An API token cannot call this endpoint: sign in to the app instead."}
	errTokenMember = Error(http.StatusForbidden, "forbidden", "Your access to this workspace no longer includes the API.",
		map[string]any{"scope": "read:api"})
	errTokenRate = &apiError{status: http.StatusTooManyRequests, code: "rate_limited",
		message: "Too many API requests in this workspace: slow down.", retryAfter: "60"}
)

type bearerKey struct{}

// bearerSession resolves the request's token. The lookup (and its rate-limit hit) is done once per request and
// shared with the guards and the handler through the context; the route and scope are checked on every call.
func (s *Service) bearerSession(r *http.Request, header string, count bool) (store.Session, *http.Request, error) {
	allowed, resource, write := false, "", false
	if s.BearerRoutes != nil {
		allowed, resource, write = s.BearerRoutes(r)
	}
	ts, ok := r.Context().Value(bearerKey{}).(store.TokenSession)
	if !ok {
		var err error
		if ts, err = s.lookupToken(r, header); err != nil {
			return store.Session{}, r, err
		}
		if count {
			if err := s.AllowTokenRequest(r, ts.Workspace.ID, write); err != nil {
				return store.Session{}, r, err
			}
		}
		r = r.WithContext(context.WithValue(r.Context(), bearerKey{}, ts))
	}
	if !allowed {
		return store.Session{}, r, errTokenNotAllowed
	}
	if resource != "" && !scopesAllow(ts.TokenScopes, resource, write) {
		return store.Session{}, r, tokenScopeError(resource, write)
	}
	if s.BearerMember != nil && !s.BearerMember(ts.Session) {
		return store.Session{}, r, errTokenMember
	}
	return ts.Session, r, nil
}

// AllowTokenRequest counts one request in the workspace's read or write pool across all instances.
func (s *Service) AllowTokenRequest(r *http.Request, workspaceID string, write bool) error {
	if s.APIRate == nil {
		return nil
	}
	limit, err := s.APIRate(r.Context(), workspaceID, write)
	if err != nil || limit < 0 { // negative: unlimited
		return err
	}
	pool := "read"
	if write {
		pool = "write"
	}
	now := s.now()
	current, previous, err := s.db.CountAPIRequest(r.Context(), workspaceID, pool, now)
	if err != nil {
		return err
	}
	// the minute before weighs by the part of it still inside the rolling minute
	left := time.Minute - now.Sub(now.Truncate(time.Minute))
	if current+previous*int64(left)/int64(time.Minute) > limit {
		return errTokenRate
	}
	return nil
}

func (s *Service) lookupToken(r *http.Request, header string) (store.TokenSession, error) {
	secret, ok := strings.CutPrefix(header, "Bearer ")
	if !ok || !strings.HasPrefix(secret, tokenPrefix) {
		return store.TokenSession{}, errUnauthenticated
	}
	now := s.now()
	ts, err := s.db.SessionByAPIToken(r.Context(), hashSecret(secret), now)
	if errors.Is(err, store.ErrNotFound) {
		return ts, errUnauthenticated
	}
	if err != nil {
		return ts, err
	}
	if ts.LastUsedAt == nil || now.Sub(*ts.LastUsedAt) >= time.Minute {
		if err := s.db.TouchAPIToken(r.Context(), ts.ID, now); err != nil {
			return ts, err
		}
	}
	return ts, nil
}

func (s *Service) listTokens(w http.ResponseWriter, r *http.Request, sess store.Session) {
	tokens, err := s.db.APITokens(r.Context(), sess.User.ID)
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"data": tokens})
}

var tokenLifetimes = map[int]bool{30: true, 90: true, 365: true}

func (s *Service) createToken(w http.ResponseWriter, r *http.Request, sess store.Session) {
	var body struct {
		Name          string   `json:"name"`
		Scopes        []string `json:"scopes"`
		ExpiresInDays *int     `json:"expires_in_days"`
	}
	if !s.Decode(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	fields := map[string]string{}
	if n := utf8.RuneCountInString(name); n == 0 || n > 80 {
		fields["name"] = "Enter a name of up to 80 characters."
	}
	scopes, ok := canonicalScopes(body.Scopes, s.TokenResources)
	if !ok {
		fields["scopes"] = "Choose what the token may do: read or write, for every resource or for some."
	}
	if body.ExpiresInDays != nil && !tokenLifetimes[*body.ExpiresInDays] {
		fields["expires_in_days"] = "Choose 30, 90 or 365 days, or no expiry."
	}
	if len(fields) > 0 {
		s.WriteError(w, r, Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.", map[string]any{"fields": fields}))
		return
	}
	now := s.now()
	secret := tokenPrefix + rand.Text()
	t := store.APIToken{ID: NewID("tok"), Name: name, Scopes: scopes, Prefix: secret[:8],
		Workspace: store.TokenSpace{ID: sess.Workspace.ID, Name: sess.Workspace.Name}, CreatedAt: now}
	if body.ExpiresInDays != nil {
		exp := now.AddDate(0, 0, *body.ExpiresInDays)
		t.ExpiresAt = &exp
	}
	created, err := s.db.CreateAPIToken(r.Context(), t, sess.User.ID, hashSecret(secret))
	if err != nil {
		s.WriteError(w, r, err)
		return
	}
	if !created {
		s.WriteError(w, r, Error(http.StatusConflict, "too_many_tokens",
			"You have "+strconv.Itoa(store.MaxAPITokens)+" API tokens: revoke one first.", nil))
		return
	}
	WriteJSON(w, http.StatusCreated, map[string]any{"data": struct {
		store.APIToken
		Token string `json:"token"`
	}{t, secret}})
}

func (s *Service) deleteToken(w http.ResponseWriter, r *http.Request, sess store.Session) {
	if err := s.db.DeleteAPIToken(r.Context(), sess.User.ID, r.PathValue("id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			err = ErrNotFound
		}
		s.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func tokenScopeError(resource string, write bool) error {
	action, verb := "read", "read"
	if write {
		action, verb = "write", "change"
	}
	return Error(http.StatusForbidden, "token_scope", "This API token cannot "+verb+" "+resource+
		": create a token with the "+action+":"+resource+" scope.", map[string]any{"scope": action + ":" + resource})
}
