// Package portal is the client portal: a client's contacts signed in by email code (docs/portal-contract.md).
package portal

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the email codes, and its error and JSON conventions.
type Auth interface {
	SendEmailCode(r *http.Request, email string, deliver bool) error
	ConsumeEmailCode(ctx context.Context, email, code string) (string, error)
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Storage holds the files' bytes (internal/storage in production, a fake in tests).
type Storage interface {
	Get(ctx context.Context, key string) ([]byte, error)
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	Delete(ctx context.Context, key string) error
	storage.Source // Open, PresignDownload, ProxyDownloads
}

type Config struct {
	SessionTTL   time.Duration
	CookieSecure bool
}

type Service struct {
	db    *store.Store
	auth  Auth
	files Storage
	cfg   Config
	log   *slog.Logger
	now   func() time.Time
}

func New(db *store.Store, a Auth, files Storage, cfg Config, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, cfg: cfg, log: log, now: func() time.Time { return time.Now().UTC() }}
}

type handler func(http.ResponseWriter, *http.Request, store.PortalSession) error

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/public/portal/auth/start", s.start)
	mux.HandleFunc("POST /api/v1/public/portal/auth/verify", s.verify)
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.signedIn(h))
	}
	handle("GET /api/v1/public/portal/session", s.getSession)
	handle("POST /api/v1/public/portal/session/client", s.switchClient)
	handle("DELETE /api/v1/public/portal/session", s.deleteSession)
	s.registerData(handle)
	s.registerQuotes(handle)
	s.registerProfile(handle)
	s.registerAvatar(handle)
}

func data(v any) map[string]any { return map[string]any{"data": v} }

func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotFound) {
		err = auth.ErrNotFound
	}
	s.auth.WriteError(w, r, err)
}
