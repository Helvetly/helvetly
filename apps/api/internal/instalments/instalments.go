// Package instalments runs instalment plans and reminders (docs/invoices-contract.md "Instalment plans", "Reminders"):
// the plan endpoints, the hourly job that issues due plan items and sends reminders, and the digest's "Instalments"
// section.
package instalments

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session and its error convention.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
}

// Storage reads the issued invoice PDFs the reminders attach (the invoices package's storage).
type Storage interface {
	Get(ctx context.Context, key string) ([]byte, error)
}

// Mailer sends the reminders (internal/mail); nil when no mail server is configured.
type Mailer interface {
	Send(context.Context, mail.Message) error
}

// Limits is the billing plan's invoice limit (internal/billing); nil means no limit.
type Limits interface {
	InvoiceAllowed(context.Context, store.Workspace) (bool, error)
}

type Service struct {
	db     *store.Store
	auth   Auth
	inv    *invoices.Service
	files  Storage
	mailer Mailer
	limits Limits
	log    *slog.Logger
	now    func() time.Time
}

func New(db *store.Store, a Auth, inv *invoices.Service, files Storage, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, inv: inv, files: files, log: log, now: func() time.Time { return time.Now().UTC() }}
}

// SetMailer enables the reminders.
func (s *Service) SetMailer(m Mailer) { s.mailer = m }

// SetLimits makes the job respect the billing plan's invoice limit.
func (s *Service) SetLimits(l Limits) { s.limits = l }

// overLimit: the workspace's plan allows no more invoices this month.
func (s *Service) overLimit(ctx context.Context, ws store.Workspace) (bool, error) {
	if s.limits == nil {
		return false, nil
	}
	ok, err := s.limits.InvoiceAllowed(ctx, ws)
	if err != nil {
		return false, fmt.Errorf("plan limit: %w", err)
	}
	return !ok, nil
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/instalment-plans", s.list)
	handle("GET /api/v1/instalment-plans/{id}", s.get)
	handle("POST /api/v1/instalment-plans/{id}/pause", s.transition("paused", "active"))
	handle("POST /api/v1/instalment-plans/{id}/resume", s.transition("active", "paused"))
	handle("POST /api/v1/instalment-plans/{id}/cancel", s.transition("cancelled", "active", "paused"))
}

func data(v any) map[string]any { return map[string]any{"data": v} }
