// Package invoices is a workspace's invoices and credit notes: drafts, issuing with gapless numbers, the PDF
// with the Swiss QR bill, payments, sending by email, and the seller settings (docs/invoices-contract.md).
package invoices

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Storage keeps the issued PDFs (internal/storage in production, a fake in tests).
type Storage interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	Get(ctx context.Context, key string) ([]byte, error)
	storage.Source // Open, PresignDownload, ProxyDownloads
	Delete(ctx context.Context, key string) error
}

// Mailer sends the invoice emails (internal/mail); nil when no mail server is configured.
type Mailer interface {
	Send(context.Context, mail.Message) error
}

type Service struct {
	db    *store.Store
	auth  Auth
	files Storage
	mail  Mailer
	log   *slog.Logger
	now   func() time.Time
	// einvoice exports an issued invoice's archived XML (internal/einvoice, which imports this package)
	einvoice EInvoiceExporter
}

// EInvoiceExporter is internal/einvoice's Export: the XML file of an issued invoice in format.
type EInvoiceExporter func(ctx context.Context, sess store.Session, inv store.Invoice, format string) (name string, xml []byte, err error)

// SetEInvoice is startup wiring: emails then attach the XML a client asked for (einvoice_format).
func (s *Service) SetEInvoice(f EInvoiceExporter) { s.einvoice = f }

func New(db *store.Store, a Auth, files Storage, mailer Mailer, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, mail: mailer, log: log, now: func() time.Time { return time.Now().UTC() }}
}

// today is the civil date in the workspace's time zone.
func (s *Service) today(ws store.Workspace) string { return ws.Today(s.now()) }

type handler func(http.ResponseWriter, *http.Request, store.Session) error

// handle registers a signed-in handler whose error is written once, a missing record as 404.
func (s *Service) handle(mux *http.ServeMux, pattern string, h handler) {
	mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		if err := h(w, r, sess); err != nil {
			if errors.Is(err, store.ErrNotFound) {
				err = auth.ErrNotFound
			}
			s.auth.WriteError(w, r, err)
		}
	}))
}

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) { s.handle(mux, pattern, h) }
	handle("GET /api/v1/invoice-settings", s.getSettings)
	handle("PUT /api/v1/invoice-settings", s.putSettings)
	handle("GET /api/v1/invoice-settings/logo", s.getLogo)
	handle("PUT /api/v1/invoice-settings/logo", s.putLogo)
	handle("DELETE /api/v1/invoice-settings/logo", s.deleteLogo)
	handle("GET /api/v1/invoices", s.list)
	handle("GET /api/v1/invoices/summary", s.summary)
	handle("GET /api/v1/invoices/export", s.export)
	handle("POST /api/v1/invoices/preview", s.preview)
	handle("POST /api/v1/invoices", s.create)
	handle("GET /api/v1/invoices/{id}", s.get)
	handle("PATCH /api/v1/invoices/{id}", s.update)
	handle("DELETE /api/v1/invoices/{id}", s.delete)
	handle("POST /api/v1/invoices/{id}/issue", s.issue)
	handle("POST /api/v1/invoices/{id}/plan", s.createPlan)
	handle("POST /api/v1/invoices/{id}/duplicate", s.duplicate)
	handle("POST /api/v1/invoices/{id}/credit-note", s.creditNote)
	handle("POST /api/v1/invoices/{id}/void", s.void)
	handle("GET /api/v1/invoices/{id}/payments", s.listPayments)
	handle("POST /api/v1/invoices/{id}/payments", s.addPayment)
	handle("POST /api/v1/invoices/{id}/mark-paid", s.markPaid)
	handle("DELETE /api/v1/invoices/{id}/payments/{payment_id}", s.deletePayment)
	handle("POST /api/v1/invoices/{id}/refunds", s.addRefund)
	handle("DELETE /api/v1/invoices/{id}/refunds/{refund_id}", s.deleteRefund)
	handle("POST /api/v1/invoices/{id}/send", s.send)
	handle("GET /api/v1/invoices/{id}/email", s.emailDraft)
	handle("GET /api/v1/invoices/{id}/deliveries", s.deliveries)
	handle("GET /api/v1/invoices/{id}/pdf", s.pdf)
	s.registerDerived(mux)
}

var (
	errForbidden = auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can do this.", nil)
	errLocked    = auth.Error(http.StatusConflict, "invoice_locked", "Issued documents cannot be changed: correct them with a credit note.", nil)
)

var (
	errPeriodClosed = auth.Error(http.StatusConflict, "period_closed", "This month is closed in the books: reopen it to change it.", nil)
	errNoAgreement  = auth.Error(http.StatusConflict, "self_billing_agreement_missing",
		"Record the supplier's self-billing agreement covering the issue date before issuing a self-billed invoice.", nil)
)

// checkOpen refuses a change dated in a closed month (docs/books-contract.md).
func checkOpen(ctx context.Context, q store.Q, workspaceID, date string) error {
	if err := q.CheckOpen(ctx, workspaceID, date); errors.Is(err, store.ErrPeriodClosed) {
		return errPeriodClosed
	} else if err != nil {
		return fmt.Errorf("check period of %s: %w", date, err)
	}
	return nil
}

// logEvent writes an invoice's audit event in the caller's transaction; the hourly job (no user) has no actor.
func (s *Service) logEvent(ctx context.Context, q store.Q, sess store.Session, kind, invoiceID string, payload map[string]any) error {
	return logEventAt(ctx, q, sess, s.now(), kind, invoiceID, payload)
}

func logEventAt(ctx context.Context, q store.Q, sess store.Session, at time.Time, kind, invoiceID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("log %s: %w", kind, err)
	}
	var actor *string
	if sess.User.ID != "" {
		actor = &sess.User.ID
	}
	return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: kind, SubjectType: "invoice",
		SubjectID: invoiceID, ActorID: actor, At: at, Payload: raw})
}

func invalidState(msg string) error {
	return auth.Error(http.StatusConflict, "invalid_state", msg, nil)
}

func canManage(sess store.Session) bool { return sess.Role == "owner" || sess.Role == "admin" }

func data(v any) map[string]any { return map[string]any{"data": v} }

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
		map[string]any{"fields": fields})
}

func badRequest(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

// load reads the session's document; drafts get their payment details from the current settings.
func (s *Service) load(ctx context.Context, q store.Q, sess store.Session, id string, forUpdate bool) (store.Invoice, error) {
	inv, err := q.Invoice(ctx, sess.Workspace.ID, id, s.today(sess.Workspace), forUpdate)
	if err != nil {
		return inv, err
	}
	if inv.Status == "draft" {
		set, err := loadSettings(ctx, q, sess.Workspace.ID)
		if err != nil {
			return inv, err
		}
		markGenerated(&inv)
		compute(&inv) // a draft's prepayment deduction follows the prepayments it picked
		syncSchedule(&inv)
		draftPayment(&inv, set)
	}
	allocate(&inv, s.today(sess.Workspace))
	return inv, nil
}

func (s *Service) respond(w http.ResponseWriter, r *http.Request, sess store.Session, status int, id string) error {
	inv, err := s.load(r.Context(), s.db.Q, sess, id, false)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, status, data(withCode(inv)))
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respond(w, r, sess, http.StatusOK, r.PathValue("id"))
}

// fileName: e.g. "Rechnung-2026-001.pdf".
func fileName(inv store.Invoice) string {
	name := Title(inv)
	if inv.Number != nil {
		name += "-" + strings.ReplaceAll(*inv.Number, "/", "-")
	}
	return name + ".pdf"
}
