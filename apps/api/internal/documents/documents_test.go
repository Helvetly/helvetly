package documents

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
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

// ---- a fake bucket ----

type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
	proxy   bool  // S3_PROXY_DOWNLOADS
	openErr error // every Open fails with it while set
}

func (f *fakeStorage) Put(_ context.Context, key string, body io.Reader, size int64, _, _ string) error {
	b, err := io.ReadAll(body)
	if err != nil || int64(len(b)) != size {
		return fmt.Errorf("put %s: read %d of %d bytes: %v", key, len(b), size, err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = b
	return nil
}

func (f *fakeStorage) PresignDownload(_ context.Context, key string, ttl time.Duration, name string) (string, error) {
	return "https://s3.test/" + key + "?ttl=" + ttl.String() + "&name=" + url.QueryEscape(name), nil
}

func (f *fakeStorage) ProxyDownloads() bool { return f.proxy }

type object struct{ *bytes.Reader }

func (object) Close() error { return nil }

func (f *fakeStorage) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.openErr != nil {
		return nil, f.openErr
	}
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("open %s: missing", key)
	}
	return object{bytes.NewReader(b)}, nil
}

func (f *fakeStorage) Copy(_ context.Context, src, dst string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[dst] = f.objects[src]
	return nil
}

func (f *fakeStorage) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

func (f *fakeStorage) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.objects)
}

// ---- the test server ----

type env struct {
	t     *testing.T
	st    *store.Store
	raw   *pgxpool.Pool
	srv   *httptest.Server
	files *fakeStorage
	svc   *Service
}

const testMaxSize = 64 << 10

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	files := &fakeStorage{objects: map[string][]byte{}}
	svc := New(st, a, files, testMaxSize, discard)
	mux := http.NewServeMux()
	a.Register(mux)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, raw: raw, srv: srv, files: files, svc: svc}
}

type browser struct{ token, csrf, workspace, user string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "Europe/Zurich", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, "owner")
}

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna " + role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws, user: u.ID}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), b.csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	return b
}

func (e *env) send(b *browser, method, path string, body any, contentType string, header ...string) (*http.Response, []byte) {
	e.t.Helper()
	var rd io.Reader
	switch v := body.(type) {
	case nil:
	case *bytes.Buffer:
		rd = v
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			e.t.Fatal(err)
		}
		rd, contentType = bytes.NewReader(raw), "application/json"
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	if b != nil {
		req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	resp, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, raw
}

func (e *env) do(b *browser, method, path string, body any, want int, out any) {
	e.t.Helper()
	resp, raw := e.send(b, method, path, body, "")
	if resp.StatusCode != want {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, want, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
}

type apiErr struct {
	Error struct {
		Code    string `json:"code"`
		Details struct {
			Fields     map[string]string `json:"fields"`
			ExistingID string            `json:"existing_id"`
			Suggestion string            `json:"suggestion"`
		} `json:"details"`
	} `json:"error"`
}

func (e *env) fails(b *browser, method, path string, body any, status int, code string) apiErr {
	e.t.Helper()
	var out apiErr
	e.do(b, method, path, body, status, &out)
	if out.Error.Code != code {
		e.t.Fatalf("%s %s: code %q, want %q", method, path, out.Error.Code, code)
	}
	return out
}

type one[T any] struct{ Data T }

func (e *env) folder(b *browser, name string, parent *string) store.Folder {
	e.t.Helper()
	var out one[store.Folder]
	e.do(b, "POST", "/api/v1/documents/folders", map[string]any{"name": name, "parent_id": parent}, 201, &out)
	return out.Data
}

const (
	pdf = "%PDF-1.7\nhello"
	png = "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
)

// upload posts one file with form fields (key, value pairs) and returns the response.
func (e *env) upload(b *browser, name, content string, fields ...string) (*http.Response, []byte) {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	w, err := mw.CreateFormFile("file", name)
	if err != nil {
		e.t.Fatal(err)
	}
	_, _ = w.Write([]byte(content))
	for i := 0; i+1 < len(fields); i += 2 {
		_ = mw.WriteField(fields[i], fields[i+1])
	}
	_ = mw.Close()
	return e.send(b, "POST", "/api/v1/documents", &buf, mw.FormDataContentType())
}

func (e *env) uploaded(b *browser, name, content string, fields ...string) store.Document {
	e.t.Helper()
	resp, raw := e.upload(b, name, content, fields...)
	if resp.StatusCode != 201 {
		e.t.Fatalf("upload %s: %d %s", name, resp.StatusCode, raw)
	}
	var out one[store.Document]
	if err := json.Unmarshal(raw, &out); err != nil {
		e.t.Fatal(err)
	}
	return out.Data
}

type page struct {
	Data []store.Document
	Meta struct {
		Total      int
		TotalPages int `json:"total_pages"`
	}
}

func (e *env) list(b *browser, query string) page {
	e.t.Helper()
	var out page
	e.do(b, "GET", "/api/v1/documents?"+query, nil, 200, &out)
	return out
}

func names(docs []store.Document) []string {
	out := []string{}
	for _, d := range docs {
		out = append(out, d.Name)
	}
	return out
}

type bulkOut struct {
	Updated int
	Skipped []skip
}

func (e *env) bulk(b *browser, body map[string]any) bulkOut {
	e.t.Helper()
	var out one[bulkOut]
	e.do(b, "POST", "/api/v1/documents/bulk", body, 200, &out)
	return out.Data
}

// ---- tests ----

func TestFolders(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	offers := e.folder(b, "  Offers ", nil)
	if offers.Name != "Offers" || offers.ParentID != nil || !strings.HasPrefix(offers.ID, "fld_") || offers.CreatedBy.Name != "Anna owner" {
		t.Fatalf("created: %+v", offers)
	}
	y2026 := e.folder(b, "2026", &offers.ID)
	deep := e.folder(b, "Q1", &y2026.ID)

	for _, tc := range []struct {
		name   string
		body   map[string]any
		status int
		code   string
	}{
		{"blank", map[string]any{"name": " "}, 422, "validation_failed"},
		{"slash", map[string]any{"name": "a/b"}, 422, "validation_failed"},
		{"too long", map[string]any{"name": strings.Repeat("x", 256)}, 422, "validation_failed"},
		{"same name any case", map[string]any{"name": "OFFERS"}, 409, "name_taken"},
		{"parent missing", map[string]any{"name": "x", "parent_id": "fld_missing"}, 422, "validation_failed"},
	} {
		t.Run(tc.name, func(t *testing.T) { e.fails(b, "POST", "/api/v1/documents/folders", tc.body, tc.status, tc.code) })
	}
	if out := e.fails(b, "POST", "/api/v1/documents/folders", map[string]any{"name": "offers"}, 409, "name_taken"); out.Error.Details.Suggestion != "offers (2)" ||
		out.Error.Details.ExistingID != offers.ID {
		t.Fatalf("conflict details: %+v", out.Error.Details)
	}
	e.folder(b, "Offers", &y2026.ID) // the same name elsewhere is fine

	// Rename, move, and no cycles.
	var got one[store.Folder]
	e.do(b, "PATCH", "/api/v1/documents/folders/"+deep.ID, map[string]any{"name": "Quarter 1", "parent_id": nil}, 200, &got)
	if got.Data.Name != "Quarter 1" || got.Data.ParentID != nil {
		t.Fatalf("patched: %+v", got.Data)
	}
	e.fails(b, "PATCH", "/api/v1/documents/folders/"+offers.ID, map[string]any{"parent_id": y2026.ID}, 422, "validation_failed")
	e.fails(b, "PATCH", "/api/v1/documents/folders/"+offers.ID, map[string]any{"parent_id": offers.ID}, 422, "validation_failed")
	e.fails(b, "PATCH", "/api/v1/documents/folders/"+deep.ID, map[string]any{"name": "offers"}, 409, "name_taken")
	e.fails(b, "PATCH", "/api/v1/documents/folders/"+deep.ID, map[string]any{"colour": "red"}, 400, "invalid_request")

	// Totals add up the subtree.
	e.uploaded(b, "a.pdf", pdf, "folder_id", offers.ID)
	e.uploaded(b, "b.pdf", pdf+"xx", "folder_id", y2026.ID)
	var all one[[]store.Folder]
	all.Data = e.userFolders(b)
	for _, f := range all.Data {
		if f.ID == offers.ID && (f.FileCount != 1 || f.TotalFiles != 2 || f.TotalSize != int64(2*len(pdf)+2)) {
			t.Fatalf("offers totals: %+v", f)
		}
	}
	if len(all.Data) != 4 {
		t.Fatalf("%d folders", len(all.Data))
	}

	// Another workspace sees none of it.
	other := e.workspace()
	e.fails(other, "PATCH", "/api/v1/documents/folders/"+offers.ID, map[string]any{"name": "x"}, 404, "not_found")
	e.fails(other, "POST", "/api/v1/documents/folders", map[string]any{"name": "x", "parent_id": offers.ID}, 422, "validation_failed")
}

func TestUpload(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	d := e.uploaded(b, `C:\Users\anna\Offerte 2026.PDF`, pdf)
	sum := sha256.Sum256([]byte(pdf))
	if !strings.HasPrefix(d.ID, "doc_") || d.Name != "Offerte 2026.PDF" || d.ContentType != "application/pdf" || d.Kind != "pdf" ||
		!d.Previewable || d.Size != int64(len(pdf)) || d.SHA256 == nil || *d.SHA256 != hex.EncodeToString(sum[:]) ||
		d.UploadedBy.Name != "Anna owner" || d.FolderID != nil || len(d.Links) != 0 {
		t.Fatalf("uploaded: %+v", d)
	}
	if e.files.count() != 1 {
		t.Fatalf("%d objects", e.files.count())
	}

	for _, tc := range []struct{ name, file, content, code string }{
		{"executable", "tool.exe", "MZ\x90\x00", "validation_failed"},
		{"renamed text", "fake.pdf", "just text", "validation_failed"},
		{"svg", "logo.svg", "<svg></svg>", "validation_failed"},
		{"too large", "big.pdf", pdf + strings.Repeat("x", testMaxSize), "payload_too_large"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, raw := e.upload(b, tc.file, tc.content)
			var out apiErr
			_ = json.Unmarshal(raw, &out)
			if out.Error.Code != tc.code || resp.StatusCode < 400 {
				t.Fatalf("%d %s", resp.StatusCode, raw)
			}
			if e.files.count() != 1 {
				t.Fatalf("%d objects stored", e.files.count())
			}
		})
	}
	for _, f := range [][2]string{{"x.xlsx", "PK\x03\x04rest"}, {"x.xls", string(oleMagic) + "rest"}, {"notes.md", "# hi"},
		{"camt.xml", "<?xml version=\"1.0\"?><Document/>"}, {"pic.png", png}} {
		if got := e.uploaded(b, f[0], f[1]); got.Kind == "other" {
			t.Fatalf("%s: kind %s", f[0], got.Kind)
		}
	}

	// A taken name: fail with a suggestion, keep both, or replace (the old one goes to the Trash).
	resp, raw := e.upload(b, "offerte 2026.pdf", pdf+"different")
	var conflict apiErr
	_ = json.Unmarshal(raw, &conflict)
	if resp.StatusCode != 409 || conflict.Error.Details.ExistingID != d.ID || conflict.Error.Details.Suggestion != "offerte 2026 (2).pdf" {
		t.Fatalf("conflict: %d %s", resp.StatusCode, raw)
	}
	if both := e.uploaded(b, "Offerte 2026.PDF", pdf+"second", "on_conflict", "keep_both"); both.Name != "Offerte 2026 (2).PDF" {
		t.Fatalf("keep both: %q", both.Name)
	}
	replaced := e.uploaded(b, "Offerte 2026.PDF", pdf+"third", "on_conflict", "replace")
	var old one[store.Document]
	e.do(b, "GET", "/api/v1/documents/"+d.ID, nil, 200, &old)
	if replaced.Name != "Offerte 2026.PDF" || old.Data.DeletedAt == nil || old.Data.PurgeAt == nil {
		t.Fatalf("replace: %+v / %+v", replaced, old.Data)
	}

	// Into a folder, linked to a client.
	f := e.folder(b, "Clients", nil)
	cli := e.client(b, "Acme AG")
	linked := e.uploaded(b, "contract.pdf", pdf+"contract", "folder_id", f.ID, "client_id", cli)
	if linked.Folder == nil || linked.Folder.Name != "Clients" || len(linked.Links) != 1 || linked.Links[0].Label != "Acme AG" ||
		linked.Links[0].Retains {
		t.Fatalf("linked: %+v", linked)
	}
	for _, fields := range [][]string{{"folder_id", "fld_missing"}, {"client_id", "cli_missing"}, {"on_conflict", "merge"}} {
		if resp, raw := e.upload(b, "y.pdf", pdf, fields...); resp.StatusCode != 422 {
			t.Fatalf("%v: %d %s", fields, resp.StatusCode, raw)
		}
	}
}

func (e *env) client(b *browser, name string) string {
	e.t.Helper()
	id := auth.NewID("cli")
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at)
		VALUES ($1, $2, (SELECT count(*) + 1 FROM clients WHERE workspace_id = $2), $3, now(), now())`, id, b.workspace, name); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func TestListUpdateCopy(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	f := e.folder(b, "Invoices", nil)
	e.uploaded(b, "zeta.pdf", pdf)
	e.uploaded(b, "Alpha.png", png)
	inside := e.uploaded(b, "beta.pdf", pdf+"longer", "folder_id", f.ID)
	cli := e.client(b, "Acme")
	e.do(b, "POST", "/api/v1/documents/"+inside.ID+"/links", map[string]any{"type": "client", "id": cli}, 201, nil)

	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"folder_id=root", []string{"Alpha.png", "zeta.pdf"}},
		{"folder_id=" + f.ID, []string{"beta.pdf"}},
		{"", []string{"Alpha.png", "beta.pdf", "zeta.pdf"}},
		{"search=ET", []string{"beta.pdf", "zeta.pdf"}},
		{"search=%25", []string{}},
		{"kind=image", []string{"Alpha.png"}},
		{"kind=pdf&sort=-size", []string{"beta.pdf", "zeta.pdf"}},
		{"kind=pdf&kind=image", []string{"Alpha.png", "beta.pdf", "zeta.pdf"}},
		{"kind=pdf,image", []string{"Alpha.png", "beta.pdf", "zeta.pdf"}},
		{"kind=pdf,spreadsheet", []string{"beta.pdf", "zeta.pdf"}},
		{"kind=image,pdf&folder_id=root", []string{"Alpha.png", "zeta.pdf"}},
		{"sort=-name", []string{"zeta.pdf", "beta.pdf", "Alpha.png"}},
		{"client_id=" + cli, []string{"beta.pdf"}},
		{"uploaded_by=" + b.user + "&folder_id=root", []string{"Alpha.png", "zeta.pdf"}},
		{"from=" + time.Now().Format(time.DateOnly) + "&kind=image", []string{"Alpha.png"}},
		{"to=2020-01-01", []string{}},
		{"page_size=2&page=2", []string{"zeta.pdf"}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			if got := names(e.list(b, tc.query).Data); !slices.Equal(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
	if p := e.list(b, "page_size=2"); p.Meta.Total != 3 || p.Meta.TotalPages != 2 {
		t.Fatalf("meta: %+v", p.Meta)
	}
	for _, q := range []string{"kind=movie", "kind=pdf,movie", "kind=pdf,", "sort=colour", "page=0", "page_size=501", "from=yesterday"} {
		e.fails(b, "GET", "/api/v1/documents?"+q, nil, 400, "invalid_request")
	}

	// Rename and move, with the same conflict rules as uploads.
	var got one[store.Document]
	e.do(b, "PATCH", "/api/v1/documents/"+inside.ID, map[string]any{"name": "Beta final.pdf", "folder_id": nil}, 200, &got)
	if got.Data.Name != "Beta final.pdf" || got.Data.FolderID != nil || got.Data.UpdatedAt.Equal(inside.UpdatedAt) {
		t.Fatalf("patched: %+v", got.Data)
	}
	e.fails(b, "PATCH", "/api/v1/documents/"+inside.ID, map[string]any{"name": "ZETA.pdf"}, 409, "name_taken")
	e.do(b, "PATCH", "/api/v1/documents/"+inside.ID, map[string]any{"name": "ZETA.pdf", "on_conflict": "keep_both"}, 200, &got)
	if got.Data.Name != "ZETA (2).pdf" {
		t.Fatalf("keep both: %q", got.Data.Name)
	}
	e.fails(b, "PATCH", "/api/v1/documents/"+inside.ID, map[string]any{"name": ""}, 422, "validation_failed")
	e.fails(b, "PATCH", "/api/v1/documents/"+inside.ID, map[string]any{"folder_id": "fld_missing"}, 422, "validation_failed")

	// Copy: a new file and object, a free name, no links.
	var cp one[store.Document]
	e.do(b, "POST", "/api/v1/documents/"+inside.ID+"/copy", map[string]any{}, 201, &cp)
	if cp.Data.ID == inside.ID || cp.Data.Name != "ZETA (3).pdf" || len(cp.Data.Links) != 0 || *cp.Data.SHA256 != *inside.SHA256 {
		t.Fatalf("copy: %+v", cp.Data)
	}
	e.do(b, "POST", "/api/v1/documents/"+inside.ID+"/copy", map[string]any{"folder_id": f.ID}, 201, &cp)
	if cp.Data.Name != "ZETA (2).pdf" || cp.Data.Folder == nil || e.files.count() != 5 {
		t.Fatalf("copy into folder: %+v, %d objects", cp.Data, e.files.count())
	}
}

func TestDownloadAndContent(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	d := e.uploaded(b, "Grüezi.pdf", pdf)
	resp, _ := e.send(b, "GET", "/api/v1/documents/"+d.ID+"/download", nil, "")
	want := "https://s3.test/workspaces/" + b.workspace + "/documents/" + d.ID + "/Gr_ezi.pdf?ttl=5m0s&name=Gr%C3%BCezi.pdf"
	if resp.StatusCode != 302 || resp.Header.Get("Location") != want {
		t.Fatalf("download: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	e.files.proxy = true // S3_PROXY_DOWNLOADS: the API streams the bytes itself
	resp, body := e.send(b, "GET", "/api/v1/documents/"+d.ID+"/download", nil, "", "Range", "bytes=0-3")
	if resp.StatusCode != 206 || string(body) != pdf[:4] || resp.Header.Get("Content-Type") != "application/pdf" ||
		resp.Header.Get("Content-Disposition") != "attachment; filename*=utf-8''Gr%C3%BCezi.pdf" {
		t.Fatalf("proxied download: %d %v %q", resp.StatusCode, resp.Header, body)
	}
	e.files.proxy = false

	resp, body = e.send(b, "GET", "/api/v1/documents/"+d.ID+"/content", nil, "")
	if resp.StatusCode != 200 || string(body) != pdf || resp.Header.Get("Content-Type") != "application/pdf" ||
		!strings.HasPrefix(resp.Header.Get("Content-Disposition"), "inline") || resp.Header.Get("X-Content-Type-Options") != "nosniff" ||
		resp.Header.Get("ETag") != `"`+*d.SHA256+`"` {
		t.Fatalf("content: %d %v", resp.StatusCode, resp.Header)
	}
	if resp, body := e.send(b, "GET", "/api/v1/documents/"+d.ID+"/content", nil, "", "Range", "bytes=0-3"); resp.StatusCode != 206 ||
		string(body) != "%PDF" {
		t.Fatalf("range: %d %q", resp.StatusCode, body)
	}
	if resp, _ := e.send(b, "GET", "/api/v1/documents/"+d.ID+"/content", nil, "", "If-None-Match", `"`+*d.SHA256+`"`); resp.StatusCode != 304 {
		t.Fatalf("etag: %d", resp.StatusCode)
	}
	sheet := e.uploaded(b, "data.csv", "a;b\n1;2\n")
	if resp, _ := e.send(b, "GET", "/api/v1/documents/"+sheet.ID+"/content", nil, ""); !strings.HasPrefix(resp.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("csv disposition: %q", resp.Header.Get("Content-Disposition"))
	}
	e.fails(e.workspace(), "GET", "/api/v1/documents/"+d.ID+"/content", nil, 404, "not_found")
	if resp, _ := e.send(nil, "GET", "/api/v1/documents/"+d.ID+"/content", nil, ""); resp.StatusCode != 401 {
		t.Fatalf("signed out: %d", resp.StatusCode)
	}
}

func TestTrash(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	member := e.join(b.workspace, "member")
	f := e.folder(b, "Projects", nil)
	sub := e.folder(b, "Old", &f.ID)
	inF := e.uploaded(b, "plan.pdf", pdf, "folder_id", f.ID)
	inSub := e.uploaded(b, "sketch.png", png, "folder_id", sub.ID)
	loose := e.uploaded(b, "loose.pdf", pdf+"loose")

	// A member trashes the folder: everything inside goes with it, the Trash shows the folder alone.
	if out := e.bulk(member, map[string]any{"action": "trash", "folder_ids": []string{f.ID}, "document_ids": []string{loose.ID}}); out.Updated != 2 {
		t.Fatalf("trash: %+v", out)
	}
	if got := names(e.list(b, "").Data); len(got) != 0 {
		t.Fatalf("live after trash: %v", got)
	}
	var trash one[[]store.TrashItem]
	e.do(b, "GET", "/api/v1/documents/trash", nil, 200, &trash)
	if len(trash.Data) != 2 {
		t.Fatalf("trash: %+v", trash.Data)
	}
	for _, it := range trash.Data {
		if it.Type == "folder" && (it.ItemCount != 3 || it.Size != int64(len(pdf)+len(png)) || it.DeletedBy.Name != "Anna member" ||
			!it.PurgeAt.Equal(it.DeletedAt.AddDate(0, 0, 30))) {
			t.Fatalf("folder entry: %+v", it)
		}
	}
	var folders one[[]store.Folder]
	folders.Data = e.userFolders(b)
	if len(folders.Data) != 0 {
		t.Fatalf("folders after trash: %+v", folders.Data)
	}
	e.fails(b, "PATCH", "/api/v1/documents/"+inF.ID, map[string]any{"name": "x.pdf"}, 409, "trashed")

	// Restore: a name taken meanwhile gets " (2)"; the contents come back too.
	e.folder(b, "projects", nil)
	e.uploaded(b, "loose.pdf", pdf)
	if out := e.bulk(member, map[string]any{"action": "restore", "folder_ids": []string{f.ID}, "document_ids": []string{loose.ID, inSub.ID}}); out.Updated != 2 ||
		len(out.Skipped) != 1 || out.Skipped[0].ID != inSub.ID {
		t.Fatalf("restore: %+v", out)
	}
	if got := names(e.list(b, "sort=name").Data); !slices.Equal(got, []string{"loose (2).pdf", "loose.pdf", "plan.pdf", "sketch.png"}) {
		t.Fatalf("after restore: %v", got)
	}
	folders.Data = e.userFolders(b)
	if len(folders.Data) != 3 || !slices.ContainsFunc(folders.Data, func(f store.Folder) bool { return f.Name == "Projects (2)" }) {
		t.Fatalf("folders after restore: %+v", folders.Data)
	}

	// Delete forever: owners and admins only, only from the Trash; objects go too.
	e.bulk(b, map[string]any{"action": "trash", "folder_ids": []string{f.ID}})
	e.fails(member, "POST", "/api/v1/documents/bulk", map[string]any{"action": "delete", "folder_ids": []string{f.ID}}, 403, "forbidden")
	e.fails(member, "POST", "/api/v1/documents/trash/empty", nil, 403, "forbidden")
	if out := e.bulk(b, map[string]any{"action": "delete", "document_ids": []string{loose.ID}}); out.Updated != 0 || len(out.Skipped) != 1 {
		t.Fatalf("delete a live file: %+v", out)
	}
	before := e.files.count()
	if out := e.bulk(b, map[string]any{"action": "delete", "folder_ids": []string{f.ID}}); out.Updated != 1 {
		t.Fatalf("delete: %+v", out)
	}
	if e.files.count() != before-2 {
		t.Fatalf("objects %d, want %d", e.files.count(), before-2)
	}
	e.fails(b, "GET", "/api/v1/documents/"+inF.ID, nil, 404, "not_found")

	// Expired entries are purged by the job; newer ones stay.
	e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{loose.ID}})
	e.svc.PurgeExpired(context.Background())
	e.do(b, "GET", "/api/v1/documents/trash", nil, 200, &trash)
	if len(trash.Data) != 1 {
		t.Fatalf("purged too early: %+v", trash.Data)
	}
	e.svc.now = func() time.Time { return time.Now().UTC().AddDate(0, 0, 31) }
	e.svc.PurgeExpired(context.Background())
	e.do(b, "GET", "/api/v1/documents/trash", nil, 200, &trash)
	if len(trash.Data) != 0 {
		t.Fatalf("not purged: %+v", trash.Data)
	}

	// Empty Trash.
	e.svc.now = func() time.Time { return time.Now().UTC() }
	e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{e.list(b, "").Data[0].ID}})
	var emptied one[map[string]int]
	e.do(b, "POST", "/api/v1/documents/trash/empty", nil, 200, &emptied)
	if emptied.Data["updated"] != 1 {
		t.Fatalf("empty: %+v", emptied.Data)
	}
	for _, body := range []map[string]any{{"action": "trash"}, {"action": "burn", "document_ids": []string{"x"}},
		{"action": "move", "document_ids": []string{"x"}, "folder_id": "fld_missing"}} {
		e.fails(b, "POST", "/api/v1/documents/bulk", body, 422, "validation_failed")
	}
}

func TestBulkMove(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	a := e.folder(b, "A", nil)
	inA := e.folder(b, "Inner", &a.ID)
	dest := e.folder(b, "Dest", nil)
	e.uploaded(b, "same.pdf", pdf, "folder_id", dest.ID)
	same := e.uploaded(b, "same.pdf", pdf+"outside")
	other := e.uploaded(b, "other.pdf", pdf+"other")

	out := e.bulk(b, map[string]any{"action": "move", "folder_id": dest.ID, "document_ids": []string{same.ID, other.ID},
		"folder_ids": []string{a.ID}})
	if out.Updated != 2 || len(out.Skipped) != 1 || out.Skipped[0].ID != same.ID || !strings.Contains(out.Skipped[0].Reason, "already") {
		t.Fatalf("move: %+v", out)
	}
	out = e.bulk(b, map[string]any{"action": "move", "folder_id": dest.ID, "document_ids": []string{same.ID}, "on_conflict": "keep_both"})
	if out.Updated != 1 {
		t.Fatalf("keep both: %+v", out)
	}
	if out := e.bulk(b, map[string]any{"action": "move", "folder_id": inA.ID, "folder_ids": []string{a.ID}}); out.Updated != 0 ||
		out.Skipped[0].Reason != "A folder can't move into itself." {
		t.Fatalf("cycle: %+v", out)
	}
	if got := names(e.list(b, "folder_id="+dest.ID).Data); !slices.Equal(got, []string{"other.pdf", "same (2).pdf", "same.pdf"}) {
		t.Fatalf("dest: %v", got)
	}
	if out := e.bulk(b, map[string]any{"action": "move", "folder_id": nil, "folder_ids": []string{a.ID}}); out.Updated != 1 {
		t.Fatalf("to top: %+v", out)
	}
}

func TestRetentionAndLinks(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	f := e.folder(b, "Receipts", nil)
	d := e.uploaded(b, "receipt.pdf", pdf, "folder_id", f.ID)
	cli := e.client(b, "Acme AG")
	ctx := context.Background()
	inv := auth.NewID("inv")
	if _, err := e.raw.Exec(ctx, `INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date,
			currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
			vat_breakdown, created_at, updated_at)
		VALUES ($1, $2, 'invoice', 'draft', NULL, $3, '2026-03-01', '2026-03-31', 'CHF', 'de', 'none', 0, 0, 0, 0, 0, 0, 0,
			'[]', now(), now())`, inv, b.workspace, cli); err != nil {
		t.Fatal(err)
	}
	base := "/api/v1/documents/" + d.ID
	e.fails(b, "POST", base+"/links", map[string]any{"type": "order", "id": inv}, 422, "validation_failed")
	e.fails(b, "POST", base+"/links", map[string]any{"type": "invoice", "id": "inv_missing"}, 422, "validation_failed")
	var got one[store.Document]
	e.do(b, "POST", base+"/links", map[string]any{"type": "invoice", "id": inv}, 201, &got)
	e.do(b, "POST", base+"/links", map[string]any{"type": "invoice", "id": inv}, 201, &got) // twice is a no-op
	if len(got.Data.Links) != 1 || got.Data.Links[0].Label != "Draft invoice" || got.Data.Links[0].Retains || got.Data.RetainedUntil != nil {
		t.Fatalf("draft link: %+v", got.Data)
	}

	// Issuing the invoice makes the file a business record until the end of 2036.
	if _, err := e.raw.Exec(ctx, `UPDATE invoices SET status = 'open', number = '2026-001' WHERE id = $1`, inv); err != nil {
		t.Fatal(err)
	}
	e.do(b, "GET", base, nil, 200, &got)
	if got.Data.RetainedUntil == nil || *got.Data.RetainedUntil != "2036-12-31" || got.Data.Links[0].Label != "Invoice 2026-001" ||
		!got.Data.Links[0].Retains {
		t.Fatalf("issued link: %+v", got.Data)
	}
	if out := e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{d.ID}, "folder_ids": []string{f.ID}}); out.Updated != 0 ||
		len(out.Skipped) != 2 {
		t.Fatalf("trash retained: %+v", out)
	}
	e.fails(b, "DELETE", base+"/links/invoice/"+inv, nil, 409, "retained")
	if _, raw := e.upload(b, "receipt.pdf", pdf+"replacement", "folder_id", f.ID, "on_conflict", "replace"); !strings.Contains(string(raw), "retained") {
		t.Fatalf("replace retained: %s", raw)
	}

	// Client links come and go.
	e.do(b, "POST", base+"/links", map[string]any{"type": "client", "id": cli}, 201, &got)
	e.do(b, "DELETE", base+"/links/client/"+cli, nil, 200, &got)
	if len(got.Data.Links) != 1 {
		t.Fatalf("after unlink: %+v", got.Data.Links)
	}
	e.fails(b, "DELETE", base+"/links/client/"+cli, nil, 404, "not_found")
}

func TestFreeName(t *testing.T) {
	taken := map[string]bool{"a.pdf": true, "a (2).pdf": true, ".env": true, "notes": true}
	for _, tc := range []struct {
		name    string
		keepExt bool
		want    string
	}{
		{"b.pdf", true, "b.pdf"},
		{"a.pdf", true, "a (3).pdf"},
		{".env", true, ".env (2)"},
		{"notes", false, "notes (2)"},
		{"a (2).pdf", true, "a (3).pdf"},
		{"x (draft).pdf", true, "x (draft).pdf"},
	} {
		if got := store.FreeName(tc.name, tc.keepExt, func(n string) bool { return taken[n] }); got != tc.want {
			t.Errorf("FreeName(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestDetectType(t *testing.T) {
	for _, tc := range []struct{ name, head, want string }{
		{"a.pdf", pdf, "application/pdf"},
		{"a.PNG", png, "image/png"},
		{"a.png", pdf, ""},
		{"a.docx", "PK\x03\x04", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{"a.doc", string(oleMagic), "application/msword"},
		{"a.doc", "PK\x03\x04", ""},
		{"a.xml", "<?xml version=\"1.0\"?>", "application/xml"},
		{"a.html", "<html>", ""},
		{"noext", "hello", ""},
	} {
		if got := detectType(tc.name, []byte(tc.head)); got != tc.want {
			t.Errorf("detectType(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
}

// The uploaded original of an invoice issued elsewhere stays while the invoice points at it, also once its ten
// years are over: deleting it forever broke on the foreign key and failed the whole Empty Trash.
func TestImportedInvoiceOriginalIsKept(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	d := e.uploaded(b, "original.pdf", pdf)
	cli := e.client(b, "Acme AG")
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO invoices (id, workspace_id, kind, status, origin, number, client_id,
			issue_date, due_date, currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total,
			total, rounding_amount, vat_breakdown, source_document_id, created_at, updated_at)
		VALUES ($1, $2, 'invoice', 'open', 'imported', 'EXT-1', $3, '2010-03-01', '2010-03-31', 'CHF', 'de', 'none', 0, 0, 0, 0,
			0, 0, 0, '[]', $4, now(), now())`, auth.NewID("inv"), b.workspace, cli, d.ID); err != nil {
		t.Fatal(err)
	}
	if out := e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{d.ID}}); out.Updated != 0 || len(out.Skipped) != 1 {
		t.Fatalf("trash an imported invoice's original: %+v", out)
	}
	var emptied one[map[string]int]
	e.do(b, "POST", "/api/v1/documents/trash/empty", nil, 200, &emptied)
}

// userFolders: the live folders people made (not the system folders).
func (e *env) userFolders(b *browser) []store.Folder {
	e.t.Helper()
	var all one[[]store.Folder]
	e.do(b, "GET", "/api/v1/documents/folders", nil, 200, &all)
	return slices.DeleteFunc(all.Data, func(f store.Folder) bool { return f.SystemKind != nil })
}
