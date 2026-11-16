package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/documents"
	"helvetly.com/api/internal/store"
)

func setAdmissionLimit(t *testing.T, e *env, key Limit, max int64) {
	t.Helper()
	if key == Members { // a flat price allows the self-service seats less the owner
		key, max = MaxSeats, max+1
	}
	e.setPlanValue(Basic, key, StateLimited, &max)
	e.st.SetAdmission(e.svc.AllowResource)
}

func TestConcurrentHTTPClientsAndPooledWritesCannotSpendTheLastSlotTwice(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	other := e.workspace()
	e.subscribe(other.workspace, "price_bm")
	setAdmissionLimit(t, e, Clients, 1)
	mux := http.NewServeMux()
	clients.New(e.st, e.svc.auth, nil, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(mux)
	arrived := make(chan struct{}, 2)
	release := make(chan struct{})
	srv := httptest.NewServer(e.svc.Guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { arrived <- struct{}{}; <-release; mux.ServeHTTP(w, r) })))
	t.Cleanup(srv.Close)
	e.srv = srv
	results := make(chan int, 2)
	for _, name := range []string{"One", "Two"} {
		go func() {
			code, _ := e.do(b, http.MethodPost, "/api/v1/clients", map[string]any{"name": name})
			results <- code
		}()
	}
	for range 2 {
		select {
		case <-arrived:
		case <-time.After(5 * time.Second):
			close(release)
			t.Fatal("both requests must pass preflight before racing the real write")
		}
	}
	close(release)
	counts := map[int]int{}
	for range 2 {
		counts[<-results]++
	}
	if counts[http.StatusCreated] != 1 || counts[http.StatusPaymentRequired] != 1 {
		t.Fatalf("concurrent responses=%v", counts)
	}
	var count int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM clients WHERE workspace_id=$1`, b.workspace).Scan(&count); err != nil || count != 1 {
		t.Fatalf("persisted clients=%d err=%v", count, err)
	}
	// A failed transaction consumes neither capacity nor the workspace's next client number.
	rollback := errors.New("force rollback")
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		if err := q.CreateClient(context.Background(), other.workspace, "rolled-back", map[string]any{"name": "Transient"}, time.Now()); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("rollback=%v", err)
	}
	if err := e.st.CreateClient(context.Background(), other.workspace, "after-rollback", map[string]any{"name": "Kept"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	client, err := e.st.Client(context.Background(), other.workspace, "after-rollback")
	if err != nil || client.Number != 1 {
		t.Fatalf("client number after rollback=%v err=%v", client.Number, err)
	}
}

type admissionFiles struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (f *admissionFiles) Put(_ context.Context, key string, r io.Reader, _ int64, _, _ string) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = b
	return nil
}
func (f *admissionFiles) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}
func (f *admissionFiles) Copy(_ context.Context, src, dst string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[src]
	if !ok {
		return fmt.Errorf("missing object")
	}
	f.objects[dst] = bytes.Clone(b)
	return nil
}
func (f *admissionFiles) PresignDownload(_ context.Context, key string, _ time.Duration, _ string) (string, error) {
	return "https://files.example.invalid/" + key, nil
}
func (f *admissionFiles) ProxyDownloads() bool { return false }

type admissionReader struct{ *bytes.Reader }

func (admissionReader) Close() error { return nil }
func (f *admissionFiles) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("missing object")
	}
	return admissionReader{bytes.NewReader(bytes.Clone(b))}, nil
}

func TestExactStoredBytesConcurrentUploadAndFullQuotaDuplicate(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	first := []byte("small plain text document one")
	second := []byte("small plain text document two")
	setAdmissionLimit(t, e, Storage, int64(len(first)))
	files := &admissionFiles{objects: map[string][]byte{}}
	mux := http.NewServeMux()
	documents.New(e.st, e.svc.auth, files, 1<<20, slog.New(slog.NewTextHandler(io.Discard, nil))).Register(mux)
	srv := httptest.NewServer(e.svc.Guard(mux))
	t.Cleanup(srv.Close)
	upload := func(name string, body []byte) int {
		var form bytes.Buffer
		writer := multipart.NewWriter(&form)
		part, err := writer.CreateFormFile("file", name)
		if err != nil {
			t.Error(err)
			return 0
		}
		if _, err := part.Write(body); err != nil {
			t.Error(err)
			return 0
		}
		if err := writer.Close(); err != nil {
			t.Error(err)
			return 0
		}
		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/documents", &form)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("X-CSRF-Token", b.csrf)
		req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Error(err)
			return 0
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	results := make(chan struct {
		code int
		body []byte
	}, 2)
	for i, body := range [][]byte{first, second} {
		go func() {
			results <- struct {
				code int
				body []byte
			}{upload(fmt.Sprintf("file-%d.txt", i), body), body}
		}()
	}
	var winner []byte
	counts := map[int]int{}
	for range 2 {
		result := <-results
		counts[result.code]++
		if result.code == http.StatusCreated {
			winner = result.body
		}
	}
	if counts[http.StatusCreated] != 1 || counts[http.StatusPaymentRequired] != 1 {
		t.Fatalf("upload responses=%v", counts)
	}
	if code := upload("renamed.txt", winner); code != http.StatusConflict {
		t.Fatalf("full quota must preserve hash duplicate409, got%d", code)
	}
	if got := e.stored(b.workspace); got != int64(len(first)) {
		t.Fatalf("stored bytes %d, want %d", got, len(first))
	}
	files.mu.Lock()
	defer files.mu.Unlock()
	if len(files.objects) != 1 {
		t.Fatalf("failed upload left %d objects", len(files.objects))
	}
}

// TestDuplicatesAddNoBytesAndCopiesDo: the same bytes again, under another name, in the same batch or through another
// entry point (a client's files) are refused or linked and count nothing; a deliberate copy is its own object and
// counts; another workspace's identical file counts for that workspace only.
func TestDuplicatesAddNoBytesAndCopiesDo(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	other := e.workspace()
	e.subscribe(other.workspace, "price_bm")
	e.st.SetAdmission(e.svc.AllowResource)
	files := &admissionFiles{objects: map[string][]byte{}}
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	mux := http.NewServeMux()
	documents.New(e.st, e.svc.auth, files, 1<<20, quiet).Register(mux)
	clients.New(e.st, e.svc.auth, files, quiet).Register(mux)
	srv := httptest.NewServer(e.svc.Guard(mux))
	t.Cleanup(srv.Close)
	e.srv = srv
	upload := func(who *browser, path string, bodies ...[]byte) (int, map[string]any) {
		t.Helper()
		var form bytes.Buffer
		writer := multipart.NewWriter(&form)
		for i, body := range bodies {
			field := "file"
			if strings.Contains(path, "/clients/") {
				field = "files[]"
			}
			part, _ := writer.CreateFormFile(field, fmt.Sprintf("name-%d.txt", i))
			_, _ = part.Write(body)
		}
		_ = writer.Close()
		req, _ := http.NewRequest(http.MethodPost, srv.URL+path, &form)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("X-CSRF-Token", who.csrf)
		req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: who.token})
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	body := []byte("the same plain text, byte for byte")
	n := int64(len(body))
	code, out := upload(b, "/api/v1/documents", body)
	if code != http.StatusCreated {
		t.Fatalf("first upload: %d %v", code, out)
	}
	doc := out["data"].(map[string]any)["id"].(string)
	if code, _ := upload(b, "/api/v1/documents", body); code != http.StatusConflict {
		t.Fatalf("the same bytes under another name: %d", code)
	}
	client := e.buyer(b.workspace)
	if code, out := upload(b, "/api/v1/clients/"+client+"/files", body); code != http.StatusCreated {
		t.Fatalf("the same bytes as a client's file (linked): %d %v", code, out)
	}
	if code, _ := upload(b, "/api/v1/clients/"+client+"/files", []byte("new one"), []byte("new one")); code != http.StatusConflict {
		t.Fatalf("one file twice in a batch: %d", code)
	}
	if got := e.stored(b.workspace); got != n {
		t.Fatalf("duplicates counted: %d bytes, want %d", got, n)
	}
	if code, out := e.do(b, http.MethodPost, "/api/v1/documents/"+doc+"/copy", map[string]any{}); code != http.StatusCreated {
		t.Fatalf("copy: %d %v", code, out)
	}
	if got := e.stored(b.workspace); got != 2*n {
		t.Fatalf("a deliberate copy: %d bytes, want %d", got, 2*n)
	}
	if code, _ := upload(other, "/api/v1/documents", body); code != http.StatusCreated {
		t.Fatalf("another workspace's identical file: %d", code)
	}
	if got, mine := e.stored(other.workspace), e.stored(b.workspace); got != n || mine != 2*n {
		t.Fatalf("across workspaces: other %d, this %d", got, mine)
	}
}
