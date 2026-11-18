package heidi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type testAuth struct {
	session *store.Session
	api     *auth.Service
}

func (a testAuth) SignedIn(fn func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.session == nil {
			a.WriteError(w, r, auth.Error(401, "unauthenticated", "Sign in.", nil))
			return
		}
		if r.Method != http.MethodGet && r.Header.Get("X-CSRF-Token") != a.session.CSRFToken {
			a.WriteError(w, r, auth.Error(403, "csrf_failed", "CSRF token required.", nil))
			return
		}
		fn(w, r, *a.session)
	}
}
func (a testAuth) WriteError(w http.ResponseWriter, r *http.Request, err error) {
	a.api.WriteError(w, r, err)
}
func (a testAuth) Decode(w http.ResponseWriter, r *http.Request, out any) bool {
	if err := json.NewDecoder(r.Body).Decode(out); err != nil {
		a.WriteError(w, r, auth.Error(400, "invalid_request", "Invalid JSON.", nil))
		return false
	}
	return true
}

type fakeStorage struct {
	mu             sync.Mutex
	objects        map[string][]byte
	puts, deletes  int
	fail           bool
	afterPut       func()
	deleteCanceled bool
}
type reader struct{ *bytes.Reader }

func (reader) Close() error { return nil }
func (s *fakeStorage) Put(_ context.Context, key string, r io.Reader, _ int64, _, _ string) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.puts++
	s.objects[key] = b
	s.mu.Unlock()
	if s.afterPut != nil {
		s.afterPut()
	}
	return nil
}
func (s *fakeStorage) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return reader{bytes.NewReader(s.objects[key])}, nil
}
func (s *fakeStorage) Delete(ctx context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deletes++
	s.deleteCanceled = ctx.Err() != nil
	delete(s.objects, key)
	return nil
}

func fixture(t *testing.T) (*Service, *http.ServeMux, *store.Session, *fakeStorage) {
	t.Helper()
	s, mux, sess, files, _ := fixtureRaw(t)
	return s, mux, sess, files
}

// fixtureRaw is fixture with the database's pool, to write what the API never does.
func fixtureRaw(t *testing.T) (*Service, *http.ServeMux, *store.Session, *fakeStorage, *pgxpool.Pool) {
	t.Helper()
	db, raw := storetest.New(t)
	now := time.Now().UTC()
	sess := &store.Session{ID: "ses_heidi", CSRFToken: "csrf", User: store.User{ID: "usr_heidi", Email: "heidi@example.test", Name: "Heidi"}, Workspace: store.Workspace{ID: "ws_heidi", Name: "Workspace", Timezone: "Europe/Zurich"}, Role: "owner"}
	for _, err := range []error{db.CreateUser(context.Background(), sess.User, now), db.CreateWorkspace(context.Background(), sess.Workspace, sess.Workspace.Timezone, now), db.AddMember(context.Background(), sess.Workspace.ID, sess.User.ID, "owner", now)} {
		if err != nil {
			t.Fatal(err)
		}
	}
	files := &fakeStorage{objects: map[string][]byte{}}
	api, err := auth.New(config.Config{PublicURL: "http://localhost:8000", DevSignIn: true}, db, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	s := New(db, testAuth{sess, api}, files, nil, Options{})
	mux := http.NewServeMux()
	s.Register(mux)
	return s, mux, sess, files, raw
}

func call(mux http.Handler, method, target, body, contentType string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	r.Header.Set("X-CSRF-Token", "csrf")
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}
func chat(t *testing.T, mux http.Handler, conversation, message string, files ...string) *httptest.ResponseRecorder {
	t.Helper()
	var b bytes.Buffer
	form := multipart.NewWriter(&b)
	_ = form.WriteField("conversation_id", conversation)
	_ = form.WriteField("message", message)
	for i, content := range files {
		f, err := form.CreateFormFile("files[]", string(rune('a'+i))+".pdf")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(f, content); err != nil {
			t.Fatal(err)
		}
	}
	if err := form.Close(); err != nil {
		t.Fatal(err)
	}
	return call(mux, "POST", "/api/v1/heidi/chat", b.String(), form.FormDataContentType())
}

func TestReadEndpointsAndTranscriptIsolation(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	for _, path := range []string{"/usage", "/suggestions?page=invoices"} {
		w := call(mux, "GET", "/api/v1/heidi"+path, "", "")
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body)
		}
	}
	w := chat(t, mux, "thread", "Which invoices are overdue?")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"type":"done"`) {
		t.Fatalf("chat: %d %s", w.Code, w.Body)
	}
	w = call(mux, "GET", "/api/v1/heidi/conversations/thread", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Which invoices are overdue?") {
		t.Fatalf("transcript: %d %s", w.Code, w.Body)
	}
	var transcript struct{ Data []Message }
	if err := json.Unmarshal(w.Body.Bytes(), &transcript); err != nil || len(transcript.Data) != 2 {
		t.Fatalf("transcript body: %v %s", err, w.Body)
	}
	for _, m := range transcript.Data {
		if m.CreatedAt.IsZero() || time.Since(m.CreatedAt) > time.Minute {
			t.Fatalf("created_at of %s: %v", m.Role, m.CreatedAt)
		}
	}
	sess.User.ID = "another_user"
	w = call(mux, "GET", "/api/v1/heidi/conversations/thread", "", "")
	if w.Code != 404 {
		t.Fatalf("foreign transcript: %d %s", w.Code, w.Body)
	}
	sess.User.ID = "usr_heidi"
	sess.Role = "member"
	sess.Scopes = []string{"read:clients"}
	w = chat(t, mux, "forbidden", "Which invoices are overdue?")
	if w.Code != 403 {
		t.Fatalf("scope: %d %s", w.Code, w.Body)
	}
	_ = s
}

func TestConversationListIsNewestFirstAndPrivate(t *testing.T) {
	s, mux, sess, _ := fixture(t)
	start := time.Now().UTC()
	s.now = func() time.Time { return start }
	chat(t, mux, "older", "Which invoices are overdue?")
	chat(t, mux, "older", "And the clients?")
	s.now = func() time.Time { return start.Add(time.Minute) }
	chat(t, mux, "newer", "Show my expenses")
	w := call(mux, "GET", "/api/v1/heidi/conversations", "", "")
	var body struct {
		Data []struct {
			ID, Title, Snippet string
			Messages           int
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	if len(body.Data) != 2 || body.Data[0].ID != "newer" || body.Data[1].Title != "Which invoices are overdue?" {
		t.Fatalf("list: %+v", body.Data)
	}
	// Two turns of a question and an answer each; the snippet is the latest answer.
	if older := body.Data[1]; older.Messages != 4 || older.Snippet == "" {
		t.Fatalf("older counts and snippet: %+v", older)
	}
	sess.User.ID = "another_user"
	w = call(mux, "GET", "/api/v1/heidi/conversations", "", "")
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"data":[]}` {
		t.Fatalf("foreign list: %d %s", w.Code, w.Body)
	}
}

func TestUploadedBytesAreDeduplicatedAndBatchAtomic(t *testing.T) {
	s, mux, _, files := fixture(t)
	pdf := "%PDF-1.7\nreceipt content"
	w := chat(t, mux, "batch", "Analyze these files", pdf, pdf)
	if w.Code != 409 || files.puts != 0 {
		t.Fatalf("batch: %d puts=%d %s", w.Code, files.puts, w.Body)
	}
	w = chat(t, mux, "first", "Keep this attachment", pdf)
	if w.Code != 200 || files.puts != 1 {
		t.Fatalf("upload: %d puts=%d %s", w.Code, files.puts, w.Body)
	}
	w = chat(t, mux, "retry", "Keep this attachment", pdf)
	if w.Code != 200 || files.puts != 1 || len(files.objects) != 1 { // the same bytes are the existing Document: nothing stored
		t.Fatalf("retry: %d objects=%d puts=%d %s", w.Code, len(files.objects), files.puts, w.Body)
	}
	list, total, err := s.db.ListDocuments(context.Background(), "ws_heidi", store.DocumentFilter{Sort: "name"}, 50, 0)
	if err != nil || total != 1 || list[0].SHA256 == nil {
		t.Fatalf("canonical documents: %+v total=%d err=%v", list, total, err)
	}
}

func TestInvalidAttachmentsAndCSRF(t *testing.T) {
	_, mux, sess, files := fixture(t)
	w := chat(t, mux, "bad", "Analyze", "<html>not a PDF</html>")
	if w.Code != 400 || files.puts != 0 {
		t.Fatalf("type: %d puts=%d", w.Code, files.puts)
	}
	w = chat(t, mux, "bad/id", "hello")
	if w.Code != 400 {
		t.Fatalf("id: %d", w.Code)
	}
	sess.CSRFToken = "other"
	w = chat(t, mux, "csrf", "hello")
	if w.Code != 403 {
		t.Fatalf("csrf: %d", w.Code)
	}
}
