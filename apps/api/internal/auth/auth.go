// Package auth is passwordless sign-in (docs/auth-contract.md): Google (OpenID Connect), a 6-digit email
// code and passkeys (discoverable WebAuthn), all ending in a fresh cookie session bound to a workspace.
// The verified address is the person, so Google and an email code with the same address reach one user.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5/pgconn"

	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

type Service struct {
	cfg  config.Config
	db   *store.Store
	log  *slog.Logger
	mail interface {
		Send(context.Context, mail.Message) error
	} // nil when no mail server is configured
	now      func() time.Time
	webauthn *webauthn.WebAuthn

	googleIssuer string
	googleMu     sync.Mutex
	google       *googleClient // discovered on first use

	devCodes     devCodeBox
	codeLimit    *rateLimiter // codes sent per client address
	passkeyLimit *rateLimiter // passkey sign-in ceremonies per client address
	factorLimit  *rateLimiter
	tokenLimit   *rateLimiter // requests per API token

	// BearerRoutes tells whether an API token may call the request's route, the resource its scopes must cover
	// ("" for none) and whether the route writes (main sets it from the public catalogue). Nil: no route accepts a
	// token.
	BearerRoutes func(*http.Request) (allowed bool, resource string, write bool)
	// TokenResources are the resources an API token's scopes may name (the catalogue's tags in lower case).
	TokenResources []string

	// OnJoin runs in the transaction of a sign-in that joins a workspace through an invitation (notifications tells
	// the managers; auth cannot import it). Nil: nothing.
	OnJoin func(ctx context.Context, q store.Q, workspaceID string, user store.User, role string, now time.Time) error
	// OnPhotoRemoved deletes a closed account's own stored objects (photo, feedback screenshots) after the commit
	// (internal/avatars; auth holds no storage). Nil: the objects stay behind.
	OnPhotoRemoved func(ctx context.Context, objectKey string)
}

func New(cfg config.Config, db *store.Store, log *slog.Logger) (*Service, error) {
	wa, err := newWebAuthn(cfg.PublicURL)
	if err != nil {
		return nil, err
	}
	s := &Service{cfg: cfg, db: db, log: log, now: func() time.Time { return time.Now().UTC() }, webauthn: wa,
		googleIssuer: "https://accounts.google.com",
		codeLimit:    newRateLimiter(20, time.Hour), passkeyLimit: newRateLimiter(30, 10*time.Minute)}
	s.factorLimit = newRateLimiter(10, 10*time.Minute)
	s.tokenLimit = newRateLimiter(600, time.Minute)
	if cfg.MailConfigured() {
		s.mail = mail.NewSender(cfg.SMTP, cfg.PublicURL)
	}
	return s, nil
}

// Register adds the sign-in, session and passkey routes.
func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/auth/config", s.authConfig)
	mux.HandleFunc("GET /api/v1/auth/google/start", s.googleStart)
	mux.HandleFunc("GET /api/v1/auth/google/callback", s.googleCallback)
	mux.HandleFunc("POST /api/v1/auth/email/start", s.emailStart)
	mux.HandleFunc("POST /api/v1/auth/email/verify", s.emailVerify)
	mux.HandleFunc("GET /api/v1/auth/email/dev-code", s.emailDevCode)
	mux.HandleFunc("POST /api/v1/auth/passkey/start", s.passkeySignInStart)
	mux.HandleFunc("POST /api/v1/auth/passkey/finish", s.passkeySignInFinish)

	mux.HandleFunc("GET /api/v1/session", s.SignedIn(s.getSession))
	mux.HandleFunc("DELETE /api/v1/session", s.SignedIn(s.deleteSession))
	mux.HandleFunc("POST /api/v1/session/onboarded", s.SignedIn(s.finishOnboarding))
	mux.HandleFunc("GET /api/v1/session/workspaces", s.SignedIn(s.listWorkspaces))
	mux.HandleFunc("POST /api/v1/session/workspace", s.SignedIn(s.switchWorkspace))
	mux.HandleFunc("GET /api/v1/account/passkeys", s.SignedIn(s.listPasskeys))
	mux.HandleFunc("POST /api/v1/account/passkeys/start", s.SignedIn(s.passkeyAddStart))
	mux.HandleFunc("POST /api/v1/account/passkeys/finish", s.SignedIn(s.passkeyAddFinish))
	mux.HandleFunc("DELETE /api/v1/account/passkeys/{id}", s.SignedIn(s.deletePasskey))
	s.registerAccount(mux)
}

func (s *Service) authConfig(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{"google": s.cfg.GoogleSignIn(), "email": s.cfg.EmailSignIn(),
		"passkey": true, "dev_codes": s.cfg.DevSignIn, "portal_url": s.cfg.PortalURL,
		// The platform's page views; empty = off (the platform loads no analytics).
		"google_analytics_id": s.cfg.GoogleAnalyticsID})
}

// ---- errors and JSON ----

// apiError is an answer the client can act on; any other error is a 500 and is logged.
type apiError struct {
	status        int
	code, message string
	details       map[string]any
	retryAfter    string // Retry-After header, seconds
}

func (e *apiError) Error() string { return e.code + ": " + e.message }

var (
	errUnauthenticated = &apiError{status: http.StatusUnauthorized, code: "unauthenticated", message: "Sign in to continue."}
	ErrNotFound        = &apiError{status: http.StatusNotFound, code: "not_found", message: "Not found."}
)

// Error is an answer the client can act on, for handlers outside this package; details may be nil.
func Error(status int, code, message string, details map[string]any) error {
	return &apiError{status: status, code: code, message: message, details: details}
}

// Describe unwraps an answer made by Error, for a caller that reports it per item instead of failing the request.
func Describe(err error) (status int, code, message string, ok bool) {
	var ae *apiError
	if !errors.As(err, &ae) {
		return 0, "", "", false
	}
	return ae.status, ae.code, ae.message, true
}

func badRequest(msg string) *apiError {
	return &apiError{status: http.StatusBadRequest, code: "invalid_request", message: msg}
}

func (s *Service) WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var constraint *pgconn.PgError
	if errors.As(err, &constraint) && constraint.Code == "23514" && constraint.ConstraintName == "active_account_reference" {
		err = errUnauthenticated
	}
	var ae *apiError
	if !errors.As(err, &ae) {
		// The route's pattern, not its path: a public path carries a bearer token (/public/sign/{token}).
		route := r.Pattern
		if route == "" {
			route = r.URL.Path
		}
		s.log.ErrorContext(r.Context(), "request failed", "method", r.Method, "route", route, "error", err)
		ae = &apiError{status: http.StatusInternalServerError, code: "internal", message: "Something went wrong: try again."}
	}
	if ae.retryAfter != "" {
		w.Header().Set("Retry-After", ae.retryAfter)
	}
	body := map[string]any{"code": ae.code, "message": ae.message}
	if ae.details != nil {
		body["details"] = ae.details
	}
	WriteJSON(w, ae.status, map[string]any{"error": body})
}

func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body) // headers are sent; a write error means the client left
}

// Decode reads a JSON body into v: application/json only (a cross-site form cannot send it), unknown
// fields refused.
func (s *Service) Decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); ct != "application/json" {
		s.WriteError(w, r, &apiError{status: http.StatusUnsupportedMediaType, code: "unsupported_media_type",
			message: "Send the request as application/json."})
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		s.WriteError(w, r, badRequest(fmt.Sprintf("The request body is not valid: %v.", err)))
		return false
	}
	if err := dec.Decode(new(json.RawMessage)); err != io.EOF {
		s.WriteError(w, r, badRequest("The request body must be one JSON object."))
		return false
	}
	return true
}

// ---- secrets and ids ----

// NewID: a prefixed random id such as usr_2b4k...
func NewID(prefix string) string { return prefix + "_" + strings.ToLower(rand.Text()) }

func hashSecret(v string) string {
	h := sha256.Sum256([]byte(v))
	return hex.EncodeToString(h[:])
}

func truncateRunes(v string, n int) string {
	if r := []rune(v); len(r) > n {
		return strings.TrimSpace(string(r[:n]))
	}
	return v
}
