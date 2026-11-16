package workspaces

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// fakeStorage is an in-memory bucket; a presigned download is a redirect to a fake URL naming the key.
type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
	failPut bool
}

func (f *fakeStorage) Put(_ context.Context, key string, body io.Reader, size int64, _, _ string) error {
	b, err := io.ReadAll(body)
	if err != nil || int64(len(b)) != size {
		return fmt.Errorf("put %s: read %d of %d bytes: %v", key, len(b), size, err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failPut {
		return fmt.Errorf("put %s: bucket unreachable", key)
	}
	f.objects[key] = b
	return nil
}

func (f *fakeStorage) Get(_ context.Context, key string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("no object %s", key)
	}
	return b, nil
}

func (f *fakeStorage) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

func (f *fakeStorage) PresignDownload(_ context.Context, key string, _ time.Duration, _ string) (string, error) {
	return "https://s3.test/" + key, nil
}

func (f *fakeStorage) ProxyDownloads() bool { return false }

func (f *fakeStorage) Open(context.Context, string) (io.ReadSeekCloser, error) {
	return nil, fmt.Errorf("not used: downloads redirect")
}

func (f *fakeStorage) keys(prefix string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for k := range f.objects {
		if strings.Contains(k, prefix) {
			out = append(out, k)
		}
	}
	return out
}

func pngOf(w, h int, shade uint8) []byte {
	img := image.NewGray(image.Rect(0, 0, w, h))
	img.Pix[0] = shade // different bytes for the same size
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func (e *env) putLogo(b *browser, content []byte, csrf bool) (int, string) {
	e.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("file", "logo.png")
	_, _ = fw.Write(content)
	_ = mw.Close()
	req, _ := http.NewRequest(http.MethodPut, e.srv.URL+"/api/v1/workspace/logo", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if csrf {
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	res, err := b.c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(raw)
}

// get does not follow the redirect, so the key the server chose shows.
func (e *env) getLogo(b *browser, path string) (int, string) {
	e.t.Helper()
	c := *b.c
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := c.Get(e.srv.URL + path)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	return res.StatusCode, res.Header.Get("Location")
}

func (e *env) logoURL(b *browser) string {
	e.t.Helper()
	_, s := e.session(b)
	u, _ := s["workspace"].(map[string]any)["logo_url"].(string)
	return u
}

func (e *env) pointer(ws string) (p *string) {
	e.t.Helper()
	if err := e.raw.QueryRow(context.Background(), `SELECT logo_file_id FROM workspaces WHERE id = $1`, ws).Scan(&p); err != nil {
		e.t.Fatal(err)
	}
	return p
}

func TestLogoPermissionsAndCSRF(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Acme", "owner")
	admin, member := e.join(ws, "admin"), e.join(ws, "member")
	if code, _ := e.getLogo(member, "/api/v1/workspace/logo"); code != http.StatusNotFound {
		t.Fatalf("no logo yet: %d", code)
	}
	if code, _ := e.putLogo(owner, pngOf(128, 128, 1), false); code != http.StatusForbidden {
		t.Fatalf("no CSRF token: %d", code)
	}
	if code, body := e.putLogo(member, pngOf(128, 128, 1), true); code != http.StatusForbidden {
		t.Fatalf("member upload: %d %s", code, body)
	}
	if code, body := e.putLogo(admin, pngOf(128, 128, 1), true); code != http.StatusOK || !strings.Contains(body, `"logo_url":"/api/v1/workspaces/`+ws+`/logo?v=`) {
		t.Fatalf("admin upload: %d %s", code, body)
	}
	if code, _ := e.do(member, http.MethodDelete, "/api/v1/workspace/logo", nil); code != http.StatusForbidden {
		t.Fatalf("member delete: %d", code)
	}
	if code, loc := e.getLogo(member, "/api/v1/workspace/logo"); code != http.StatusFound || !strings.Contains(loc, "/workspace-logo/") {
		t.Fatalf("member read: %d %s", code, loc)
	}
	if code, _ := e.do(owner, http.MethodDelete, "/api/v1/workspace/logo", nil); code != http.StatusNoContent {
		t.Fatalf("owner delete: %d", code)
	}
	if code, _ := e.do(owner, http.MethodDelete, "/api/v1/workspace/logo", nil); code != http.StatusNotFound {
		t.Fatalf("delete twice: %d", code)
	}
}

func TestLogoValidation(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Acme", "owner")
	webp := append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), make([]byte, 64)...)
	for _, tt := range []struct {
		name    string
		content []byte
		message string
	}{
		{"webp", webp, "WebP is not supported"},
		{"svg", []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>`), "SVG is not supported"},
		{"text", []byte("hello, I am not an image"), "PNG or JPEG"},
		{"truncated", pngOf(128, 128, 1)[:40], "cannot be read"},
		{"too small", pngOf(32, 32, 1), "at least 64 px"},
		{"too large", pngOf(1025, 1025, 1), "at most 1024 px"},
		{"not square", pngOf(128, 127, 1), "must be square"},
		{"over 2 MB", append(pngOf(128, 128, 1), make([]byte, 2<<20)...), "at most 2 MB"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if code, body := e.putLogo(owner, tt.content, true); code != http.StatusUnprocessableEntity || !strings.Contains(body, tt.message) {
				t.Fatalf("%d %s", code, body)
			}
		})
	}
	if keys := e.files.keys("workspace-logo"); len(keys) != 0 || e.pointer(ws) != nil {
		t.Fatalf("refused uploads left %v, pointer %v", keys, e.pointer(ws))
	}
	// the largest square the server takes, and the smallest
	for _, side := range []int{64, 1024} {
		if code, body := e.putLogo(owner, pngOf(side, side, uint8(side)), true); code != http.StatusOK {
			t.Fatalf("%d px: %d %s", side, code, body)
		}
	}
}

func TestLogoLifecycle(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Acme", "owner")
	if e.logoURL(owner) != "" {
		t.Fatal("a new workspace has no logo")
	}
	first := pngOf(128, 128, 1)
	e.putLogo(owner, first, true)
	id := *e.pointer(ws)
	if want := "/api/v1/workspaces/" + ws + "/logo?v=" + id; e.logoURL(owner) != want {
		t.Fatalf("session logo_url %q, want %q", e.logoURL(owner), want)
	}
	// the same bytes again store nothing and change nothing
	if code, _ := e.putLogo(owner, first, true); code != http.StatusOK || *e.pointer(ws) != id || len(e.files.keys("workspace-logo")) != 1 {
		t.Fatalf("duplicate upload: pointer %v, objects %v", *e.pointer(ws), e.files.keys("workspace-logo"))
	}
	// other bytes replace it, and the old object goes
	e.putLogo(owner, pngOf(128, 128, 2), true)
	if now := *e.pointer(ws); now == id || len(e.files.keys("workspace-logo")) != 1 || len(e.files.keys(id)) != 0 {
		t.Fatalf("replace: pointer %v, objects %v", now, e.files.keys("workspace-logo"))
	}
	var counted int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM stored_objects WHERE workspace_id = $1 AND object_key LIKE '%/workspace-logo/%'`, ws).Scan(&counted); err != nil || counted == 0 {
		t.Fatalf("stored_objects rows %d: %v", counted, err)
	}
	_, list := e.do(owner, http.MethodGet, "/api/v1/session/workspaces", nil)
	if item := list["data"].([]any)[0].(map[string]any); item["logo_url"] != e.logoURL(owner) {
		t.Fatalf("workspace list: %v", item)
	}
	e.do(owner, http.MethodDelete, "/api/v1/workspace/logo", nil)
	if e.pointer(ws) != nil || len(e.files.keys("workspace-logo")) != 0 || e.logoURL(owner) != "" {
		t.Fatalf("delete left pointer %v, objects %v", e.pointer(ws), e.files.keys("workspace-logo"))
	}
}

// A failed upload leaves no object and no pointer.
func TestLogoFailedStorage(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Acme", "owner")
	e.files.failPut = true
	if code, _ := e.putLogo(owner, pngOf(128, 128, 1), true); code < 500 {
		t.Fatalf("unreachable bucket: %d", code)
	}
	if e.pointer(ws) != nil || len(e.files.keys("workspace-logo")) != 0 {
		t.Fatalf("pointer %v, objects %v", e.pointer(ws), e.files.keys("workspace-logo"))
	}
}

// Concurrent replacements end with one pointer and one object, never an orphan or a dangling pointer.
func TestLogoConcurrentReplace(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Acme", "owner")
	var wg sync.WaitGroup
	for i := range 6 {
		wg.Go(func() { e.putLogo(owner, pngOf(128, 128, uint8(i+1)), true) })
	}
	wg.Wait()
	keys := e.files.keys("workspace-logo")
	if p := e.pointer(ws); p == nil || len(keys) != 1 || !strings.HasSuffix(keys[0], "/"+*p) {
		t.Fatalf("pointer %v, objects %v", p, keys)
	}
}

// The switcher lists every workspace of the person: each logo is served to its members only, from that workspace's
// own object, and a stranger gets the answer of a workspace without a logo.
func TestWorkspaceLogoOfAnotherWorkspace(t *testing.T) {
	e := newEnv(t)
	owner, wsA := e.person("A", "owner")
	e.putLogo(owner, pngOf(128, 128, 1), true)
	other, wsB := e.person("B", "owner")
	stranger, _ := e.person("C", "owner")
	// the person of B also belongs to A, where the session is not
	if err := e.st.AddMember(context.Background(), wsA, other.userID, "member", time.Now()); err != nil {
		t.Fatal(err)
	}
	if e.pointer(wsB) != nil {
		t.Fatal("B has no logo")
	}
	code, loc := e.getLogo(other, "/api/v1/workspaces/"+wsA+"/logo")
	if code != http.StatusFound || !strings.Contains(loc, "workspaces/"+wsA+"/workspace-logo/") {
		t.Fatalf("member of A, session in B: %d %s", code, loc)
	}
	_, list := e.do(other, http.MethodGet, "/api/v1/session/workspaces", nil)
	urls := map[string]any{}
	for _, it := range list["data"].([]any) {
		m := it.(map[string]any)
		urls[m["id"].(string)] = m["logo_url"]
	}
	if urls[wsB] != nil || urls[wsA] != "/api/v1/workspaces/"+wsA+"/logo?v="+*e.pointer(wsA) {
		t.Fatalf("workspace list urls %v", urls)
	}
	for _, path := range []string{"/api/v1/workspaces/" + wsA + "/logo", "/api/v1/workspaces/wsp_missing/logo", "/api/v1/workspaces/" + wsB + "/logo"} {
		if code, _ := e.getLogo(stranger, path); code != http.StatusNotFound {
			t.Fatalf("stranger %s: %d", path, code)
		}
	}
	// A's own upload from the other person's session in B changes nothing of A
	if code, _ := e.putLogo(other, pngOf(128, 128, 9), true); code != http.StatusOK || e.pointer(wsA) == nil || e.pointer(wsB) == nil {
		t.Fatalf("B's upload: %d", code)
	}
	if keys := e.files.keys("workspaces/" + wsB + "/workspace-logo/"); len(keys) != 1 {
		t.Fatalf("B objects %v", keys)
	}
}

type nopWriter struct{}

func (nopWriter) Table(string) error        { return nil }
func (nopWriter) Row(json.RawMessage) error { return nil }

// The workspace logo and the document logo are separate pointers: each is exported by itself, and removing one
// leaves the other.
func TestLogoIndependentOfDocumentLogo(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Acme", "owner")
	ctx := context.Background()
	if _, err := e.raw.Exec(ctx, `INSERT INTO invoice_settings (workspace_id, settings, updated_at) VALUES ($1, '{"logo_file_id":"lgo_doc"}', now())`, ws); err != nil {
		t.Fatal(err)
	}
	e.putLogo(owner, pngOf(128, 128, 1), true)
	paths := func() []string {
		files, err := e.st.Export(ctx, ws, nil, nopWriter{}, true)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, f := range files {
			out = append(out, f.Path+"="+f.Key)
		}
		return out
	}
	got := paths()
	if !slices.Contains(got, "invoice-settings/logo=workspaces/"+ws+"/invoice-settings/lgo_doc") || !slices.ContainsFunc(got, func(s string) bool {
		return strings.HasPrefix(s, "workspace/logo=workspaces/"+ws+"/workspace-logo/")
	}) {
		t.Fatalf("export files %v", got)
	}
	e.do(owner, http.MethodDelete, "/api/v1/workspace/logo", nil)
	var doc string
	if err := e.raw.QueryRow(ctx, `SELECT settings->>'logo_file_id' FROM invoice_settings WHERE workspace_id = $1`, ws).Scan(&doc); err != nil || doc != "lgo_doc" {
		t.Fatalf("document logo pointer %q: %v", doc, err)
	}
	if got := paths(); len(got) != 1 || !strings.HasPrefix(got[0], "invoice-settings/logo=") {
		t.Fatalf("export after delete %v", got)
	}
}

// cancelingStorage cancels the request once the new object is stored, before the pointer transaction can commit, and
// records whether the cleanup delete came with a live, bounded context.
type cancelingStorage struct {
	Storage
	cancel  context.CancelFunc
	bounded bool
}

func (s *cancelingStorage) Put(ctx context.Context, key string, body io.Reader, size int64, contentType, name string) error {
	if err := s.Storage.Put(ctx, key, body, size, contentType, name); err != nil {
		return err
	}
	s.cancel()
	return nil
}

func (s *cancelingStorage) Delete(ctx context.Context, key string) error {
	deadline, ok := ctx.Deadline()
	s.bounded = ok && time.Until(deadline) > 0 && time.Until(deadline) <= 5*time.Second
	if err := ctx.Err(); err != nil {
		return err
	}
	return s.Storage.Delete(ctx, key)
}

// The client goes away after the new object was stored: the logo, the pointer and the accounting of the old one stay,
// and the unreferenced new object is removed with a context of its own, not the cancelled request's.
func TestLogoCanceledAfterPutKeepsOldLogo(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Acme", "owner")
	e.putLogo(owner, pngOf(128, 128, 1), true)
	old := *e.pointer(ws)
	oldKey := logoKey(ws, old)
	oldBytes, _ := e.files.Get(context.Background(), oldKey)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	files := &cancelingStorage{Storage: e.files, cancel: cancel}
	svc := New(e.st, e.billing.auth, e.billing, files, slog.New(slog.NewTextHandler(io.Discard, nil)))
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, _ := mw.CreateFormFile("file", "logo.png")
	_, _ = part.Write(pngOf(128, 128, 2))
	_ = mw.Close()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/workspace/logo", &body).WithContext(ctx)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	svc.putLogo(rec, req, store.Session{Role: "owner", Workspace: store.Workspace{ID: ws}})

	if rec.Code < 400 {
		t.Fatalf("cancelled upload answered %d", rec.Code)
	}
	if !files.bounded {
		t.Fatal("the new object's cleanup did not run with a live, bounded context")
	}
	if p := e.pointer(ws); p == nil || *p != old {
		t.Fatalf("pointer %v, want the old %s", p, old)
	}
	if got := e.files.keys("workspace-logo"); len(got) != 1 || got[0] != oldKey {
		t.Fatalf("objects %v, want only %s", got, oldKey)
	}
	if kept, _ := e.files.Get(context.Background(), oldKey); !bytes.Equal(kept, oldBytes) {
		t.Fatal("the old logo's bytes changed")
	}
	var rows int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM stored_objects WHERE workspace_id = $1 AND object_key = $2`, ws, oldKey).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("old object's accounting rows %d: %v", rows, err)
	}
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM stored_objects WHERE workspace_id = $1 AND object_key LIKE '%/workspace-logo/%' AND object_key <> $2`, ws, oldKey).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("accounting rows for the cancelled upload: %d: %v", rows, err)
	}
}
