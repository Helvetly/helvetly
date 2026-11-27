package clients

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/csv"
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
	"helvetly.com/api/internal/sitecheck"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// ---- a fake bucket ----

type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
	proxy   bool // S3_PROXY_DOWNLOADS
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

func (f *fakeStorage) PresignDownload(_ context.Context, key string, ttl time.Duration, _ string) (string, error) {
	return "https://s3.test/" + key + "?ttl=" + ttl.String(), nil
}

func (f *fakeStorage) ProxyDownloads() bool { return f.proxy }

func (f *fakeStorage) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

func (f *fakeStorage) keys() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var keys []string
	for k := range f.objects {
		keys = append(keys, k)
	}
	return keys
}

// ---- the test server ----

type env struct {
	t     *testing.T
	st    *store.Store
	srv   *httptest.Server
	files *fakeStorage
	svc   *Service
	raw   *pgxpool.Pool
}

func newEnv(t *testing.T) *env {
	t.Helper()
	return newEnvWith(t, nil)
}

// newEnvWith is newEnv with a UID register (nil: none).
func newEnvWith(t *testing.T, register Register) *env {
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
	mux := http.NewServeMux()
	a.Register(mux)
	svc := New(st, a, files, discard)
	if register != nil {
		svc.SetRegister(register)
	}
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, srv: srv, files: files, svc: svc, raw: raw}
}

// browser is a signed-in person: their session cookie and CSRF token.
type browser struct{ token, csrf, workspace string }

// workspace makes a workspace with an owner and returns the owner's browser.
func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, "owner")
}

// join adds a new person to the workspace with the role and signs them in.
func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna " + role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws}
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

// send makes a request; body is JSON unless it is already a *bytes.Buffer (with contentType).
func (e *env) send(b *browser, method, path string, body any, contentType string) (*http.Response, []byte) {
	e.t.Helper()
	var rd io.Reader
	switch v := body.(type) {
	case nil:
	case *bytes.Buffer:
		rd = v
	case string:
		rd, contentType = strings.NewReader(v), "application/json"
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

// do sends JSON and decodes the answer into out, failing unless the status is want.
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
			Fields map[string]string `json:"fields"`
		} `json:"details"`
	} `json:"error"`
}

// fails sends the request and checks the error code (and, for validation, which fields).
func (e *env) fails(b *browser, method, path string, body any, status int, code string, fields ...string) {
	e.t.Helper()
	var out apiErr
	e.do(b, method, path, body, status, &out)
	if out.Error.Code != code {
		e.t.Fatalf("%s %s: code %q, want %q", method, path, out.Error.Code, code)
	}
	got := []string{}
	for f := range out.Error.Details.Fields {
		got = append(got, f)
	}
	slices.Sort(got)
	slices.Sort(fields)
	if len(fields) > 0 && !slices.Equal(got, fields) {
		e.t.Fatalf("%s %s: invalid fields %v, want %v", method, path, out.Error.Details.Fields, fields)
	}
}

func (e *env) create(b *browser, body map[string]any) store.Client {
	e.t.Helper()
	var out struct{ Data store.Client }
	e.do(b, "POST", "/api/v1/clients", body, 201, &out)
	return out.Data
}

type listOut struct {
	Data []store.Client
	Meta struct {
		Page       int `json:"page"`
		PageSize   int `json:"page_size"`
		Total      int `json:"total"`
		TotalPages int `json:"total_pages"`
	}
}

func (e *env) list(b *browser, query string) listOut {
	e.t.Helper()
	var out listOut
	e.do(b, "GET", "/api/v1/clients?"+query, nil, 200, &out)
	return out
}

func numbers(list []store.Client) []int64 {
	n := []int64{}
	for _, c := range list {
		n = append(n, c.Number)
	}
	return n
}

func address(name string) map[string]any {
	return map[string]any{"name": name, "street": "Bahnhofstrasse", "street_number": "1", "zip": "8001", "city": "Zürich", "country": "CH"}
}

// ---- tests ----

func TestCreate(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()

	c := e.create(b, map[string]any{"name": "  Anna Muster ", "email": " Anna@Example.CH ", "phone": "+41 44 123 45 67",
		"preferred_name": "   ", "website": "anna.ch", "vat_number": "che123456788mwst", "language": "DE", "currency": "chf",
		"payment_terms_days": 10, "tags": []string{"VIP", " Zuerich "}, "country": "ch"})
	if !strings.HasPrefix(c.ID, "cli_") || c.Number != 1 || c.Name != "Anna Muster" || *c.Email != "anna@example.ch" ||
		*c.Phone != "+41441234567" || c.PreferredName != nil || *c.Website != "https://anna.ch" ||
		*c.VATNumber != "CHE-123.456.788 MWST" || *c.Language != "de" || *c.Currency != "CHF" || *c.PaymentTermsDays != 10 ||
		!slices.Equal(c.Tags, []string{"VIP", "Zuerich"}) || *c.Country != "CH" || c.IsCompany || !c.IsActive ||
		!c.IsDraft || !slices.Equal(c.MissingFields, []string{"street", "street_number", "zip", "city"}) ||
		len(c.Contacts) != 0 || c.FilesCount != 0 || c.CreatedAt.IsZero() {
		t.Fatalf("created: %+v", c)
	}
	if de := e.create(b, map[string]any{"name": "Stadt Bonn", "einvoice_format": "xrechnung_ubl", "leitweg_id": "991-33333test-33"}); de.EInvoiceFormat != "xrechnung_ubl" || *de.LeitwegID != "991-33333TEST-33" {
		t.Fatalf("e-invoice settings: %+v", de)
	}
	if c.EInvoiceFormat != "none" || c.LeitwegID != nil {
		t.Fatalf("e-invoice defaults: %+v", c)
	}
	if done := e.create(b, address("Complete AG")); done.IsDraft || len(done.MissingFields) != 0 || done.Number != 3 {
		t.Fatalf("complete client: %+v", done)
	}

	for _, tc := range []struct {
		name   string
		body   any
		status int
		code   string
		fields []string
	}{
		{"no name", map[string]any{"email": "a@example.com"}, 422, "validation_failed", []string{"name"}},
		{"blank name", map[string]any{"name": "   "}, 422, "validation_failed", []string{"name"}},
		{"null name", map[string]any{"name": nil}, 422, "validation_failed", []string{"name"}},
		{"long name", map[string]any{"name": strings.Repeat("a", 201)}, 422, "validation_failed", []string{"name"}},
		{"many errors", map[string]any{"name": "A", "email": "nope", "billing_email": "x@", "phone": "044 123", "country": "XX",
			"website": "ftp://x.ch", "vat_number": "CHE-123.456.789", "language": "es", "currency": "XYZ", "payment_terms_days": 400,
			"tags": []string{"a", "A"}, "note": strings.Repeat("n", 1001), "internal_id": strings.Repeat("i", 101),
			"is_company": "yes"}, 422, "validation_failed",
			[]string{"email", "billing_email", "phone", "country", "website", "vat_number", "language", "currency",
				"payment_terms_days", "tags", "note", "internal_id", "is_company"}},
		{"name not text", map[string]any{"name": 12}, 422, "validation_failed", []string{"name"}},
		{"e-invoice settings", map[string]any{"name": "A", "einvoice_format": "pdf", "leitweg_id": "04011000-1234512345-07"},
			422, "validation_failed", []string{"einvoice_format", "leitweg_id"}},
		{"null e-invoice format", map[string]any{"name": "A", "einvoice_format": nil}, 422, "validation_failed",
			[]string{"einvoice_format"}},
		{"unknown field", map[string]any{"name": "A", "isCorporate": true}, 400, "invalid_request", nil},
		{"read-only field", map[string]any{"name": "A", "number": 7}, 400, "invalid_request", nil},
		{"not an object", `["A"]`, 400, "invalid_request", nil},
	} {
		t.Run(tc.name, func(t *testing.T) { e.fails(b, "POST", "/api/v1/clients", tc.body, tc.status, tc.code, tc.fields...) })
	}
	if n := e.list(b, "").Meta.Total; n != 3 {
		t.Fatalf("refused creates were saved: %d clients", n)
	}
}

func TestNumbering(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	var last store.Client
	for i := range 3 {
		if last = e.create(b, map[string]any{"name": fmt.Sprint("Client ", i)}); last.Number != int64(i+1) {
			t.Fatalf("client %d got number %d", i, last.Number)
		}
	}
	e.do(b, "DELETE", "/api/v1/clients/"+last.ID, nil, 204, nil)
	if c := e.create(b, map[string]any{"name": "After delete"}); c.Number != 4 {
		t.Fatalf("number after delete = %d, want 4 (never reused)", c.Number)
	}
	if c := e.create(other, map[string]any{"name": "Elsewhere"}); c.Number != 1 {
		t.Fatalf("another workspace starts at %d", c.Number)
	}
}

func TestList(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	seed := []map[string]any{
		{"name": "Jane Doe", "email": "jane@doe.ch", "city": "Bern"},    // 1 person, draft
		{"name": "Alpha AG", "is_company": true, "internal_id": "K-12"}, // 2 company, draft
		address("zeta GmbH"), // 3 person, complete
		{"name": "Inactive Ltd", "is_active": false, "preferred_name": "Jane's old firm"},                                            // 4 inactive, draft
		{"name": "100% Café_Bar", "vat_number": "DE123456789", "city": "Basel"},                                                      // 5
		{"name": "Twelve", "note": "the 12th"},                                                                                       // 6
		{"name": "Bistro 12", "is_company": true, "street": "A", "street_number": "1", "zip": "1", "city": "Aarau", "country": "CH"}, // 7 complete company
	}
	for _, body := range seed {
		e.create(b, body)
	}
	e.create(e.workspace(), map[string]any{"name": "Jane Elsewhere"})

	for _, tc := range []struct {
		query string
		want  []int64
	}{
		{"", []int64{7, 6, 5, 4, 3, 2, 1}},
		{"sort=number", []int64{1, 2, 3, 4, 5, 6, 7}},
		{"sort=-number", []int64{7, 6, 5, 4, 3, 2, 1}},
		{"sort=name", []int64{5, 2, 7, 4, 1, 6, 3}}, // case-insensitive: "zeta" last
		{"sort=city&search=b", []int64{7, 5, 1, 3}}, // Aarau, Basel, Bern, Zürich
		{"sort=created_at", []int64{1, 2, 3, 4, 5, 6, 7}},
		{"search=jane", []int64{4, 1}},  // name or preferred name, ignoring case
		{"search=DOE.CH", []int64{1}},   // email
		{"search=k-12", []int64{2}},     // internal id
		{"search=de1234", []int64{5}},   // vat number
		{"search=bern", []int64{1}},     // city
		{"search=12", []int64{7, 5, 2}}, // name, vat number, internal id; not the note
		{"search=%25", []int64{5}},      // a literal %, not a wildcard
		{"search=_", []int64{5}},        // a literal _
		{"search=%2312", []int64{}},     // "#12": no client 12, and no text contains "#12"
		{"search=%233", []int64{3}},     // "#3": number 3
		{"search=3", []int64{5, 3}},     // digits: number 3, and the vat number containing 3
		{"search=nobody", []int64{}},
		{"status=active", []int64{7, 6, 5, 3, 2, 1}},
		{"status=inactive", []int64{4}},
		{"status=draft", []int64{6, 5, 4, 2, 1}},
		{"status=complete", []int64{7, 3}},
		{"status=active&status=inactive", []int64{7, 6, 5, 4, 3, 2, 1}},
		{"status=complete&status=active&type=company", []int64{7}},
		{"status=draft,inactive", []int64{4}},
		{"type=company", []int64{7, 2}},
		{"type=person&sort=number", []int64{1, 3, 4, 5, 6}},
		{"country=ch", []int64{7, 3}},
		{"search=jane&type=company", []int64{}},
		{"name=JANE", []int64{4, 1}},               // name or preferred name, ignoring case
		{"name=jane&city=bern", []int64{1}},        // every field filter holds
		{"name=%25", []int64{5}},                   // a literal %, not a wildcard
		{"name=+++", []int64{7, 6, 5, 4, 3, 2, 1}}, // blank: no filter
		{"email=doe.ch", []int64{1}},
		{"email=alpha", []int64{}}, // not the name
		{"city=BA", []int64{5}},    // Basel; not "Aarau"'s other letters
		{"city=a&type=company", []int64{7}},
		{"name=12&search=bistro", []int64{7}}, // with the free search
		{"created_from=2000-01-01&type=company", []int64{7, 2}},
		{"created_from=2999-01-01", []int64{}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			if got := numbers(e.list(b, tc.query).Data); !slices.Equal(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}

	p := e.list(b, "page=2&page_size=3&sort=number")
	if !slices.Equal(numbers(p.Data), []int64{4, 5, 6}) || p.Meta.Page != 2 || p.Meta.PageSize != 3 || p.Meta.Total != 7 || p.Meta.TotalPages != 3 {
		t.Fatalf("page 2: %v %+v", numbers(p.Data), p.Meta)
	}
	if p := e.list(b, "page=9"); len(p.Data) != 0 || p.Meta.Total != 7 || p.Meta.TotalPages != 1 || p.Meta.PageSize != 50 {
		t.Fatalf("past the end: %+v", p.Meta)
	}

	for _, q := range []string{"sort=deleted_at", "sort=name%27--", "sort=lower(name)", "status=archived", "type=robot", "page=0",
		"page_size=201", "page=x", "country=XX", "created_from=2026-02-30", "created_from=yesterday", "name=" + strings.Repeat("a", 201), "city=" + strings.Repeat("b", 201)} {
		e.fails(b, "GET", "/api/v1/clients?"+q, nil, 400, "invalid_request")
	}
}

func TestGetUpdateDelete(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, map[string]any{"name": "Draft SA", "email": "draft@example.ch", "note": "keep"})
	path := "/api/v1/clients/" + c.ID

	var got struct{ Data store.Client }
	e.do(b, "GET", path, nil, 200, &got)
	if got.Data.ID != c.ID || got.Data.Name != "Draft SA" {
		t.Fatalf("get: %+v", got.Data)
	}

	// Filling the address completes the draft; absent keys stay as they were.
	e.do(b, "PATCH", path, map[string]any{"street": "Rue du Lac", "street_number": "3", "zip": "1201", "city": "Genève",
		"country": "ch", "is_company": true}, 200, &got)
	if got.Data.IsDraft || len(got.Data.MissingFields) != 0 || *got.Data.Email != "draft@example.ch" || *got.Data.Note != "keep" ||
		!got.Data.IsCompany || !got.Data.UpdatedAt.After(c.UpdatedAt) {
		t.Fatalf("completed: %+v", got.Data)
	}
	// Null and blank both clear; clearing an address field makes it a draft again.
	e.do(b, "PATCH", path, map[string]any{"email": nil, "zip": "  ", "tags": []string{"x"}}, 200, &got)
	if got.Data.Email != nil || got.Data.Zip != nil || !got.Data.IsDraft || !slices.Equal(got.Data.MissingFields, []string{"zip"}) ||
		*got.Data.Note != "keep" || *got.Data.City != "Genève" {
		t.Fatalf("cleared: %+v", got.Data)
	}
	e.do(b, "PATCH", path, map[string]any{"tags": nil, "name": " Renamed "}, 200, &got)
	if len(got.Data.Tags) != 0 || got.Data.Name != "Renamed" {
		t.Fatalf("tags cleared: %+v", got.Data)
	}
	e.fails(b, "PATCH", path, map[string]any{"name": nil}, 422, "validation_failed", "name")
	e.fails(b, "PATCH", path, map[string]any{"name": ""}, 422, "validation_failed", "name")
	e.fails(b, "PATCH", path, map[string]any{"is_active": nil}, 422, "validation_failed", "is_active")
	e.fails(b, "PATCH", path, map[string]any{"id": "cli_other"}, 400, "invalid_request")
	e.fails(b, "PATCH", "/api/v1/clients/cli_nope", map[string]any{"name": "X"}, 404, "not_found")
	e.fails(b, "GET", "/api/v1/clients/cli_nope", nil, 404, "not_found")

	// Soft delete hides the client everywhere.
	e.do(b, "DELETE", path, nil, 204, nil)
	e.fails(b, "GET", path, nil, 404, "not_found")
	e.fails(b, "PATCH", path, map[string]any{"name": "Back"}, 404, "not_found")
	e.fails(b, "DELETE", path, nil, 404, "not_found")
	e.fails(b, "GET", path+"/files", nil, 404, "not_found")
	if l := e.list(b, ""); l.Meta.Total != 0 {
		t.Fatalf("deleted client still listed: %+v", l)
	}
}

func TestIsolationAndPermissions(t *testing.T) {
	e := newEnv(t)
	owner, intruder := e.workspace(), e.workspace()
	admin, member := e.join(owner.workspace, "admin"), e.join(owner.workspace, "member")
	c := e.create(owner, map[string]any{"name": "Private AG"})
	path := "/api/v1/clients/" + c.ID

	// Another workspace sees nothing.
	if l := e.list(intruder, ""); l.Meta.Total != 0 {
		t.Fatalf("intruder lists %v", numbers(l.Data))
	}
	for _, r := range []struct{ method, path string }{{"GET", path}, {"PATCH", path}, {"DELETE", path}, {"GET", path + "/files"},
		{"POST", path + "/contacts"}, {"GET", path + "/files/fil_x"}} {
		e.fails(intruder, r.method, r.path, map[string]any{"name": "Mine"}, 404, "not_found")
	}
	var bulk struct{ Data struct{ Updated int } }
	e.do(intruder, "POST", "/api/v1/clients/bulk", map[string]any{"ids": []string{c.ID}, "action": "delete"}, 200, &bulk)
	if bulk.Data.Updated != 0 {
		t.Fatal("intruder bulk-deleted a client")
	}

	// Members read, create and update, but do not delete.
	e.do(member, "PATCH", path, map[string]any{"note": "member was here"}, 200, nil)
	e.create(member, map[string]any{"name": "By member"})
	e.fails(member, "DELETE", path, nil, 403, "forbidden")
	e.fails(member, "POST", "/api/v1/clients/bulk", map[string]any{"ids": []string{c.ID}, "action": "delete"}, 403, "forbidden")
	e.do(member, "POST", "/api/v1/clients/bulk", map[string]any{"ids": []string{c.ID}, "action": "deactivate"}, 200, nil)
	e.do(admin, "DELETE", path, nil, 204, nil)

	// Writes need the session's CSRF token; everything needs a session.
	forged := &browser{token: owner.token, csrf: "wrong"}
	for _, r := range []struct{ method, path string }{{"POST", "/api/v1/clients"}, {"PATCH", path}, {"DELETE", path},
		{"POST", "/api/v1/clients/bulk"}, {"POST", path + "/files"}, {"POST", path + "/contacts"}} {
		e.fails(forged, r.method, r.path, map[string]any{"name": "X"}, 403, "csrf_failed")
		e.fails(nil, r.method, r.path, map[string]any{"name": "X"}, 401, "unauthenticated")
	}
	e.fails(nil, "GET", "/api/v1/clients", nil, 401, "unauthenticated")
	e.fails(nil, "GET", "/api/v1/clients/export", nil, 401, "unauthenticated")
}

func TestBulk(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	a, c, d := e.create(b, map[string]any{"name": "A"}), e.create(b, map[string]any{"name": "C"}), e.create(b, map[string]any{"name": "D"})
	var out struct{ Data struct{ Updated int } }

	e.do(b, "POST", "/api/v1/clients/bulk", map[string]any{"ids": []string{a.ID, c.ID, "cli_missing"}, "action": "deactivate"}, 200, &out)
	if out.Data.Updated != 2 || !slices.Equal(numbers(e.list(b, "status=inactive&sort=number").Data), []int64{1, 2}) {
		t.Fatalf("deactivate: %+v", out)
	}
	e.do(b, "POST", "/api/v1/clients/bulk", map[string]any{"ids": []string{a.ID}, "action": "activate"}, 200, &out)
	if out.Data.Updated != 1 || !slices.Equal(numbers(e.list(b, "status=active&sort=number").Data), []int64{1, 3}) {
		t.Fatalf("activate: %+v", out)
	}
	e.do(b, "POST", "/api/v1/clients/bulk", map[string]any{"ids": []string{a.ID, d.ID}, "action": "delete"}, 200, &out)
	if out.Data.Updated != 2 || !slices.Equal(numbers(e.list(b, "").Data), []int64{2}) {
		t.Fatalf("delete: %+v", out)
	}

	many := make([]string, 501)
	for i := range many {
		many[i] = "cli_x"
	}
	for _, tc := range []struct {
		body   any
		status int
		code   string
		fields []string
	}{
		{map[string]any{"ids": []string{}, "action": "activate"}, 422, "validation_failed", []string{"ids"}},
		{map[string]any{"ids": many, "action": "activate"}, 422, "validation_failed", []string{"ids"}},
		{map[string]any{"ids": []string{a.ID}, "action": "archive"}, 422, "validation_failed", []string{"action"}},
		{map[string]any{"ids": []string{a.ID}}, 422, "validation_failed", []string{"action"}},
		{map[string]any{"ids": []string{a.ID}, "action": "activate", "all": true}, 400, "invalid_request", nil},
	} {
		e.fails(b, "POST", "/api/v1/clients/bulk", tc.body, tc.status, tc.code, tc.fields...)
	}
}

func (e *env) export(b *browser, query string) [][]string {
	e.t.Helper()
	resp, raw := e.send(b, "GET", "/api/v1/clients/export?"+query, nil, "")
	want := `attachment; filename="clients-` + time.Now().UTC().Format(time.DateOnly) + `.csv"`
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/csv; charset=utf-8" || resp.Header.Get("Content-Disposition") != want {
		e.t.Fatalf("export: %d %v: %s", resp.StatusCode, resp.Header, raw)
	}
	rows, err := csv.NewReader(bytes.NewReader(raw)).ReadAll()
	if err != nil {
		e.t.Fatalf("export is not CSV: %v: %s", err, raw)
	}
	if !slices.Equal(rows[0], csvHeader) {
		e.t.Fatalf("header: %v", rows[0])
	}
	return rows[1:]
}

func TestExport(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	tricky := e.create(b, map[string]any{"name": `Muster, "Anna"`, "note": "line one\nline two", "internal_id": "=HYPERLINK(1)",
		"phone": "+41441234567", "tags": []string{"VIP", "B2B"}, "payment_terms_days": 30, "is_company": true})
	e.create(b, address("Complete AG"))
	e.create(b, map[string]any{"name": "Gone"})
	e.do(b, "DELETE", "/api/v1/clients/"+e.list(b, "search=gone").Data[0].ID, nil, 204, nil)
	e.do(b, "POST", "/api/v1/clients/"+tricky.ID+"/contacts", map[string]any{"name": "Petra Primary"}, 201, nil)

	rows := e.export(b, "sort=number")
	if len(rows) != 2 {
		t.Fatalf("rows: %v", rows)
	}
	col := func(row []string, name string) string { return row[slices.Index(csvHeader, name)] }
	r := rows[0]
	for name, want := range map[string]string{"number": "1", "name": `Muster, "Anna"`, "note": "line one\nline two",
		"internal_id": "'=HYPERLINK(1)", "phone": "+41441234567", "tags": "VIP;B2B", "payment_terms_days": "30", "type": "company",
		"active": "true", "draft": "true", "primary_contact": "Petra Primary", "email": "", "created_at": tricky.CreatedAt.Format(time.RFC3339)} {
		if got := col(r, name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	if col(rows[1], "draft") != "false" || col(rows[1], "type") != "person" || col(rows[1], "city") != "Zürich" {
		t.Errorf("complete row: %v", rows[1])
	}

	if rows := e.export(b, "status=complete"); len(rows) != 1 || rows[0][1] != "Complete AG" {
		t.Errorf("filtered: %v", rows)
	}
	if rows := e.export(b, "search=muster"); len(rows) != 1 {
		t.Errorf("searched: %v", rows)
	}
	if rows := e.export(b, "ids="+tricky.ID+",cli_missing"); len(rows) != 1 || rows[0][0] != "1" {
		t.Errorf("by ids: %v", rows)
	}
	if rows := e.export(e.workspace(), ""); len(rows) != 0 {
		t.Errorf("another workspace exported %v", rows)
	}
	e.fails(b, "GET", "/api/v1/clients/export?sort=password", nil, 400, "invalid_request")
}

func TestTagsAndCountries(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.create(b, map[string]any{"name": "One", "tags": []string{"VIP", "Zuerich"}, "country": "CH"})
	e.create(b, map[string]any{"name": "Two", "tags": []string{"vip"}, "country": "DE"})
	e.create(b, map[string]any{"name": "Three", "tags": []string{"Zuerich", "B2B", "vip"}, "country": "AT"})
	gone := e.create(b, map[string]any{"name": "Gone", "tags": []string{"Gone"}})
	e.do(b, "DELETE", "/api/v1/clients/"+gone.ID, nil, 204, nil)
	e.create(e.workspace(), map[string]any{"name": "Elsewhere", "tags": []string{"VIP"}})

	var tags struct{ Data []store.TagCount }
	e.do(b, "GET", "/api/v1/clients/tags", nil, 200, &tags)
	want := []store.TagCount{{Name: "VIP", Count: 3}, {Name: "Zuerich", Count: 2}, {Name: "B2B", Count: 1}}
	if !slices.Equal(tags.Data, want) {
		t.Fatalf("tags: %+v", tags.Data)
	}

	for _, tc := range []struct {
		query string
		want  []int64
	}{
		{"tag=vip&sort=number", []int64{1, 2, 3}},
		{"tag=VIP&tag=zuerich&sort=number", []int64{1, 3}},
		{"tag=" + url.QueryEscape("ZUERICH") + "&tag=b2b", []int64{3}},
		{"tag=nothing", []int64{}},
		{"country=CH&country=at&sort=number", []int64{1, 3}},
		{"country=DE,AT&sort=number", []int64{2, 3}},
		{"country=AT&tag=vip", []int64{3}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			if got := numbers(e.list(b, tc.query).Data); !slices.Equal(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestContacts(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, map[string]any{"name": "Contacts AG", "is_company": true})
	base := "/api/v1/clients/" + c.ID + "/contacts"
	add := func(body map[string]any) store.Contact {
		var out struct{ Data store.Contact }
		e.do(b, "POST", base, body, 201, &out)
		return out.Data
	}
	contacts := func() []store.Contact {
		var out struct{ Data store.Client }
		e.do(b, "GET", "/api/v1/clients/"+c.ID, nil, 200, &out)
		return out.Data.Contacts
	}
	primaries := func() []string {
		var names []string
		for _, k := range contacts() {
			if k.IsPrimary {
				names = append(names, k.Name)
			}
		}
		return names
	}

	first := add(map[string]any{"name": " Petra ", "role": "CFO", "email": "Petra@Contacts.CH", "phone": "+41 79 123 45 67"})
	if !strings.HasPrefix(first.ID, "con_") || !first.IsPrimary || first.Name != "Petra" || *first.Email != "petra@contacts.ch" ||
		*first.Phone != "+41791234567" || *first.Role != "CFO" {
		t.Fatalf("first contact: %+v", first)
	}
	second := add(map[string]any{"name": "Marco"})
	if second.IsPrimary {
		t.Fatal("second contact became primary")
	}
	third := add(map[string]any{"name": "Lea", "is_primary": true})
	if !third.IsPrimary || !slices.Equal(primaries(), []string{"Lea"}) || contacts()[0].Name != "Lea" {
		t.Fatalf("new primary: %v %+v", primaries(), contacts())
	}

	// Switching primary unsets the others; a primary cannot simply be unset.
	var out struct{ Data store.Contact }
	e.do(b, "PATCH", base+"/"+second.ID, map[string]any{"is_primary": true, "role": "Sales"}, 200, &out)
	if !out.Data.IsPrimary || *out.Data.Role != "Sales" || !slices.Equal(primaries(), []string{"Marco"}) {
		t.Fatalf("switched: %+v %v", out.Data, primaries())
	}
	e.do(b, "PATCH", base+"/"+second.ID, map[string]any{"is_primary": true}, 200, nil)
	e.fails(b, "PATCH", base+"/"+second.ID, map[string]any{"is_primary": false}, 422, "validation_failed", "is_primary")
	e.do(b, "PATCH", base+"/"+first.ID, map[string]any{"is_primary": false, "role": nil}, 200, &out)
	if out.Data.IsPrimary || out.Data.Role != nil || !slices.Equal(primaries(), []string{"Marco"}) {
		t.Fatalf("unset non-primary: %+v", out.Data)
	}

	// Search finds clients by their contacts.
	if got := numbers(e.list(b, "search=PETRA@").Data); !slices.Equal(got, []int64{1}) {
		t.Fatalf("search by contact email: %v", got)
	}
	if got := numbers(e.list(b, "search=lea").Data); !slices.Equal(got, []int64{1}) {
		t.Fatalf("search by contact name: %v", got)
	}

	// Deleting the primary promotes the oldest remaining contact.
	e.do(b, "DELETE", base+"/"+second.ID, nil, 204, nil)
	if !slices.Equal(primaries(), []string{"Petra"}) {
		t.Fatalf("after deleting primary: %v", primaries())
	}
	e.do(b, "DELETE", base+"/"+third.ID, nil, 204, nil)
	e.do(b, "DELETE", base+"/"+first.ID, nil, 204, nil)
	if len(contacts()) != 0 {
		t.Fatal("contacts left")
	}
	e.fails(b, "DELETE", base+"/"+first.ID, nil, 404, "not_found")
	e.fails(b, "PATCH", base+"/"+first.ID, map[string]any{"name": "X"}, 404, "not_found")
	if again := add(map[string]any{"name": "Again"}); !again.IsPrimary {
		t.Fatal("first contact after emptying is not primary")
	}

	for _, tc := range []struct {
		body   any
		status int
		code   string
		fields []string
	}{
		{map[string]any{"role": "CEO"}, 422, "validation_failed", []string{"name"}},
		{map[string]any{"name": "X", "email": "nope", "phone": "123", "role": strings.Repeat("r", 101)}, 422, "validation_failed",
			[]string{"email", "phone", "role"}},
		{map[string]any{"name": "X", "is_primary": "yes"}, 422, "validation_failed", []string{"is_primary"}},
		{map[string]any{"name": "X", "client_id": "cli_other"}, 400, "invalid_request", nil},
	} {
		e.fails(b, "POST", base, tc.body, tc.status, tc.code, tc.fields...)
	}
	// A member may manage contacts.
	e.do(e.join(b.workspace, "member"), "POST", base, map[string]any{"name": "By member"}, 201, nil)
}

type fileOut struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
	UploadedBy  struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"uploaded_by"`
	CreatedAt  time.Time `json:"created_at"`
	LockedTags []string  `json:"locked_tags"`
}

// multipartBody builds a files[] upload of name → content.
func multipartBody(t *testing.T, files ...[2]string) (*bytes.Buffer, string) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, f := range files {
		w, err := mw.CreateFormFile("files[]", f[0])
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(f[1]))
	}
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func TestFiles(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, map[string]any{"name": "Files AG"})
	base := "/api/v1/clients/" + c.ID + "/files"
	pdf, png := "%PDF-1.7\nhello", "\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"

	upload := func(want int, files ...[2]string) []byte {
		body, ct := multipartBody(t, files...)
		resp, raw := e.send(b, "POST", base, body, ct)
		if resp.StatusCode != want {
			t.Fatalf("upload: %d, want %d: %s", resp.StatusCode, want, raw)
		}
		return raw
	}
	var created struct{ Data []fileOut }
	if err := json.Unmarshal(upload(201, [2]string{"Offerte 2026.pdf", pdf}, [2]string{"logo.png", png}), &created); err != nil {
		t.Fatal(err)
	}
	if len(created.Data) != 2 || !strings.HasPrefix(created.Data[0].ID, "fil_") || created.Data[0].Name != "Offerte 2026.pdf" ||
		created.Data[0].Size != int64(len(pdf)) || created.Data[0].ContentType != "application/pdf" ||
		created.Data[1].ContentType != "image/png" || created.Data[0].UploadedBy.Name != "Anna owner" {
		t.Fatalf("uploaded: %+v", created.Data)
	}
	wantKey := "workspaces/" + b.workspace + "/clients/" + c.ID + "/" + created.Data[0].ID + "/Offerte_2026.pdf"
	if keys := e.files.keys(); len(keys) != 2 || !slices.Contains(keys, wantKey) {
		t.Fatalf("stored keys %v, want %s", keys, wantKey)
	}

	// Nothing is stored when any file in the batch is refused.
	for _, tc := range []struct {
		name  string
		files [][2]string
	}{
		{"none", nil},
		{"executable", [][2]string{{"ok.pdf", pdf}, {"tool.exe", "MZ\x90\x00"}}},
		{"renamed", [][2]string{{"fake.pdf", "just text"}}},
		{"too large", [][2]string{{"big.pdf", pdf + strings.Repeat("x", maxFileSize)}}},
		{"too many", slices.Repeat([][2]string{{"a.txt", "a"}}, maxFiles+1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out apiErr
			if err := json.Unmarshal(upload(422, tc.files...), &out); err != nil || out.Error.Code != "validation_failed" ||
				out.Error.Details.Fields["files"] == "" {
				t.Fatalf("refusal: %+v %v", out, err)
			}
			if n := len(e.files.keys()); n != 2 {
				t.Fatalf("%d objects stored", n)
			}
		})
	}
	e.fails(b, "POST", base, map[string]any{"files": []string{"x"}}, 400, "invalid_request")

	var list struct{ Data []fileOut }
	upload(201, [2]string{"later.txt", "newest"})
	e.do(b, "GET", base, nil, 200, &list)
	if len(list.Data) != 3 || list.Data[0].Name != "later.txt" {
		t.Fatalf("list: %+v", list.Data)
	}
	// The list carries each file's kind tag, which the Files tab groups by.
	if err := e.st.SetDocumentKind(context.Background(), b.workspace, created.Data[0].ID, "contract", time.Now()); err != nil {
		t.Fatal(err)
	}
	e.do(b, "GET", base, nil, 200, &list)
	if i := slices.IndexFunc(list.Data, func(f fileOut) bool { return f.ID == created.Data[0].ID }); i < 0 ||
		!slices.Contains(list.Data[i].LockedTags, "contract") {
		t.Fatalf("kind tags: %+v", list.Data)
	}
	var got struct{ Data store.Client }
	e.do(b, "GET", "/api/v1/clients/"+c.ID, nil, 200, &got)
	if got.Data.FilesCount != 3 {
		t.Fatalf("files_count = %d", got.Data.FilesCount)
	}

	// Download redirects to a short-lived link.
	resp, _ := e.send(b, "GET", base+"/"+created.Data[0].ID, nil, "")
	if resp.StatusCode != 302 || resp.Header.Get("Location") != "https://s3.test/"+wantKey+"?ttl=5m0s" {
		t.Fatalf("download: %d %q", resp.StatusCode, resp.Header.Get("Location"))
	}
	e.fails(b, "GET", base+"/fil_missing", nil, 404, "not_found")
	// With S3_PROXY_DOWNLOADS the API streams the bytes itself.
	e.files.proxy = true
	resp, body := e.send(b, "GET", base+"/"+created.Data[0].ID, nil, "")
	if resp.StatusCode != 200 || string(body) != pdf || resp.Header.Get("Content-Type") != "application/pdf" ||
		resp.Header.Get("Content-Disposition") != `attachment; filename="Offerte 2026.pdf"` {
		t.Fatalf("proxied download: %d %v %q", resp.StatusCode, resp.Header, body)
	}
	e.files.proxy = false

	// Delete moves the file to the Documents Trash, so its object stays; a member may do it.
	e.do(e.join(b.workspace, "member"), "DELETE", base+"/"+created.Data[0].ID, nil, 204, nil)
	if d, err := e.st.Document(context.Background(), b.workspace, created.Data[0].ID); err != nil || d.DeletedAt == nil ||
		!slices.Contains(e.files.keys(), wantKey) {
		t.Fatalf("after delete: %+v (%v), keys %v", d, err, e.files.keys())
	}
	e.fails(b, "DELETE", base+"/"+created.Data[0].ID, nil, 404, "not_found")
	e.fails(b, "GET", base+"/"+created.Data[0].ID, nil, 404, "not_found")

	// Deleting the client keeps its files' objects (and hides them).
	e.do(b, "DELETE", "/api/v1/clients/"+c.ID, nil, 204, nil)
	if n := len(e.files.keys()); n != 3 {
		t.Fatalf("%d objects after deleting the client, want 3 kept", n)
	}
	e.fails(b, "GET", base+"/"+created.Data[1].ID, nil, 404, "not_found")
}

// Files of up to 25 MB each, but no request over the 95 MB the frontend packs, under Cloudflare's 100 MB.
func TestFilesRequestLimit(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, map[string]any{"name": "Big files AG"})
	filler := strings.Repeat("x", maxFileSize-512<<10)
	files := make([][2]string, 5)
	for i := range files {
		files[i] = [2]string{fmt.Sprintf("part-%d.pdf", i), fmt.Sprintf("%%PDF-1.7\n%d", i) + filler}
	}
	body, ct := multipartBody(t, files...)
	resp, raw := e.send(b, "POST", "/api/v1/clients/"+c.ID+"/files", body, ct)
	var out apiErr
	if err := json.Unmarshal(raw, &out); err != nil || resp.StatusCode != http.StatusRequestEntityTooLarge ||
		out.Error.Code != "payload_too_large" || !strings.Contains(string(raw), "95 MB") {
		t.Fatalf("over the request limit: %d %s", resp.StatusCode, raw)
	}
	if n := len(e.files.keys()); n != 0 {
		t.Fatalf("%d objects stored", n)
	}
	body, ct = multipartBody(t, files[:3]...) // 73.5 MB in one request still fits
	if resp, raw := e.send(b, "POST", "/api/v1/clients/"+c.ID+"/files", body, ct); resp.StatusCode != http.StatusCreated {
		t.Fatalf("under the request limit: %d %s", resp.StatusCode, raw)
	}
}

// stubSites answers like sitecheck without the network: one known site, everything else unreachable.
type stubSites struct{}

func (stubSites) Resolve(_ context.Context, text string) (string, error) {
	if text == "alpenglow.ch" {
		return "https://www.alpenglow.ch", nil
	}
	return "", &sitecheck.Error{Message: "We couldn't reach " + text + "."}
}

func TestCheckWebsite(t *testing.T) {
	e := newEnv(t)
	e.svc.site = stubSites{}
	owner := e.workspace()
	var out struct{ Data struct{ Website string } }
	e.do(owner, "POST", "/api/v1/clients/website-check", map[string]any{"website": "alpenglow.ch"}, 200, &out)
	if out.Data.Website != "https://www.alpenglow.ch" {
		t.Fatalf("website = %q", out.Data.Website)
	}
	var failed apiErr
	e.do(owner, "POST", "/api/v1/clients/website-check", map[string]any{"website": "gone.ch"}, 422, &failed)
	if failed.Error.Details.Fields["website"] != "We couldn't reach gone.ch." {
		t.Fatalf("fields = %v", failed.Error.Details.Fields)
	}
	e.fails(owner, "POST", "/api/v1/clients/website-check", map[string]any{"url": "x.ch"}, 400, "invalid_request")
	e.fails(&browser{token: owner.token, csrf: "wrong"}, "POST", "/api/v1/clients/website-check",
		map[string]any{"website": "alpenglow.ch"}, 403, "csrf_failed")
	e.fails(nil, "POST", "/api/v1/clients/website-check", map[string]any{"website": "alpenglow.ch"}, 401, "unauthenticated")
}
