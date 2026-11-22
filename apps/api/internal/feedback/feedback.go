// Package feedback takes problem reports and feature ideas for the Helvetly team, with screenshots, and emails them
// to FEEDBACK_EMAIL (docs/feedback-contract.md).
package feedback

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

const (
	maxFiles     = 5
	maxFileBytes = 5 << 20
	perHour      = 5
)

type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
}
type Storage interface {
	Put(context.Context, string, io.Reader, int64, string, string) error
	Delete(context.Context, string) error
}
type Mailer interface {
	Send(context.Context, mail.Message) error
}

type Service struct {
	db     *store.Store
	auth   Auth
	files  Storage
	mailer Mailer // nil: reports are stored only
	to     string
	log    *slog.Logger
	now    func() time.Time
}

// New: mailer may be nil and to empty; then reports are stored without an email.
func New(db *store.Store, a Auth, files Storage, mailer Mailer, to string, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, mailer: mailer, to: to, log: log, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/feedback", s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
		id, err := s.create(w, r, sess)
		if err != nil {
			if status, _, _, _ := auth.Describe(err); status == http.StatusTooManyRequests {
				w.Header().Set("Retry-After", "3600")
			}
			s.auth.WriteError(w, r, err)
			return
		}
		auth.WriteJSON(w, http.StatusCreated, map[string]string{"id": id})
	}))
}

type screenshot struct {
	name, contentType, sum string
	data                   []byte
}

func invalid(message string) error { return auth.Error(400, "invalid_request", message, nil) }

func (s *Service) create(w http.ResponseWriter, r *http.Request, sess store.Session) (string, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxFiles*maxFileBytes+64<<10)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return "", auth.Error(413, "payload_too_large", "Attach at most five images of 5 MB each.", nil)
		}
		return "", invalid("Send the feedback as multipart form data.")
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	form := r.MultipartForm
	for k, v := range form.Value {
		if !slices.Contains([]string{"kind", "description", "page_path"}, k) || len(v) != 1 {
			return "", invalid("The feedback contains repeated or unknown fields.")
		}
	}
	for k := range form.File {
		if k != "screenshots[]" {
			return "", invalid("Send screenshots in screenshots[].")
		}
	}
	value := func(key string) string {
		if v := form.Value[key]; len(v) == 1 {
			return v[0]
		}
		return ""
	}
	kind, description := value("kind"), strings.TrimSpace(value("description"))
	if kind != "problem" && kind != "feature" {
		return "", invalid("Choose to report a problem or suggest a feature.")
	}
	if n := utf8.RuneCountInString(description); !utf8.ValidString(description) || n < 1 || n > 5000 || strings.ContainsRune(description, 0) {
		return "", invalid("Describe your feedback in 1 to 5000 characters.")
	}
	pagePath, err := cleanPath(value("page_path"))
	if err != nil {
		return "", err
	}
	shots, err := readScreenshots(form.File["screenshots[]"])
	if err != nil {
		return "", err
	}

	id := auth.NewID("fb")
	files := make([]store.FeedbackFile, 0, len(shots))
	for i, shot := range shots {
		key := sess.Workspace.ID + "/feedback/" + id + "/" + strconv.Itoa(i)
		if err := s.files.Put(r.Context(), key, bytes.NewReader(shot.data), int64(len(shot.data)), shot.contentType, shot.name); err != nil {
			s.cleanup(r.Context(), files)
			return "", fmt.Errorf("store feedback screenshot: %w", err)
		}
		files = append(files, store.FeedbackFile{Position: i, ObjectKey: key, Type: shot.contentType, Size: int64(len(shot.data)), SHA256: shot.sum})
	}
	now := s.now()
	err = s.db.Tx(r.Context(), func(q store.Q) error {
		if err := q.LockFeedbackReporter(r.Context(), sess.User.ID); err != nil {
			return err
		}
		n, err := q.CountFeedbackSince(r.Context(), sess.User.ID, now.Add(-time.Hour))
		if err != nil {
			return err
		}
		if n >= perHour {
			return auth.Error(429, "rate_limited", "You can send five reports per hour. Try again later.", nil)
		}
		return q.CreateFeedback(r.Context(), store.Feedback{ID: id, WorkspaceID: sess.Workspace.ID, UserID: sess.User.ID, Kind: kind,
			Description: description, PagePath: pagePath, CreatedAt: now}, files)
	})
	if err != nil {
		s.cleanup(r.Context(), files)
		return "", err
	}
	s.email(r.Context(), sess, id, kind, description, pagePath, shots)
	return id, nil
}

// cleanPath keeps only the path of the page, also when a client sends a full URL.
func cleanPath(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || !strings.HasPrefix(u.Path, "/") || strings.HasPrefix(u.Path, "//") || strings.IndexFunc(u.Path, unicode.IsControl) >= 0 {
		return "", invalid("Send the page path, starting with /.")
	}
	if p := u.EscapedPath(); len(p) <= 2048 {
		return p, nil
	}
	return "", invalid("The page path is too long.")
}

func readScreenshots(headers []*multipart.FileHeader) ([]screenshot, error) {
	if len(headers) > maxFiles {
		return nil, invalid("Attach at most five screenshots.")
	}
	shots := []screenshot{}
	sums := map[string]string{}
	for i, h := range headers {
		if h.Size <= 0 || h.Size > maxFileBytes {
			return nil, auth.Error(413, "payload_too_large", "Each screenshot must be an image of at most 5 MB.", nil)
		}
		f, err := h.Open()
		if err != nil {
			return nil, fmt.Errorf("open feedback screenshot: %w", err)
		}
		data, err := io.ReadAll(io.LimitReader(f, maxFileBytes+1))
		closeErr := f.Close()
		if err = errors.Join(err, closeErr); err != nil {
			return nil, fmt.Errorf("read feedback screenshot: %w", err)
		}
		ct := http.DetectContentType(data)
		if !slices.Contains([]string{"image/png", "image/jpeg", "image/webp"}, ct) {
			return nil, auth.Error(400, "unsupported_file", "Use PNG, JPEG or WebP screenshots.", nil)
		}
		sum, err := uploads.Hash(h)
		if err != nil {
			return nil, err
		}
		// The filename is the client's; only a safe label of it is kept, for the email.
		name := "screenshot-" + strconv.Itoa(i+1) + map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[ct]
		if err := uploads.CheckBatch(sums, sum, name); err != nil {
			return nil, err
		}
		shots = append(shots, screenshot{name: name, contentType: ct, sum: sum, data: data})
	}
	return shots, nil
}

func (s *Service) cleanup(ctx context.Context, files []store.FeedbackFile) {
	ctx, cancel := uploads.CleanupContext(ctx)
	defer cancel()
	for _, f := range files {
		if err := s.files.Delete(ctx, f.ObjectKey); err != nil {
			s.log.Error("clean up feedback screenshot", "key", f.ObjectKey, "err", err)
		}
	}
}

// email sends the stored report to the team. shortcut: one attempt, a failure is only logged; add a retry job when
// reports get lost.
func (s *Service) email(ctx context.Context, sess store.Session, id, kind, description, pagePath string, shots []screenshot) {
	if s.mailer == nil || s.to == "" {
		return
	}
	label := map[string]string{"problem": "Problem", "feature": "Feature idea"}[kind]
	from := sess.User.Name + " <" + sess.User.Email + ">"
	text := fmt.Sprintf("%s from %s\nWorkspace: %s (%s)\nPage: %s\nReport: %s\n\n%s\n", label, from, sess.Workspace.Name, sess.Workspace.ID, pagePath, id, description)
	m := mail.Message{To: []string{s.to}, ReplyTo: sess.User.Email, Subject: label + ": " + summary(description), Text: text,
		HTML: "<p>" + strings.ReplaceAll(html.EscapeString(text), "\n", "<br>\n") + "</p>"}
	for _, shot := range shots {
		m.Attachments = append(m.Attachments, mail.Attachment{Name: shot.name, ContentType: shot.contentType, Data: shot.data})
	}
	ctx = context.WithoutCancel(ctx)
	if err := s.mailer.Send(ctx, m); err != nil {
		s.log.Error("email feedback", "id", id, "err", err)
		return
	}
	if err := s.db.MarkFeedbackEmailed(ctx, id, s.now()); err != nil {
		s.log.Error("mark feedback emailed", "id", id, "err", err)
	}
}

// summary: the description's first line, short enough for a subject.
func summary(description string) string {
	line, _, _ := strings.Cut(description, "\n")
	if r := []rune(strings.TrimSpace(line)); len(r) > 80 {
		return string(r[:79]) + "…"
	}
	return strings.TrimSpace(line)
}
