// Package templates keeps PDFs from Documents with client-data boxes and signing fields, and fills one for a client:
// filed in Documents, then kept, emailed or sent for signature (docs/templates-contract.md).
package templates

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/signatures"
	"helvetly.com/api/internal/signpdf"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Storage reads the template's PDF and keeps the filled copies (internal/storage, a fake in tests).
type Storage interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
}

// Mailer sends a filled document; nil means no mail server.
type Mailer interface {
	Send(context.Context, mail.Message) error
}

// Signatures sends a filled document out for signature, exactly as POST /signatures (internal/signatures).
type Signatures interface {
	Create(r *http.Request, sess store.Session, body signatures.CreateBody) (string, error)
}

const (
	maxNameLen        = 200
	minFontSize       = 8
	maxFontSize       = 24
	maxDescriptionLen = 500
	maxLabelLen       = 100
	maxValueLen       = 500
	maxMessageLen     = emailtemplate.MaxMessage
	maxSigners        = 10
	maxFields         = 200
)

// dataKinds are stamped in when a document is made; the others are signing fields.
var dataKinds = []string{"client.name", "client.address", "client.email", "client.phone", "client.number",
	"client.vat_number", "contact.name", "today", "custom"}

var signingKinds = []string{"signature", "date", "name", "text"}

func isData(kind string) bool { return slices.Contains(dataKinds, kind) }

type Service struct {
	db    *store.Store
	auth  Auth
	files Storage
	mail  Mailer
	sign  Signatures
	log   *slog.Logger
	now   func() time.Time
	// model and budget fill contract drafts (SetAI); limit spaces a person's drafts that ask the model.
	model  aimodel.Provider
	budget aimodel.Budget
	limit  *auth.RateLimiter
	// contractNumber formats a contract's number in the workspace's format (SetContractNumbers).
	contractNumber func(ctx context.Context, q store.Q, workspaceID, date string, seq int64) (string, error)
	// logo: the workspace's logo for written contracts (SetLogo).
	logo func(ctx context.Context, workspaceID string) ([]byte, error)
	// for the email preview: the business's header and footer, as mail.Branded sends them
	brands    func(ctx context.Context, workspaceID string) (mail.Brand, error)
	publicURL string
}

// SetBrands lets the email preview show the business's header and footer, as mail.Branded sends them.
func (s *Service) SetBrands(brands func(ctx context.Context, workspaceID string) (mail.Brand, error), publicURL string) {
	s.brands, s.publicURL = brands, publicURL
}

func New(db *store.Store, a Auth, files Storage, mailer Mailer, sign Signatures, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, mail: mailer, sign: sign, log: log, limit: auth.NewRateLimiter(20, time.Minute),
		now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) },
		contractNumber: func(_ context.Context, _ store.Q, _, date string, seq int64) (string, error) {
			return fmt.Sprintf("C-%s-%03d", date[:4], seq), nil
		}}
}

// SetContractNumbers numbers contracts in the workspace's number format (invoices.Service.ContractNumber); without
// it they are C-<year>-<seq>.
func (s *Service) SetContractNumbers(f func(ctx context.Context, q store.Q, workspaceID, date string, seq int64) (string, error)) {
	s.contractNumber = f
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
	handle("GET /api/v1/templates", s.list)
	handle("POST /api/v1/templates", s.create)
	handle("POST /api/v1/templates/email-preview", s.preview)
	handle("GET /api/v1/templates/{id}", s.get)
	handle("PUT /api/v1/templates/{id}", s.update)
	handle("DELETE /api/v1/templates/{id}", s.remove)
	handle("POST /api/v1/templates/{id}/documents", s.generate)
	handle("POST /api/v1/quotes/{id}/contract-draft", s.contractDraft)
	handle("POST /api/v1/quotes/{id}/contract-drafts", s.contractWrite)
	handle("POST /api/v1/quotes/{id}/contract-preview", s.contractPreview)
	handle("POST /api/v1/quotes/{id}/contracts", s.contractCreate)
	handle("GET /api/v1/quotes/{id}/contracts", s.quoteContracts)
	handle("GET /api/v1/quotes/contract-counts", s.quoteContractCounts)
	handle("GET /api/v1/quotes/{id}/contract-law", s.contractLaw)
	handle("GET /api/v1/account/contract-signature", s.getSignature)
	handle("PUT /api/v1/account/contract-signature", s.putSignaturePlace)
	handle("GET /api/v1/account/contract-signature/image", s.signatureImage)
	handle("PUT /api/v1/account/contract-signature/image", s.putSignatureImage)
	handle("DELETE /api/v1/account/contract-signature/image", s.deleteSignatureImage)
}

func data(v any) map[string]any { return map[string]any{"data": v} }

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.", map[string]any{"fields": fields})
}

var errMailUnavailable = auth.Error(http.StatusServiceUnavailable, "mail_unavailable", "Email is not set up on this server.", nil)

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	list, err := s.db.Templates(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respond(w, r, sess, r.PathValue("id"), http.StatusOK)
}

func (s *Service) respond(w http.ResponseWriter, r *http.Request, sess store.Session, id string, status int) error {
	t, err := s.db.Template(r.Context(), sess.Workspace.ID, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, status, data(t))
	return nil
}

// ---- saving ----

type input struct {
	Name        string                 `json:"name"`
	Description *string                `json:"description"`
	DocumentID  string                 `json:"document_id"`
	Signers     []store.TemplateSigner `json:"signers"`
	Fields      []store.TemplateField  `json:"fields"` // an id sent is ignored: every save gives new ones
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in input
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	t, err := s.check(r.Context(), sess, in)
	if err != nil {
		return err
	}
	t.ID, t.CreatedAt = auth.NewID("tpl"), s.now()
	if err := s.db.CreateTemplate(r.Context(), sess.Workspace.ID, in.DocumentID, t); err != nil {
		return err
	}
	return s.respond(w, r, sess, t.ID, http.StatusCreated)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	id := r.PathValue("id")
	if _, err := s.db.Template(r.Context(), sess.Workspace.ID, id); err != nil {
		return err
	}
	var in input
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	t, err := s.check(r.Context(), sess, in)
	if err != nil {
		return err
	}
	t.ID, t.UpdatedAt = id, s.now()
	if err := s.db.UpdateTemplate(r.Context(), sess.Workspace.ID, in.DocumentID, t); err != nil {
		return err
	}
	return s.respond(w, r, sess, id, http.StatusOK)
}

func (s *Service) remove(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.db.DeleteTemplate(r.Context(), sess.Workspace.ID, r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// pdf: a live PDF of the workspace that can be filled, its bytes and pages; or why not, for details.fields.document_id.
func (s *Service) pdf(ctx context.Context, workspaceID, id string) ([]byte, int, string, error) {
	doc, err := s.db.Document(ctx, workspaceID, id)
	switch {
	case errors.Is(err, store.ErrNotFound):
		return nil, 0, "Choose a PDF from Documents.", nil
	case err != nil:
		return nil, 0, "", err
	case doc.DeletedAt != nil || doc.ContentType != "application/pdf":
		return nil, 0, "Choose a PDF that isn't in the Trash.", nil
	}
	original, err := s.files.Get(ctx, doc.ObjectKey)
	if err != nil {
		return nil, 0, "", err
	}
	pages, err := signpdf.PageCount(original)
	if err != nil || pages == 0 {
		return nil, 0, "This PDF can't be filled: it is protected or damaged. Save it again as a PDF and upload that.", nil
	}
	return original, pages, "", nil
}

// check validates a template as saved (its id and times are the caller's).
func (s *Service) check(ctx context.Context, sess store.Session, in input) (store.Template, error) {
	bad := map[string]string{}
	t := store.Template{Signers: []store.TemplateSigner{}, Fields: []store.TemplateField{}}
	var msg string
	if t.Name, msg = signatures.PlainText(in.Name, maxNameLen); msg != "" {
		bad["name"] = msg
	}
	if in.Description != nil && strings.TrimSpace(*in.Description) != "" {
		v, msg := signatures.PlainText(*in.Description, maxDescriptionLen)
		if msg != "" {
			bad["description"] = msg
		}
		t.Description = &v
	}
	_, pages, msg, err := s.pdf(ctx, sess.Workspace.ID, in.DocumentID)
	if err != nil {
		return t, err
	}
	if msg != "" {
		bad["document_id"] = msg
	}

	if len(in.Signers) > maxSigners {
		bad["signers"] = fmt.Sprintf("Add at most %d signers.", maxSigners)
	}
	for i, role := range in.Signers {
		key := fmt.Sprintf("signers.%d", i)
		label, msg := signatures.PlainText(role.Label, maxLabelLen)
		if msg != "" {
			bad[key+".label"] = msg
		}
		if role.Fill != "client" && role.Fill != "manual" {
			bad[key+".fill"] = "Use client or manual."
		}
		t.Signers = append(t.Signers, store.TemplateSigner{Label: label, Fill: role.Fill})
	}

	if len(in.Fields) == 0 || len(in.Fields) > maxFields {
		bad["fields"] = fmt.Sprintf("Place 1 to %d fields.", maxFields)
	}
	signs := map[int]bool{}
	for i, f := range in.Fields {
		key := fmt.Sprintf("fields.%d", i)
		switch {
		case isData(f.Kind):
			if f.Signer != nil {
				bad[key] = "Client data belongs to no signer."
				continue
			}
		case slices.Contains(signingKinds, f.Kind):
			if f.Signer == nil || *f.Signer < 0 || *f.Signer >= len(in.Signers) {
				bad[key] = "Choose a signer for this field."
				continue
			}
			signs[*f.Signer] = signs[*f.Signer] || f.Kind == "signature"
		default:
			bad[key] = "Use a client data kind, signature, date, name or text."
			continue
		}
		if pages > 0 {
			if msg := signatures.FieldBox(f.Page, pages, f.X, f.Y, f.W, f.H); msg != "" {
				bad[key] = msg
				continue
			}
		}
		field := store.TemplateField{ID: auth.NewID("tfd"), Kind: f.Kind, Signer: f.Signer, Page: f.Page, X: f.X, Y: f.Y, W: f.W, H: f.H}
		if isData(f.Kind) {
			if f.FontSize != nil && (*f.FontSize < minFontSize || *f.FontSize > maxFontSize) {
				bad[key+".font_size"] = fmt.Sprintf("Use %d to %d pt.", minFontSize, maxFontSize)
			}
			if !slices.Contains([]string{"", "left", "center", "right"}, f.Align) {
				bad[key+".align"] = "Use left, center or right."
			}
			field.FontSize, field.AutoFit, field.Align = f.FontSize, f.AutoFit, f.Align
		}
		if f.Kind == "text" || f.Kind == "custom" {
			label, msg := signatures.PlainText(deref(f.Label), maxLabelLen)
			if msg != "" {
				bad[key+".label"] = msg
			}
			field.Label = &label
		}
		t.Fields = append(t.Fields, field)
	}
	for i, role := range t.Signers {
		if !signs[i] && bad[fmt.Sprintf("signers.%d.label", i)] == "" {
			bad[fmt.Sprintf("signers.%d", i)] = "Place a signature field for " + role.Label + "."
		}
	}
	if len(bad) > 0 {
		return t, validationFailed(bad)
	}
	return t, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
