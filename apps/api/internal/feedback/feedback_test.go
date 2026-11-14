package feedback

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
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
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type testAuth struct {
	session store.Session
	api     *auth.Service
}

func (a testAuth) SignedIn(fn func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { fn(w, r, a.session) }
}
func (a testAuth) WriteError(w http.ResponseWriter, r *http.Request, err error) {
	a.api.WriteError(w, r, err)
}

type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
	fail    bool
}

func (s *fakeStorage) Put(_ context.Context, key string, r io.Reader, _ int64, _, _ string) error {
	if s.fail {
		return errors.New("storage down")
	}
	b, err := io.ReadAll(r)
	s.mu.Lock()
	s.objects[key] = b
	s.mu.Unlock()
	return err
}
func (s *fakeStorage) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	delete(s.objects, key)
	s.mu.Unlock()
	return nil
}

type fakeMailer struct {
	mu   sync.Mutex
	sent []mail.Message
	fail bool
}

func (m *fakeMailer) Send(_ context.Context, msg mail.Message) error {
	if m.fail {
		return errors.New("smtp down")
	}
	m.mu.Lock()
	m.sent = append(m.sent, msg)
	m.mu.Unlock()
	return nil
}

type fixture struct {
	mux    *http.ServeMux
	db     *store.Store
	pool   *pgxpool.Pool
	files  *fakeStorage
	mailer *fakeMailer
}

func setup(t *testing.T) fixture {
	t.Helper()
	db, pool := storetest.New(t)
	now := time.Now().UTC()
	sess := store.Session{User: store.User{ID: "usr_fb", Email: "ana@example.test", Name: "Ana"}, Workspace: store.Workspace{ID: "ws_fb", Name: "Acme", Timezone: "Europe/Zurich"}, Role: "member"}
	for _, err := range []error{db.CreateUser(context.Background(), sess.User, now), db.CreateWorkspace(context.Background(), sess.Workspace, sess.Workspace.Timezone, now)} {
		if err != nil {
			t.Fatal(err)
		}
	}
	api, err := auth.New(config.Config{PublicURL: "http://localhost:8000", DevSignIn: true}, db, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	f := fixture{mux: http.NewServeMux(), db: db, pool: pool, files: &fakeStorage{objects: map[string][]byte{}}, mailer: &fakeMailer{}}
	New(db, testAuth{sess, api}, f.files, f.mailer, "team@helvetly.test", slog.Default()).Register(f.mux)
	return f
}

func pngBytes(t *testing.T, shade uint8) []byte {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.Gray{Y: shade})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func post(f fixture, fields map[string]string, files ...[]byte) *httptest.ResponseRecorder {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	for i, data := range files {
		part, _ := w.CreateFormFile("screenshots[]", "shot"+string(rune('a'+i))+".png")
		_, _ = part.Write(data)
	}
	_ = w.Close()
	r := httptest.NewRequest(http.MethodPost, "/api/v1/feedback", &body)
	r.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, r)
	return rec
}

func valid() map[string]string {
	return map[string]string{"kind": "problem", "description": "  The invoice PDF is blank\nsteps…  ", "page_path": "/invoices/edit?id=1"}
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var out struct {
		Error struct{ Code string } `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return out.Error.Code
}

func TestCreateStoresAndEmails(t *testing.T) {
	f := setup(t)
	rec := post(f, valid(), pngBytes(t, 1), pngBytes(t, 2))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var out struct{ ID string }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)

	var kind, description, page string
	var emailed *time.Time
	var shots int
	err := f.pool.QueryRow(context.Background(), `SELECT kind, description, page_path, emailed_at,
		(SELECT count(*) FROM product_feedback_files WHERE feedback_id=f.id) FROM product_feedback f WHERE id=$1`, out.ID).Scan(&kind, &description, &page, &emailed, &shots)
	if err != nil {
		t.Fatal(err)
	}
	if kind != "problem" || description != "The invoice PDF is blank\nsteps…" || page != "/invoices/edit" || emailed == nil || shots != 2 {
		t.Fatalf("stored %q %q %q emailed=%v shots=%d", kind, description, page, emailed, shots)
	}
	if len(f.files.objects) != 2 {
		t.Fatalf("objects %v", len(f.files.objects))
	}
	if len(f.mailer.sent) != 1 {
		t.Fatalf("sent %d", len(f.mailer.sent))
	}
	m := f.mailer.sent[0]
	if m.To[0] != "team@helvetly.test" || m.ReplyTo != "ana@example.test" || m.Subject != "Problem: The invoice PDF is blank" ||
		len(m.Attachments) != 2 || !strings.Contains(m.Text, "Acme (ws_fb)") {
		t.Fatalf("email %+v", m)
	}
}

func TestCreateRejects(t *testing.T) {
	big := append(pngBytes(t, 1), make([]byte, maxFileBytes)...)
	tests := []struct {
		name   string
		fields func(map[string]string)
		files  [][]byte
		status int
		code   string
	}{
		{"unknown kind", func(m map[string]string) { m["kind"] = "praise" }, nil, 400, "invalid_request"},
		{"empty description", func(m map[string]string) { m["description"] = "   " }, nil, 400, "invalid_request"},
		{"too long", func(m map[string]string) { m["description"] = strings.Repeat("é", 5001) }, nil, 400, "invalid_request"},
		{"no path", func(m map[string]string) { m["page_path"] = "invoices" }, nil, 400, "invalid_request"},
		{"control character", func(m map[string]string) { m["page_path"] = "/a\nb" }, nil, 400, "invalid_request"},
		{"unknown field", func(m map[string]string) { m["email"] = "x" }, nil, 400, "invalid_request"},
		{"not an image", func(map[string]string) {}, [][]byte{[]byte("%PDF-1.7 hello")}, 400, "unsupported_file"},
		{"same image twice", func(map[string]string) {}, [][]byte{pngBytes(t, 1), pngBytes(t, 1)}, 409, "duplicate_file"},
		{"six images", func(map[string]string) {}, [][]byte{pngBytes(t, 1), pngBytes(t, 2), pngBytes(t, 3), pngBytes(t, 4), pngBytes(t, 5), pngBytes(t, 6)}, 400, "invalid_request"},
		{"too large", func(map[string]string) {}, [][]byte{big}, 413, "payload_too_large"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			fields := valid()
			tc.fields(fields)
			rec := post(f, fields, tc.files...)
			if rec.Code != tc.status || errorCode(t, rec) != tc.code {
				t.Fatalf("got %d %s", rec.Code, rec.Body)
			}
			if len(f.files.objects) != 0 || len(f.mailer.sent) != 0 {
				t.Fatal("a refused report stored or sent something")
			}
		})
	}
}

func TestRateLimitPerPerson(t *testing.T) {
	f := setup(t)
	for range perHour {
		if rec := post(f, valid()); rec.Code != http.StatusCreated {
			t.Fatalf("status %d", rec.Code)
		}
	}
	rec := post(f, valid(), pngBytes(t, 9))
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "3600" || errorCode(t, rec) != "rate_limited" {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if len(f.files.objects) != 0 {
		t.Fatal("the refused report's screenshot was left in storage")
	}
}

func TestStoredWhenEmailFails(t *testing.T) {
	f := setup(t)
	f.mailer.fail = true
	rec := post(f, valid())
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d", rec.Code)
	}
	var emailed *time.Time
	if err := f.pool.QueryRow(context.Background(), `SELECT emailed_at FROM product_feedback`).Scan(&emailed); err != nil || emailed != nil {
		t.Fatalf("emailed=%v err=%v", emailed, err)
	}
}

func TestStorageFailureStoresNothing(t *testing.T) {
	f := setup(t)
	f.files.fail = true
	if rec := post(f, valid(), pngBytes(t, 1)); rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", rec.Code)
	}
	var n int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM product_feedback`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("rows=%d err=%v", n, err)
	}
}
