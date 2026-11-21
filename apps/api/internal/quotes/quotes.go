// Package quotes is a workspace's quotes (Offerten): drafts with invoice lines and totals, sending with the PDF,
// the client's or staff's acceptance or decline, revising, and turning an accepted quote into an invoice draft
// (docs/quotes-contract.md). A quote is not a financial record: it writes no audit events and ignores closed periods.
package quotes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/approvals"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Invoices is what a quote borrows from internal/invoices: input rules, totals, the PDF and the invoice draft.
type Invoices interface {
	NewQuote(ctx context.Context, q store.Q, sess store.Session, body map[string]json.RawMessage) (store.Invoice, error)
	ApplyQuote(ctx context.Context, q store.Q, workspaceID string, inv *store.Invoice, body map[string]json.RawMessage) error
	QuotePDF(ctx context.Context, q store.Q, workspaceID string, inv store.Invoice, draft bool) ([]byte, error)
	QuoteNumber(ctx context.Context, q store.Q, workspaceID, issueDate string, seq int64) (string, error)
	CreateDraft(ctx context.Context, q store.Q, sess store.Session, clientID string, fill func(*store.Invoice)) (string, error)
	Seller(ctx context.Context, q store.Q, workspaceID string) (store.Party, []byte, string, error)
	QuoteScheduleProblems(inv store.Invoice) error
}

// Storage keeps the PDF of each send, which the portal serves.
type Storage interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	Get(ctx context.Context, key string) ([]byte, error)
}

// Mailer sends the quote emails (internal/mail); nil when no mail server is configured.
type Mailer interface {
	Send(context.Context, mail.Message) error
}

type Service struct {
	db        *store.Store
	auth      Auth
	invoices  Invoices
	files     Storage
	mail      Mailer
	approvals *approvals.Service // nil: nothing is gated
	log       *slog.Logger
	now       func() time.Time
}

func New(db *store.Store, a Auth, inv Invoices, files Storage, mailer Mailer, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, invoices: inv, files: files, mail: mailer, log: log, now: func() time.Time { return time.Now().UTC() }}
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
	handle("GET /api/v1/quotes", s.list)
	handle("POST /api/v1/quotes", s.create)
	handle("GET /api/v1/quotes/{id}", s.get)
	handle("PATCH /api/v1/quotes/{id}", s.update)
	handle("DELETE /api/v1/quotes/{id}", s.delete)
	handle("GET /api/v1/quotes/{id}/pdf", s.pdf)
	handle("GET /api/v1/quotes/{id}/email", s.emailDraft)
	handle("POST /api/v1/quotes/{id}/send", s.send)
	handle("POST /api/v1/quotes/{id}/accept", s.decide(true))
	handle("POST /api/v1/quotes/{id}/decline", s.decide(false))
	handle("POST /api/v1/quotes/{id}/revise", s.revise)
	handle("POST /api/v1/quotes/{id}/invoice", s.toInvoice)
	handle("POST /api/v1/quotes/{id}/duplicate", s.duplicate)
	if s.approvals != nil {
		s.approvals.Routes(func(p string, h func(http.ResponseWriter, *http.Request, store.Session) error) { handle(p, h) },
			"/api/v1/quotes/{id}/approval", s.approvalLoad)
	}
}

// SetApprovals is startup wiring: draft quotes whose policy applies are approved before they are sent.
func (s *Service) SetApprovals(a *approvals.Service) { s.approvals = a }

func approvalDoc(t store.Quote) approvals.Doc {
	return approvals.Doc{Type: "quote", Subject: "quote", Resource: "invoices", ID: t.ID, Draft: t.Status == "draft",
		Kind: "quote", Client: t.Client.Name, Currency: t.Currency, Total: t.PayableTotal}
}

func (s *Service) approvalLoad(ctx context.Context, q store.Q, sess store.Session, id string, lock bool) (approvals.Doc, error) {
	t, err := q.Quote(ctx, sess.Workspace.ID, id, today(sess.Workspace, s.now()), lock)
	return approvalDoc(t), err
}

// wrote records the session's person as an author of the draft: an author never approves it (internal/approvals).
func wrote(ctx context.Context, q store.Q, sess store.Session, id string) error {
	if sess.User.ID == "" { // a job
		return nil
	}
	return q.AddApprovalAuthor(ctx, sess.Workspace.ID, id, sess.User.ID)
}

const defaultValidDays = 30

// inputKeys: the invoice fields a quote takes and its own valid_until.
var inputKeys = []string{"client_id", "issue_date", "valid_until", "currency", "language", "vat_mode", "reference", "client_number_display",
	"contract_reference", "contract_document_id", "intro",
	"footer", "note", "discount_percent", "lines", "instalments"}

func data(v any) map[string]any { return map[string]any{"data": v} }

func today(ws store.Workspace, now time.Time) string { return ws.Today(now) }

func invalidState(msg string) error {
	return auth.Error(http.StatusConflict, "invalid_state", msg, nil)
}

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.", map[string]any{"fields": fields})
}

func badRequest(msg string) error {
	return auth.Error(http.StatusBadRequest, "invalid_request", msg, nil)
}

var errLocked = auth.Error(http.StatusConflict, "quote_locked", "Only a draft quote can be changed: revise it first.", nil)

// decodeObject reads a JSON object body, refusing keys outside allowed.
func (s *Service) decodeObject(w http.ResponseWriter, r *http.Request, allowed []string) (map[string]json.RawMessage, bool, error) {
	var body map[string]json.RawMessage
	if !s.auth.Decode(w, r, &body) {
		return nil, false, nil
	}
	if body == nil {
		return nil, false, badRequest("The body must be a JSON object.")
	}
	for _, k := range slices.Sorted(maps.Keys(body)) {
		if !slices.Contains(allowed, k) {
			return nil, false, badRequest(fmt.Sprintf("Unknown field %q.", k))
		}
	}
	return body, true, nil
}

// asInvoice: the quote in the invoice shape internal/invoices validates, computes and renders; DueDate is valid_until.
func asInvoice(t store.Quote) store.Invoice {
	number := t.Number
	if number != nil && t.Revision > 1 {
		n := fmt.Sprintf("%s (Rev. %d)", *number, t.Revision)
		number = &n
	}
	return store.Invoice{ID: t.ID, Kind: "quote", Status: "draft", Number: number, ClientID: t.ClientID, Client: t.Client,
		IssueDate: t.IssueDate, DueDate: t.ValidUntil, Currency: t.Currency, Language: t.Language, VATMode: t.VATMode,
		Reference: t.Reference, ClientNumberDisplay: t.ClientNumberDisplay, ContractReference: t.ContractReference,
		ContractDocument: t.ContractDocument, Intro: t.Intro, Footer: t.Footer, Note: t.Note, DiscountPercent: t.DiscountPercent,
		Lines: t.Lines, Subtotal: t.Subtotal, DiscountAmount: t.DiscountAmount, NetTotal: t.NetTotal,
		VATBreakdown: t.VATBreakdown, VATTotal: t.VATTotal, Total: t.Total, RoundingAmount: t.RoundingAmount,
		Instalments: t.Instalments}
}

// fromInvoice copies the content internal/invoices validated and computed back onto the quote.
func fromInvoice(t *store.Quote, inv store.Invoice) {
	t.ClientID, t.Client, t.IssueDate, t.ValidUntil = inv.ClientID, inv.Client, inv.IssueDate, inv.DueDate
	t.Currency, t.Language, t.VATMode, t.Reference = inv.Currency, inv.Language, inv.VATMode, inv.Reference
	t.ClientNumberDisplay, t.ContractReference, t.ContractDocument = inv.ClientNumberDisplay, inv.ContractReference, inv.ContractDocument
	t.Intro, t.Footer, t.Note, t.DiscountPercent, t.Lines = inv.Intro, inv.Footer, inv.Note, inv.DiscountPercent, inv.Lines
	t.Subtotal, t.DiscountAmount, t.NetTotal, t.VATBreakdown = inv.Subtotal, inv.DiscountAmount, inv.NetTotal, inv.VATBreakdown
	t.VATTotal, t.Total, t.RoundingAmount, t.PayableTotal = inv.VATTotal, inv.Total, inv.RoundingAmount, inv.Payable()
	t.Instalments = inv.Instalments
}

// apply validates body onto the quote: the invoice fields through internal/invoices, then valid_until.
func (s *Service) apply(ctx context.Context, q store.Q, workspaceID string, t *store.Quote, body map[string]json.RawMessage) error {
	invBody := maps.Clone(body)
	delete(invBody, "valid_until")
	inv := asInvoice(*t)
	if err := s.invoices.ApplyQuote(ctx, q, workspaceID, &inv, invBody); err != nil {
		return err
	}
	if raw, ok := body["valid_until"]; ok {
		var v string
		if json.Unmarshal(raw, &v) != nil {
			return validationFailed(map[string]string{"valid_until": "Enter the date as YYYY-MM-DD."})
		}
		if _, err := time.Parse(time.DateOnly, v); err != nil {
			return validationFailed(map[string]string{"valid_until": "Enter the date as YYYY-MM-DD."})
		}
		inv.DueDate = v
	}
	if inv.DueDate < inv.IssueDate {
		return validationFailed(map[string]string{"valid_until": "The quote must be valid on or after its date."})
	}
	fromInvoice(t, inv)
	return nil
}

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.db.Quotes(r.Context(), sess.Workspace.ID, r.URL.Query().Get("client_id"), today(sess.Workspace, s.now()))
	if err != nil {
		return err
	}
	if status := r.URL.Query().Get("status"); status != "" {
		list = slices.DeleteFunc(list, func(t store.Quote) bool { return t.Status != status })
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

func (s *Service) respond(w http.ResponseWriter, r *http.Request, sess store.Session, status int, id string) error {
	t, err := s.db.Quote(r.Context(), sess.Workspace.ID, id, today(sess.Workspace, s.now()), false)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, status, data(t))
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respond(w, r, sess, http.StatusOK, r.PathValue("id"))
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, ok, err := s.decodeObject(w, r, inputKeys)
	if !ok {
		return err
	}
	ctx := r.Context()
	t := store.Quote{ID: auth.NewID("quo"), Status: "draft", Revision: 1}
	err = s.db.Tx(ctx, func(q store.Q) error {
		inv, err := s.invoices.NewQuote(ctx, q, sess, body)
		if err != nil {
			return err
		}
		inv.ID, inv.IssueDate = t.ID, today(sess.Workspace, s.now())
		if _, ok := body["valid_until"]; !ok { // valid for the default days from the quote's date
			from := inv.IssueDate
			_ = json.Unmarshal(body["issue_date"], &from) // a bad date fails on issue_date
			body["valid_until"], _ = json.Marshal(addDays(from, defaultValidDays))
		}
		fromInvoice(&t, inv)
		if err := s.apply(ctx, q, sess.Workspace.ID, &t, body); err != nil {
			return err
		}
		if err := q.SaveQuote(ctx, sess.Workspace.ID, t, s.now()); err != nil {
			return err
		}
		return wrote(ctx, q, sess, t.ID)
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusCreated, t.ID)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	body, ok, err := s.decodeObject(w, r, inputKeys)
	if !ok {
		return err
	}
	ctx, id := r.Context(), r.PathValue("id")
	err = s.db.Tx(ctx, func(q store.Q) error {
		t, err := q.Quote(ctx, sess.Workspace.ID, id, today(sess.Workspace, s.now()), true)
		if err != nil {
			return err
		}
		if t.Status != "draft" {
			return errLocked
		}
		if err := s.apply(ctx, q, sess.Workspace.ID, &t, body); err != nil {
			return err
		}
		if err := q.SaveQuote(ctx, sess.Workspace.ID, t, s.now()); err != nil {
			return err
		}
		if err := wrote(ctx, q, sess, t.ID); err != nil {
			return err
		}
		return s.approvals.Reset(ctx, q, sess, approvalDoc(t))
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess, http.StatusOK, id)
}

func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		deleted, err := q.DeleteQuoteDraft(ctx, sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		if !deleted {
			if _, err := q.Quote(ctx, sess.Workspace.ID, id, "", false); err != nil {
				return err
			}
			return invalidState("A quote that was sent is kept: decline or revise it instead.")
		}
		return s.approvals.Forget(ctx, q, sess.Workspace.ID, id)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// pdf: a draft is rendered live and watermarked; a sent quote is the PDF of its last send.
func (s *Service) pdf(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	t, err := s.db.Quote(ctx, sess.Workspace.ID, r.PathValue("id"), today(sess.Workspace, s.now()), false)
	if err != nil {
		return err
	}
	var out []byte
	if t.Status == "draft" || t.PDFKey == nil {
		out, err = s.invoices.QuotePDF(ctx, s.db.Q, sess.Workspace.ID, asInvoice(t), true)
	} else {
		out, err = s.files.Get(ctx, *t.PDFKey)
	}
	if err != nil {
		return err
	}
	disposition := "inline"
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	WritePDF(w, disposition, t, out)
	return nil
}

// WritePDF answers with a quote's PDF bytes (also the portal's download).
func WritePDF(w http.ResponseWriter, disposition string, t store.Quote, pdf []byte) {
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", disposition+`; filename="`+FileName(t)+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = w.Write(pdf)
}

// FileName: e.g. "Offerte-Q-2026-001.pdf", "-r2" for a revision.
func FileName(t store.Quote) string {
	name := map[string]string{"de": "Offerte", "fr": "Offre", "it": "Offerta", "en": "Quote"}[t.Language]
	if t.Number != nil {
		name += "-" + *t.Number
	}
	if t.Revision > 1 {
		name += fmt.Sprintf("-r%d", t.Revision)
	}
	return name + ".pdf"
}

func addDays(d string, days int) string {
	t, err := time.Parse(time.DateOnly, d)
	if err != nil {
		return d
	}
	return t.AddDate(0, 0, days).Format(time.DateOnly)
}
