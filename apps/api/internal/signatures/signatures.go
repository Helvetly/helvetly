// Package signatures sends PDFs from Documents out for simple electronic signatures and files the signed result
// back (docs/signatures-contract.md).
package signatures

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"mime"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/retention"
	"helvetly.com/api/internal/signpdf"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

// Storage keeps the frozen originals and the signed PDFs (internal/storage, a fake in tests).
type Storage interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	Get(ctx context.Context, key string) ([]byte, error)
	Open(ctx context.Context, key string) (io.ReadSeekCloser, error)
	Delete(ctx context.Context, key string) error
}

// Mailer sends the links and the signed PDF; nil means no mail server, and nothing can be sent for signature.
type Mailer interface {
	Send(context.Context, mail.Message) error
}

const (
	maxSigners     = 10
	maxFields      = 200
	defaultExpiry  = 30
	remindPerHour  = 5
	publicPerMin   = 60
	maxMessageLen  = emailtemplate.MaxMessage
	maxTitleLen    = 200
	maxReasonLen   = 500
	maxTextLen     = 200
	maxLabelLen    = 100
	minFieldSize   = 0.01
	fractionSlack  = 1e-6
	signatureLimit = 300 << 10
)

// ConsentText is what a signer agrees to with the checkbox; it is stored with every signature.
const ConsentText = "I agree to sign this document electronically. I understand that this is a simple electronic " +
	"signature (SES) that binds me like my handwritten signature where the law asks for no particular form, and that " +
	"a record of this signing (my name, email address, IP address, device and the times I viewed and signed) is " +
	"kept with the document."

// zone is the request's workspace time zone.
func zone(req store.SignatureRequest) *time.Location {
	return store.Workspace{Timezone: req.Timezone}.Location()
}

type Service struct {
	db        *store.Store
	auth      Auth
	files     Storage
	mail      Mailer
	publicURL string
	log       *slog.Logger
	now       func() time.Time
	limit     *auth.RateLimiter
	brands    func(ctx context.Context, workspaceID string) (mail.Brand, error) // the email preview and the signing page
}

// SetBrands lets the email preview and the signing page show the business as mail.Branded sends it.
func (s *Service) SetBrands(brands func(ctx context.Context, workspaceID string) (mail.Brand, error)) {
	s.brands = brands
}

func New(db *store.Store, a Auth, files Storage, mailer Mailer, publicURL string, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, mail: mailer, publicURL: publicURL, log: log,
		// Postgres keeps microseconds: the audit hash is computed over the time as it is stored.
		now:   func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) },
		limit: auth.NewRateLimiter(publicPerMin, time.Minute)}
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			s.answer(w, r, h(w, r, sess))
		}))
	}
	handle("GET /api/v1/signatures", s.list)
	handle("POST /api/v1/signatures", s.create)
	handle("POST /api/v1/signatures/email-preview", s.preview)
	handle("GET /api/v1/signatures/{id}", s.get)
	handle("GET /api/v1/signatures/{id}/original", s.original)
	handle("POST /api/v1/signatures/{id}/remind", s.remind)
	handle("POST /api/v1/signatures/{id}/revoke", s.revoke)

	public := func(pattern string, h func(http.ResponseWriter, *http.Request) error) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if !s.limit.Allow(r) {
				w.Header().Set("Retry-After", "60")
				s.auth.WriteError(w, r, auth.Error(http.StatusTooManyRequests, "rate_limited", "Too many requests: wait a minute and try again.", nil))
				return
			}
			s.answer(w, r, h(w, r))
		})
	}
	public("GET /api/v1/public/sign/{token}", s.publicView)
	public("GET /api/v1/public/sign/{token}/document", s.publicDocument)
	public("POST /api/v1/public/sign/{token}", s.publicSign)
	public("POST /api/v1/public/sign/{token}/decline", s.publicDecline)
}

func (s *Service) answer(w http.ResponseWriter, r *http.Request, err error) {
	if err == nil {
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		err = auth.ErrNotFound
	}
	s.auth.WriteError(w, r, err)
}

func data(v any) map[string]any { return map[string]any{"data": v} }

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.", map[string]any{"fields": fields})
}

var (
	errMailUnavailable = auth.Error(http.StatusServiceUnavailable, "mail_unavailable", "Email is not set up on this server.", nil)
	errNotPending      = auth.Error(http.StatusConflict, "not_pending", "This request is no longer out for signature.", nil)
	errNothingToRemind = auth.Error(http.StatusConflict, "nothing_to_remind", "Nobody is waiting for a reminder: the request is no longer out for signature or everyone has signed.", nil)
)

// ---- presenting ----

func signerStatus(s store.Signer) string {
	switch {
	case s.DeclinedAt != nil:
		return "declined"
	case s.SignedAt != nil:
		return "signed"
	case s.ViewedAt != nil:
		return "viewed"
	case s.SentAt != nil:
		return "sent"
	}
	return "waiting"
}

// present derives the statuses: a pending request past its expiry is expired, and each signer's from their times.
func present(r *store.SignatureRequest, now time.Time) {
	if r.Status == "pending" && !now.Before(r.ExpiresAt) {
		r.Status = "expired"
	}
	for i := range r.Signers {
		r.Signers[i].Status = signerStatus(r.Signers[i])
	}
}

// due: who may sign now. Everyone who hasn't yet in parallel; in sequential order the first who hasn't.
func due(r store.SignatureRequest) []store.Signer {
	var out []store.Signer
	for _, sg := range r.Signers {
		if sg.SignedAt != nil {
			continue
		}
		out = append(out, sg)
		if r.SigningOrder == "sequential" {
			break
		}
	}
	return out
}

func isDue(r store.SignatureRequest, signerID string) bool {
	for _, sg := range due(r) {
		if sg.ID == signerID {
			return true
		}
	}
	return false
}

func (s *Service) load(ctx context.Context, q store.Q, workspaceID, id string) (store.SignatureRequest, error) {
	r, err := q.SignatureRequest(ctx, workspaceID, id)
	if err != nil {
		return r, err
	}
	present(&r, s.now())
	return r, nil
}

func (s *Service) respond(w http.ResponseWriter, r *http.Request, workspaceID, id string, status int) error {
	req, err := s.load(r.Context(), s.db.Q, workspaceID, id)
	if err != nil {
		return err
	}
	if req.Events, err = s.db.SignatureEvents(r.Context(), id); err != nil {
		return err
	}
	auth.WriteJSON(w, status, data(req))
	return nil
}

// ---- signed-in routes ----

func (s *Service) list(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	status := r.URL.Query().Get("status")
	switch status {
	case "", "pending", "completed", "declined", "revoked", "expired":
	default:
		return validationFailed(map[string]string{"status": "Use pending, completed, declined, revoked or expired."})
	}
	now := s.now()
	list, err := s.db.SignatureRequests(r.Context(), sess.Workspace.ID, r.URL.Query().Get("document_id"), status, now)
	if err != nil {
		return err
	}
	for i := range list {
		present(&list[i], now)
	}
	auth.WriteJSON(w, http.StatusOK, data(list))
	return nil
}

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	return s.respond(w, r, sess.Workspace.ID, r.PathValue("id"), http.StatusOK)
}

func (s *Service) original(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	req, err := s.db.SignatureRequest(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	return s.servePDF(w, r, req)
}

func (s *Service) servePDF(w http.ResponseWriter, r *http.Request, req store.SignatureRequest) error {
	obj, err := s.files.Open(r.Context(), req.OriginalKey)
	if err != nil {
		return err
	}
	defer obj.Close()
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": fileName(req.Title) + ".pdf"}))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", req.CreatedAt, obj)
	return nil
}

// CreateBody is POST /signatures; internal/templates sends a filled template with it too.
type CreateBody struct {
	DocumentID    string        `json:"document_id"`
	Title         string        `json:"title"`
	Message       *string       `json:"message"`
	Language      *string       `json:"language"` // of the emails; none: the English email of before templates
	SigningOrder  string        `json:"signing_order"`
	ExpiresInDays *int          `json:"expires_in_days"`
	Signers       []SignerInput `json:"signers"`
	Fields        []FieldInput  `json:"fields"`
}

type SignerInput struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type FieldInput struct {
	Signer int     `json:"signer"`
	Page   int     `json:"page"`
	Kind   string  `json:"kind"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	W      float64 `json:"w"`
	H      float64 `json:"h"`
	Label  *string `json:"label"`
}

// PlainText: v trimmed, or why it can't be used (empty, too long, control characters but \n).
func PlainText(v string, max int) (string, string) {
	v = strings.TrimSpace(v)
	switch {
	case v == "":
		return "", "Enter it."
	case utf8.RuneCountInString(v) > max:
		return "", fmt.Sprintf("Use at most %d characters.", max)
	case strings.ContainsFunc(v, func(r rune) bool { return unicode.IsControl(r) && r != '\n' }):
		return "", "Remove the control characters."
	}
	return v, ""
}

// FieldBox: the reason a box can't be used, or "".
func FieldBox(page, pages int, x, y, w, h float64) string {
	for _, v := range []float64{x, y, w, h} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return "Use numbers."
		}
	}
	switch {
	case page < 1 || page > pages:
		return fmt.Sprintf("The document has %d pages.", pages)
	case x < 0 || y < 0 || w < minFieldSize || h < minFieldSize || x+w > 1+fractionSlack || y+h > 1+fractionSlack:
		return "Keep the field on the page."
	}
	return ""
}

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body CreateBody
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	id, err := s.Create(r, sess, body)
	if err != nil {
		return err
	}
	return s.respond(w, r, sess.Workspace.ID, id, http.StatusCreated)
}

// CheckSending: the problems with a request's title, message, order, expiry and signers (not its document and
// fields), keyed as in POST /signatures.
func CheckSending(body CreateBody) map[string]string {
	_, bad := prepare(body, "", time.Time{})
	return bad
}

func prepare(body CreateBody, workspaceID string, now time.Time) (store.SignatureRequest, map[string]string) {
	bad := map[string]string{}
	title, msg := PlainText(body.Title, maxTitleLen)
	if msg != "" {
		bad["title"] = msg
	}
	var message *string
	if body.Message != nil && strings.TrimSpace(*body.Message) != "" {
		v, msg := PlainText(*body.Message, maxMessageLen)
		if msg != "" {
			bad["message"] = msg
		}
		message = &v
	}
	if body.Language != nil && !slices.Contains(emailtemplate.Languages, *body.Language) {
		bad["language"] = "Use de, fr, it or en."
	}
	if body.SigningOrder != "parallel" && body.SigningOrder != "sequential" {
		bad["signing_order"] = "Use parallel or sequential."
	}
	days := defaultExpiry
	if body.ExpiresInDays != nil {
		days = *body.ExpiresInDays
		if days < 1 || days > 365 {
			bad["expires_in_days"] = "Use 1 to 365 days."
		}
	}
	if len(body.Signers) == 0 || len(body.Signers) > maxSigners {
		bad["signers"] = fmt.Sprintf("Add 1 to %d signers.", maxSigners)
	}
	req := store.SignatureRequest{ID: auth.NewID("sig"), WorkspaceID: workspaceID, Title: title, Message: message,
		Language: body.Language, SigningOrder: body.SigningOrder, ExpiresAt: now.AddDate(0, 0, days), CreatedAt: now}
	seen := map[string]bool{}
	for i, in := range body.Signers {
		key := fmt.Sprintf("signers.%d", i)
		name, msg := PlainText(in.Name, maxTitleLen)
		if msg != "" {
			bad[key+".name"] = msg
		}
		email, msg := clients.NormaliseEmail(strings.TrimSpace(in.Email))
		if msg != "" {
			bad[key+".email"] = "Enter an email address such as ana@example.com."
		} else if seen[email] {
			bad[key+".email"] = "This person is already a signer."
		}
		seen[email] = true
		req.Signers = append(req.Signers, store.Signer{ID: auth.NewID("sgr"), Position: i + 1, Name: name, Email: email})
	}
	return req, bad
}

// Create validates and sends out a request as POST /signatures does and returns its id; r is the sender's evidence.
func (s *Service) Create(r *http.Request, sess store.Session, body CreateBody) (string, error) {
	ctx := r.Context()
	now := s.now()
	req, bad := prepare(body, sess.Workspace.ID, now)
	title := req.Title

	// The document: a live PDF this request can stamp at the end, frozen now.
	var original []byte
	doc, err := s.db.Document(ctx, sess.Workspace.ID, body.DocumentID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		bad["document_id"] = "Choose a PDF from Documents."
	case err != nil:
		return "", err
	case doc.DeletedAt != nil || doc.ContentType != "application/pdf":
		bad["document_id"] = "Choose a PDF that isn't in the Trash."
	default:
		if original, err = s.files.Get(ctx, doc.ObjectKey); err != nil {
			return "", err
		}
		if req.PageCount, err = signpdf.PageCount(original); err != nil || req.PageCount == 0 {
			bad["document_id"] = "This PDF can't be signed: it is protected or damaged. Save it again as a PDF and upload that."
		}
	}

	if len(body.Fields) == 0 || len(body.Fields) > maxFields {
		bad["fields"] = fmt.Sprintf("Place 1 to %d fields.", maxFields)
	}
	signs := map[int]bool{}
	for i, in := range body.Fields {
		key := fmt.Sprintf("fields.%d", i)
		if in.Signer < 0 || in.Signer >= len(req.Signers) {
			bad[key] = "Choose a signer for this field."
			continue
		}
		switch in.Kind {
		case "signature", "date", "name", "text":
		default:
			bad[key] = "Use signature, date, name or text."
			continue
		}
		if req.PageCount > 0 {
			if msg := FieldBox(in.Page, req.PageCount, in.X, in.Y, in.W, in.H); msg != "" {
				bad[key] = msg
				continue
			}
		}
		var label *string
		if in.Label != nil && strings.TrimSpace(*in.Label) != "" {
			v, msg := PlainText(*in.Label, maxLabelLen)
			if msg != "" {
				bad[key+".label"] = msg
			}
			label = &v
		}
		signs[in.Signer] = signs[in.Signer] || in.Kind == "signature"
		req.Fields = append(req.Fields, store.SignatureField{ID: auth.NewID("sfd"), SignerID: req.Signers[in.Signer].ID, Page: in.Page,
			Kind: in.Kind, X: in.X, Y: in.Y, W: in.W, H: in.H, Label: label})
	}
	for i, sg := range req.Signers {
		if !signs[i] && bad[fmt.Sprintf("signers.%d.name", i)] == "" {
			bad[fmt.Sprintf("signers.%d", i)] = "Place a signature field for " + sg.Name + "."
		}
	}
	if len(bad) > 0 {
		return "", validationFailed(bad)
	}
	if s.mail == nil {
		return "", errMailUnavailable
	}

	sum := sha256.Sum256(original)
	req.OriginalSHA256 = hex.EncodeToString(sum[:])
	req.OriginalKey = "workspaces/" + sess.Workspace.ID + "/signatures/" + req.ID + "/original.pdf"
	req.Document = &store.FolderRef{ID: doc.ID, Name: doc.Name}
	req.FolderID = doc.FolderID
	err = s.db.Tx(ctx, func(q store.Q) error { // room for the original and the signed result it becomes
		if err := q.Admit(ctx, sess.Workspace.ID, "storage_bytes", 2*int64(len(original))); err != nil {
			return err
		}
		return q.ReserveObject(ctx, sess.Workspace.ID, req.OriginalKey, int64(len(original)), false, s.now())
	})
	if err != nil {
		return "", err
	}
	if err := s.files.Put(ctx, req.OriginalKey, bytes.NewReader(original), int64(len(original)), "application/pdf", doc.Name); err != nil {
		return "", err
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.CreateSignatureRequest(ctx, req, sess.User.ID); err != nil {
			return err
		}
		if err := retention.Request(ctx, q, s.files, sess.Workspace.ID, req.OriginalKey, sess.Workspace.Today(s.now()), s.now()); err != nil {
			return err
		}
		return s.event(ctx, q, req.ID, "created", nil, r, map[string]string{"document_id": doc.ID, "original_sha256": req.OriginalSHA256,
			"title": title})
	})
	if err != nil {
		s.removeObject(ctx, req.OriginalKey)
		return "", err
	}
	s.retain(ctx, req.OriginalKey)
	created, err := s.load(ctx, s.db.Q, sess.Workspace.ID, req.ID)
	if err != nil {
		return "", err
	}
	// A signer whose email fails stays "waiting" without a link; a reminder sends it again.
	_ = s.invite(ctx, created, due(created), "sent")
	return req.ID, nil
}

func (s *Service) remind(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("id")
	var req store.SignatureRequest
	var waiting []store.Signer
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockSignatureRequest(ctx, id); err != nil {
			return err
		}
		var err error
		if req, err = s.load(ctx, q, sess.Workspace.ID, id); err != nil {
			return err
		}
		for _, sg := range due(req) {
			if sg.DeclinedAt == nil {
				waiting = append(waiting, sg)
			}
		}
		if req.Status != "pending" || len(waiting) == 0 {
			return errNothingToRemind
		}
		n, err := q.CountSignatureEvents(ctx, id, "reminded", s.now().Add(-time.Hour))
		if err != nil {
			return err
		}
		if n >= remindPerHour {
			return auth.Error(http.StatusTooManyRequests, "rate_limited", "Reminders were just sent. Try again in an hour.", nil)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if s.mail == nil {
		return errMailUnavailable
	}
	if err := s.invite(ctx, req, waiting, "reminded"); err != nil {
		return auth.Error(http.StatusServiceUnavailable, "mail_failed", "The reminder could not be sent. Try again in a minute.", nil)
	}
	return s.respond(w, r, sess.Workspace.ID, id, http.StatusOK)
}

func (s *Service) revoke(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockSignatureRequest(ctx, id); err != nil {
			return err
		}
		req, err := s.load(ctx, q, sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		if req.Status != "pending" {
			return errNotPending
		}
		if err := q.SetSignatureStatus(ctx, id, "revoked", s.now()); err != nil {
			return err
		}
		return s.event(ctx, q, id, "revoked", nil, r, map[string]string{"by": sess.User.ID})
	})
	if err != nil {
		return err
	}
	return s.respond(w, r, sess.Workspace.ID, id, http.StatusOK)
}

// ---- links and email ----

// signLink: the signing page with the token in the fragment, which browsers never send to a server.
func (s *Service) signLink(token string) string { return s.publicURL + "/sign#" + token }

// invite emails each signer a fresh link, then records it (the previous link stops working). A failed email changes
// nothing for that signer; the first failure is returned once all were tried.
func (s *Service) invite(ctx context.Context, req store.SignatureRequest, signers []store.Signer, eventType string) error {
	reminder := eventType == "reminded"
	text := emailText(req, reminder)
	var first error
	for _, sg := range signers {
		token := rand.Text()
		if err := s.mail.Send(ctx, inviteMessage(req, sg, s.signLink(token), reminder, text)); err != nil {
			s.log.ErrorContext(ctx, "send signing link", "request", req.ID, "signer", sg.ID, "error", err)
			if first == nil {
				first = err
			}
			continue
		}
		err := s.db.Tx(ctx, func(q store.Q) error {
			if err := q.LockSignatureRequest(ctx, req.ID); err != nil {
				return err
			}
			now := s.now()
			if err := q.SetSignerToken(ctx, sg.ID, hashToken(token), &now); err != nil {
				return err
			}
			return s.event(ctx, q, req.ID, eventType, &sg.ID, nil, map[string]string{"email": sg.Email})
		})
		if err != nil && first == nil {
			first = err
		}
	}
	return first
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Service) removeObject(ctx context.Context, key string) {
	if err := s.files.Delete(context.WithoutCancel(ctx), key); err != nil {
		s.log.ErrorContext(ctx, "remove object", "key", key, "error", err)
	}
}

// retain locks a committed record's object (S3 Object Lock); its pending row, written with the record, makes the
// retention job retry a failure.
func (s *Service) retain(ctx context.Context, keys ...string) {
	retention.Settle(ctx, s.db, s.files, s.log, keys...)
}

// fileName: a title as a file name ("/" and "\" are not allowed there).
func fileName(title string) string {
	return strings.NewReplacer("/", "-", `\`, "-").Replace(title)
}
