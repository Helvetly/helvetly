package employees

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
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/documents"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// ---- the test server: the real guard, auth, documents and employees over a test database ----

type fakeStorage struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (f *fakeStorage) Put(_ context.Context, key string, body io.Reader, size int64, _, _ string) error {
	b, err := io.ReadAll(body)
	if err != nil || int64(len(b)) != size {
		return fmt.Errorf("put %s: %v", key, err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = b
	return nil
}

func (f *fakeStorage) PresignDownload(_ context.Context, key string, _ time.Duration, _ string) (string, error) {
	return "https://s3.test/" + key, nil
}

func (f *fakeStorage) ProxyDownloads() bool { return false }

type object struct{ *bytes.Reader }

func (object) Close() error { return nil }

func (f *fakeStorage) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	b, ok := f.objects[key]
	if !ok {
		return nil, fmt.Errorf("open %s: missing", key)
	}
	return object{bytes.NewReader(b)}, nil
}

func (f *fakeStorage) Copy(_ context.Context, src, dst string) error { return nil }

func (f *fakeStorage) Delete(_ context.Context, key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.objects, key)
	return nil
}

type env struct {
	t      *testing.T
	st     *store.Store
	raw    *pgxpool.Pool
	srv    *httptest.Server
	files  *fakeStorage
	svc    *Service
	denied sync.Map // workspaces whose plan lacks the module
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	secret := bytes.Repeat([]byte{7}, 32)
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: secret, SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	files := &fakeStorage{objects: map[string][]byte{}}
	docs := documents.New(st, a, files, 1<<20, discard)
	mux := http.NewServeMux()
	a.Register(mux)
	docs.Register(mux)
	e := &env{t: t, st: st, raw: raw, files: files, svc: New(st, a, docs, secret, discard)}
	// the plan's answer as billing gives it (billing.Service.RequireFeature), for the workspaces a test downgrades
	st.SetFeatureGate(func(_ context.Context, _ store.Q, ws, feature string) error {
		if _, ok := e.denied.Load(ws); ok && feature == store.FeatureEmployees {
			return fmt.Errorf("%w: %w", store.ErrFeatureDenied, auth.Error(http.StatusForbidden, "feature_not_in_plan",
				"The Pro plan does not include the Employees module. Upgrade to Business to use it.", nil))
		}
		return nil
	})
	e.svc.Register(mux)
	e.srv = httptest.NewServer(permissions.Guard(a, mux))
	t.Cleanup(e.srv.Close)
	return e
}

type browser struct{ token, csrf, workspace, user string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme AG"}, "Europe/Zurich", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, "owner", nil)
}

func (e *env) join(ws, role string, scopes []string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Ann " + role}
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
	if scopes != nil {
		if _, err := e.raw.Exec(ctx, `UPDATE workspace_members SET scopes = $3 WHERE workspace_id = $1 AND user_id = $2`, ws, u.ID, scopes); err != nil {
			e.t.Fatal(err)
		}
	}
	return b
}

func (e *env) do(b *browser, method, path string, body io.Reader, contentType string) (*http.Response, []byte) {
	e.t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+path, body)
	if err != nil {
		e.t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res, out
}

func (e *env) send(b *browser, method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			e.t.Fatal(err)
		}
		rd = bytes.NewReader(raw)
	}
	res, out := e.do(b, method, path, rd, "application/json")
	var m map[string]any
	_ = json.Unmarshal(out, &m)
	return res.StatusCode, m
}

// must sends and fails unless the status is want; it returns the response's data.
func (e *env) must(b *browser, want int, method, path string, body any) map[string]any {
	e.t.Helper()
	status, m := e.send(b, method, path, body)
	if status != want {
		e.t.Fatalf("%s %s: status %d, want %d: %v", method, path, status, want, m)
	}
	d, _ := m["data"].(map[string]any)
	return d
}

func (e *env) list(b *browser, path string) []any {
	e.t.Helper()
	status, m := e.send(b, "GET", path, nil)
	if status != 200 {
		e.t.Fatalf("GET %s: %d %v", path, status, m)
	}
	l, _ := m["data"].([]any)
	return l
}

func code(m map[string]any) string {
	errBody, _ := m["error"].(map[string]any)
	c, _ := errBody["code"].(string)
	return c
}

func field(m map[string]any, name string) string {
	errBody, _ := m["error"].(map[string]any)
	details, _ := errBody["details"].(map[string]any)
	fields, _ := details["fields"].(map[string]any)
	v, _ := fields[name].(string)
	return v
}

var anna = map[string]any{"first_name": "Anna", "last_name": "Muster", "employment_start": "2024-01-01",
	"employer_country": "CH", "work_country": "CH", "work_region": "ZH", "employee_number": "E-1", "position": "Engineer",
	"department": "Development"}

func with(base map[string]any, kv ...any) map[string]any {
	out := map[string]any{}
	for k, v := range base {
		out[k] = v
	}
	for i := 0; i < len(kv); i += 2 {
		out[kv[i].(string)] = kv[i+1]
	}
	return out
}

func (e *env) employee(b *browser, body map[string]any) string {
	e.t.Helper()
	return e.must(b, 201, "POST", "/api/v1/employees", body)["id"].(string)
}

func (e *env) upload(b *browser, path, name string, content []byte, fields map[string]string) (int, map[string]any) {
	e.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	part, _ := w.CreateFormFile("file", name)
	_, _ = part.Write(content)
	_ = w.Close()
	res, out := e.do(b, "POST", path, &buf, w.FormDataContentType())
	var m map[string]any
	_ = json.Unmarshal(out, &m)
	return res.StatusCode, m
}

var pdf = []byte("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")

// ---- records ----

func TestEmployeeWithoutAndWithMember(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	got := e.must(owner, 200, "GET", "/api/v1/employees/"+id, nil)
	if got["member_user_id"] != nil || got["status"] != "active" || got["employing_entity"] != "Acme AG" {
		t.Fatalf("employee without a member: %v", got)
	}

	colleague := e.join(owner.workspace, "member", []string{"*:*"})
	linked := e.must(owner, 200, "PATCH", "/api/v1/employees/"+id, map[string]any{"member_user_id": colleague.user})
	if linked["member_user_id"] != colleague.user || linked["member_active"] != true {
		t.Fatalf("linked employee: %v", linked)
	}
	// The link grants nothing: the linked member still cannot read any employee, not even this one.
	if status, m := e.send(colleague, "GET", "/api/v1/employees/"+id, nil); status != 403 {
		t.Fatalf("a linked member read the record: %d %v", status, m)
	}
	other := e.workspace()
	if status, m := e.send(owner, "PATCH", "/api/v1/employees/"+id, map[string]any{"member_user_id": other.user}); status != 422 ||
		field(m, "member_user_id") == "" {
		t.Fatalf("linking someone outside the workspace: %d %v", status, m)
	}
	// Removing the user keeps the employment record; only the link goes.
	ctx := context.Background()
	if _, err := e.raw.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, colleague.user); err != nil {
		t.Fatal(err)
	}
	if _, err := e.raw.Exec(ctx, `DELETE FROM workspace_members WHERE user_id = $1`, colleague.user); err != nil {
		t.Fatal(err)
	}
	if got := e.must(owner, 200, "GET", "/api/v1/employees/"+id, nil); got["member_active"] != false {
		t.Fatalf("a former member still shows as a member: %v", got)
	}
	if _, err := e.raw.Exec(ctx, `DELETE FROM users WHERE id = $1`, colleague.user); err != nil {
		t.Fatal(err)
	}
	if got := e.must(owner, 200, "GET", "/api/v1/employees/"+id, nil); got["member_user_id"] != nil || got["first_name"] != "Anna" {
		t.Fatalf("after deleting the user: %v", got)
	}
}

func TestEmployeeAddressParts(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, with(anna, "street", "Seefeldstrasse", "street_number", "12", "apt", "3rd floor"))
	got := e.must(owner, 200, "GET", "/api/v1/employees/"+id, nil)
	if got["street"] != "Seefeldstrasse" || got["street_number"] != "12" || got["apt"] != "3rd floor" {
		t.Fatalf("address parts after create: %v", got)
	}
	got = e.must(owner, 200, "PATCH", "/api/v1/employees/"+id, map[string]any{"street_number": "14", "apt": nil})
	if got["street_number"] != "14" || got["apt"] != nil || got["street"] != "Seefeldstrasse" {
		t.Fatalf("address parts after edit: %v", got)
	}
}

func TestEmployeeValidationAndList(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	for _, c := range []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"no names", map[string]any{"employment_start": "2024-01-01", "work_country": "CH", "employer_country": "CH"}, "first_name"},
		{"no work country", with(anna, "work_country", nil), "work_country"},
		{"no employer country", with(anna, "employer_country", nil), "employer_country"},
		{"bad date", with(anna, "employment_start", "01.01.2024"), "employment_start"},
		{"end before start", with(anna, "employment_end", "2023-12-31"), "employment_end"},
		{"unknown canton", with(anna, "work_region", "XX"), "work_region"},
		{"bad working time", with(anna, "working_time", "120"), "working_time"},
		{"bad email", with(anna, "email", "anna"), "email"},
	} {
		if status, m := e.send(owner, "POST", "/api/v1/employees", c.body); status != 422 || field(m, c.field) == "" {
			t.Errorf("%s: %d %v", c.name, status, m)
		}
	}
	if status, m := e.send(owner, "POST", "/api/v1/employees", with(anna, "date_of_birth", "1990-01-01")); status != 400 {
		t.Fatalf("fields the module does not collect are refused: %d %v", status, m)
	}
	e.employee(owner, anna)
	if status, m := e.send(owner, "POST", "/api/v1/employees", anna); status != 422 || field(m, "employee_number") == "" {
		t.Fatalf("duplicate employee number: %d %v", status, m)
	}
	e.employee(owner, with(anna, "first_name", "Ben", "last_name", "Arnold", "employee_number", "E-2", "department", "Sales",
		"employment_start", "2099-01-01"))
	e.employee(owner, with(anna, "first_name", "Cleo", "last_name", "Zeller", "employee_number", "E-3",
		"employment_start", "2020-01-01", "employment_end", "2021-12-31"))
	names := func(path string) []string {
		var out []string
		for _, it := range e.list(owner, path) {
			out = append(out, it.(map[string]any)["first_name"].(string))
		}
		return out
	}
	for path, want := range map[string]string{
		"/api/v1/employees":                                  "Ben,Anna,Cleo",
		"/api/v1/employees?status=active":                    "Anna",
		"/api/v1/employees?status=upcoming":                  "Ben",
		"/api/v1/employees?status=ended":                     "Cleo",
		"/api/v1/employees?department=sales":                 "Ben",
		"/api/v1/employees?search=mus":                       "Anna",
		"/api/v1/employees?search=" + url.QueryEscape("E-3"): "Cleo",
		"/api/v1/employees?sort=-name":                       "Cleo,Anna,Ben",
		"/api/v1/employees?sort=since":                       "Cleo,Anna,Ben",
		"/api/v1/employees?sort=-since":                      "Ben,Anna,Cleo",
		"/api/v1/employees?sort=department":                  "Anna,Cleo,Ben",
	} {
		if got := strings.Join(names(path), ","); got != want {
			t.Errorf("%s = %s, want %s", path, got, want)
		}
	}
}

func TestEmployeeListRefusesUnknownSort(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	for _, sort := range []string{"bank_account", "-tax_id", "name%3Bdrop"} {
		if status, _ := e.send(owner, "GET", "/api/v1/employees?sort="+sort, nil); status != 400 {
			t.Errorf("sort=%s: %d", sort, status)
		}
	}
}

func TestProtectedFieldsAreSealed(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, with(anna, "bank_account", "CH93 0076 2011 6238 5295 7", "tax_id", "756.1234.5678.97"))
	got := e.must(owner, 200, "GET", "/api/v1/employees/"+id, nil)
	if got["bank_account_hint"] != "•••• 2957" || got["bank_account"] != nil || got["tax_id"] != nil {
		t.Fatalf("the record shows only hints: %v", got)
	}
	var sealed []byte
	if err := e.raw.QueryRow(context.Background(), `SELECT bank_account_sealed FROM employees WHERE id = $1`, id).Scan(&sealed); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("2957")) {
		t.Fatal("the bank account is stored in plain text")
	}
	p := e.must(owner, 200, "GET", "/api/v1/employees/"+id+"/protected", nil)
	if p["bank_account"] != "CH9300762011623852957" || p["tax_id"] != "756.1234.5678.97" {
		t.Fatalf("protected = %v", p)
	}
	for _, scopes := range [][]string{{"write:employees"}, {"read:payroll"}} {
		m := e.join(owner.workspace, "member", scopes)
		if status, _ := e.send(m, "GET", "/api/v1/employees/"+id+"/protected", nil); status != 403 {
			t.Fatalf("%v reveals protected fields: %d", scopes, status)
		}
	}
	editor := e.join(owner.workspace, "member", []string{"write:payroll"})
	e.must(editor, 200, "GET", "/api/v1/employees/"+id+"/protected", nil)
	var reveals int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events
		WHERE kind = 'employee.protected_viewed' AND subject_id = $1`, id).Scan(&reveals); err != nil || reveals != 2 {
		t.Fatalf("every reveal is logged: %d reveals, %v", reveals, err)
	}
}

// ---- permissions and isolation ----

func TestHRScopesAndIsolation(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	entry := e.must(owner, 201, "POST", "/api/v1/payroll/entries", map[string]any{"employee_id": id, "period_start": "2026-10-01",
		"period_end": "2026-10-31", "currency": "CHF", "gross": "6000.00", "deductions": "820.00", "net": "5180.00", "employer_costs": "710.00"})
	entryID := entry["id"].(string)
	status, doc := e.upload(owner, "/api/v1/employees/"+id+"/documents", "contract.pdf", pdf, map[string]string{"type": "employment_contract"})
	if status != 201 {
		t.Fatalf("upload: %d %v", status, doc)
	}
	docID := doc["data"].(map[string]any)["id"].(string)

	full := e.join(owner.workspace, "member", []string{"*:*"})
	admin := e.join(owner.workspace, "admin", nil) // the admin default: payroll view
	noHR := e.join(owner.workspace, "admin", []string{})
	records := e.join(owner.workspace, "member", []string{"write:employees"})
	pay := e.join(owner.workspace, "member", []string{"read:payroll"})
	editor := e.join(owner.workspace, "member", []string{"write:payroll"})
	for _, c := range []struct {
		who          string
		b            *browser
		method, path string
		want         int
	}{
		{"full access member", full, "GET", "/api/v1/employees", 403},
		{"full access member", full, "GET", "/api/v1/payroll/entries", 403},
		{"admin", admin, "GET", "/api/v1/employees", 200},
		{"admin", admin, "GET", "/api/v1/payroll/summary?month=2026-10", 200},
		{"admin", admin, "GET", "/api/v1/employees/" + id, 403},
		{"admin", admin, "GET", "/api/v1/employees/" + id + "/protected", 403},
		{"admin", admin, "POST", "/api/v1/payroll/entries/" + entryID + "/approve", 403},
		{"admin without HR", noHR, "GET", "/api/v1/employees", 403},
		{"admin without HR", noHR, "GET", "/api/v1/payroll/entries", 403},
		{"records only", records, "GET", "/api/v1/employees/" + id, 200},
		{"records only", records, "GET", "/api/v1/employees/" + id + "/pay-terms", 403},
		{"records only", records, "GET", "/api/v1/employees/" + id + "/documents", 200},
		{"records only", records, "GET", "/api/v1/employees/" + id + "/documents/" + docID + "/download", 200},
		{"records only", records, "GET", "/api/v1/payroll/entries", 403},
		{"pay reader", pay, "GET", "/api/v1/employees", 200},
		{"pay reader", pay, "GET", "/api/v1/employees/" + id, 403},
		{"pay reader", pay, "GET", "/api/v1/employees/" + id + "/pay-terms", 200},
		{"pay reader", pay, "GET", "/api/v1/payroll/entries/" + entryID, 200},
		{"pay reader", pay, "POST", "/api/v1/payroll/entries/" + entryID + "/approve", 403},
		{"pay reader", pay, "GET", "/api/v1/payroll/export?month=2026-10", 200},
		{"pay reader", pay, "GET", "/api/v1/payroll/bookings/preview", 200},
		{"pay reader", pay, "PUT", "/api/v1/employment/settings", 403},
	} {
		if status, m := e.send(c.b, c.method, c.path, map[string]any{"version": 1}); status != c.want {
			t.Errorf("%s %s %s: %d, want %d (%v)", c.who, c.method, c.path, status, c.want, m)
		}
	}
	e.must(editor, 200, "POST", "/api/v1/payroll/entries/"+entryID+"/approve", map[string]any{"version": 1})

	other := e.workspace()
	for _, path := range []string{"/api/v1/employees/" + id, "/api/v1/employees/" + id + "/pay-terms",
		"/api/v1/employees/" + id + "/documents/" + docID + "/download", "/api/v1/payroll/entries/" + entryID} {
		if status, _ := e.send(other, "GET", path, nil); status != 404 {
			t.Errorf("another workspace reads %s: %d", path, status)
		}
	}
	if len(e.list(other, "/api/v1/employees")) != 0 || len(e.list(other, "/api/v1/payroll/entries")) != 0 {
		t.Fatal("another workspace lists this one's employees or payroll")
	}
}

func TestMembersAndInvitationsNeedAnOwnerForHRScopes(t *testing.T) {
	if !permissions.IsHR("write:payroll") || permissions.IsHR("write:invoices") {
		t.Fatal("IsHR")
	}
}

// ---- documents stay HR files ----

func TestEmployeeDocumentsArePrivate(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	status, m := e.upload(owner, "/api/v1/employees/"+id+"/documents", "anna-contract.pdf", pdf,
		map[string]string{"type": "employment_contract", "document_date": "2024-01-01"})
	if status != 201 {
		t.Fatalf("upload: %d %v", status, m)
	}
	docID := m["data"].(map[string]any)["id"].(string)
	if status, m := e.upload(owner, "/api/v1/employees/"+id+"/documents", "again.pdf", pdf, map[string]string{"type": "other"}); status != 409 ||
		code(m) != "duplicate_file" {
		t.Fatalf("the same bytes twice for one employee: %d %v", status, m)
	}
	if status, m := e.upload(owner, "/api/v1/employees/"+id+"/documents", "x.pdf", []byte("%PDF-1.4 other"), map[string]string{"type": "secret"}); status != 422 ||
		field(m, "type") == "" {
		t.Fatalf("unknown document type: %d %v", status, m)
	}

	// The document system does not see it: not in lists or search, not by id, not shareable, not linkable.
	if l := e.list(owner, "/api/v1/documents"); len(l) != 0 {
		t.Fatalf("Documents lists an employee file: %v", l)
	}
	if l := e.list(owner, "/api/v1/documents?search=anna"); len(l) != 0 {
		t.Fatalf("search finds an employee file: %v", l)
	}
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/v1/documents/" + docID},
		{"GET", "/api/v1/documents/" + docID + "/download"},
		{"GET", "/api/v1/documents/" + docID + "/content"},
	} {
		if status, _ := e.send(owner, c.method, c.path, nil); status != 404 {
			t.Errorf("%s %s: %d, want 404", c.method, c.path, status)
		}
	}
	ctx := context.Background()
	if _, err := e.raw.Exec(ctx, `INSERT INTO clients (id, workspace_id, number, name, created_at, updated_at)
		VALUES ('cli_portal', $1, 1, 'Client', now(), now())`, owner.workspace); err != nil {
		t.Fatal(err)
	}
	if err := e.st.ShareDocument(ctx, owner.workspace, docID, "cli_portal", owner.user, time.Now()); err == nil {
		t.Fatal("an employee file was shared to the client portal")
	}
	if _, err := e.st.Document(ctx, owner.workspace, docID); err == nil {
		t.Fatal("signatures, templates and links reach an employee file through Document")
	}
	// The same bytes as a general document are a separate copy and reveal nothing about the HR file.
	if status, m := e.upload(owner, "/api/v1/documents", "contract.pdf", pdf, nil); status != 201 {
		t.Fatalf("a general upload of the same bytes: %d %v", status, m)
	}

	// Downloads stream through the API (a fresh permission check each time), never a signed or presigned link.
	res, body := e.do(owner, "GET", "/api/v1/employees/"+id+"/documents/"+docID+"/download", nil, "")
	if res.StatusCode != 200 || !bytes.Equal(body, pdf) || res.Header.Get("Location") != "" ||
		!strings.Contains(res.Header.Get("Cache-Control"), "no-store") || !strings.HasPrefix(res.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("download: %d %v %q", res.StatusCode, res.Header, body)
	}
}

func TestRetentionAndEndOfEmployment(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	// CH payroll records: 10 years from the end of the business year (CH-RET-PAYROLL-001, verified).
	status, m := e.upload(owner, "/api/v1/employees/"+id+"/documents", "payroll-2025.pdf", pdf,
		map[string]string{"type": "payroll_record", "document_date": "2025-03-31"})
	if status != 201 {
		t.Fatalf("upload: %d %v", status, m)
	}
	d := m["data"].(map[string]any)
	if d["retain_until"] != "2035-12-31" || !strings.Contains(fmt.Sprint(d["retention_rule"]), "CH-RET-PAYROLL-001") {
		t.Fatalf("retention from the verified rule: %v", d)
	}
	docID := d["id"].(string)
	if status, m := e.send(owner, "PATCH", "/api/v1/employees/"+id+"/documents/"+docID, map[string]any{"retain_until": "2030-01-01"}); status != 422 {
		t.Fatalf("shortening a rule's retention: %d %v", status, m)
	}
	// Backdate the upload past the mistake window; the retention now blocks deletion.
	if _, err := e.raw.Exec(context.Background(), `UPDATE documents SET created_at = now() - interval '2 days' WHERE id = $1`, docID); err != nil {
		t.Fatal(err)
	}
	if status, m := e.send(owner, "DELETE", "/api/v1/employees/"+id+"/documents/"+docID, nil); status != 409 || code(m) != "retained" {
		t.Fatalf("deleting a retained document: %d %v", status, m)
	}

	// Ending employment changes the status and deletes nothing.
	ended := e.must(owner, 200, "PATCH", "/api/v1/employees/"+id, map[string]any{"employment_end": "2026-01-31", "email": "anna@example.com"})
	if ended["status"] != "ended" || len(e.list(owner, "/api/v1/employees/"+id+"/documents")) != 1 {
		t.Fatalf("after the end of employment: %v", ended)
	}
	// A legal hold (owner only) blocks erasure; lifting it allows it, and what is retained stays, restricted.
	hr := e.join(owner.workspace, "member", []string{"write:employees"})
	if status, _ := e.send(hr, "PATCH", "/api/v1/employees/"+id, map[string]any{"legal_hold": true, "legal_hold_reason": "Court case"}); status != 403 {
		t.Fatalf("a non-owner set a legal hold: %d", status)
	}
	e.must(owner, 200, "PATCH", "/api/v1/employees/"+id, map[string]any{"legal_hold": true, "legal_hold_reason": "Court case"})
	if status, m := e.send(owner, "POST", "/api/v1/employees/"+id+"/erase", nil); status != 409 || code(m) != "legal_hold" {
		t.Fatalf("erasing under a legal hold: %d %v", status, m)
	}
	e.must(owner, 200, "PATCH", "/api/v1/employees/"+id, map[string]any{"legal_hold": false})
	status, m = e.send(owner, "POST", "/api/v1/employees/"+id+"/erase", nil)
	if status != 200 || m["kept_documents"] != float64(1) || m["deleted_documents"] != float64(0) {
		t.Fatalf("erase: %d %v", status, m)
	}
	erased := m["data"].(map[string]any)
	if erased["email"] != nil || erased["erased_at"] == nil || erased["restricted"] != true || erased["last_name"] != "Muster" {
		t.Fatalf("erased record: %v", erased)
	}
	if status, m := e.send(owner, "PATCH", "/api/v1/employees/"+id, map[string]any{"position": "x"}); status != 409 {
		t.Fatalf("an erased, restricted record changed: %d %v", status, m)
	}
	if status, m := e.send(owner, "DELETE", "/api/v1/employees/"+id, nil); status != 409 || code(m) != "has_history" {
		t.Fatalf("deleting an employee with history: %d %v", status, m)
	}
}

func TestJurisdictionIsResolvedNotGuessed(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	jp := e.employee(owner, with(anna, "employee_number", "E-JP", "work_country", "JP", "work_region", nil))
	frontier := e.employee(owner, with(anna, "employee_number", "E-FR", "work_region", "GE", "residence_country", "FR", "cross_border", true))
	got := e.must(owner, 200, "GET", "/api/v1/employees/"+jp+"/jurisdiction", nil)
	if got["status"] != "unsupported" || got["mode"] != "register" {
		t.Fatalf("an unsupported country: %v", got)
	}
	got = e.must(owner, 200, "GET", "/api/v1/employees/"+frontier+"/jurisdiction", nil)
	blocked := fmt.Sprint(got["blocked"])
	if got["status"] != "ambiguous" || !strings.Contains(blocked, "payroll_calculation") || !strings.Contains(blocked, "retention_suggestion") {
		t.Fatalf("a cross-border case: %v", got)
	}
	// Administrative operations still work: a document uploads, with no retention guessed.
	status, m := e.upload(owner, "/api/v1/employees/"+frontier+"/documents", "p.pdf", pdf,
		map[string]string{"type": "payroll_record", "document_date": "2025-03-31"})
	if status != 201 || m["data"].(map[string]any)["retain_until"] != nil {
		t.Fatalf("cross-border document: %d %v", status, m)
	}
}

// ---- pay terms ----

func TestPayTermsHistory(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	id := e.employee(owner, anna)
	terms := func(body map[string]any) (int, map[string]any) {
		return e.send(owner, "POST", "/api/v1/employees/"+id+"/pay-terms", body)
	}
	base := map[string]any{"effective_from": "2024-01-01", "basis": "monthly", "amount": "6000.00", "currency": "CHF", "frequency": "monthly"}
	if status, m := terms(base); status != 200 {
		t.Fatalf("first terms: %d %v", status, m)
	}
	entry := e.must(owner, 201, "POST", "/api/v1/payroll/entries", map[string]any{"employee_id": id, "period_start": "2026-01-01",
		"period_end": "2026-01-31", "currency": "CHF", "gross": "6000.00", "deductions": "800.00", "net": "5200.00", "employer_costs": "700.00"})
	e.must(owner, 200, "POST", "/api/v1/payroll/entries/"+entry["id"].(string)+"/approve", map[string]any{"version": 1})
	if status, m := terms(with(base, "effective_from", "2026-02-01", "amount", "6500.00")); status != 200 {
		t.Fatalf("raise: %d %v", status, m)
	}
	if status, m := terms(with(base, "effective_from", "2099-01-01", "basis", "hourly", "amount", "55.50")); status != 200 {
		t.Fatalf("future terms: %d %v", status, m)
	}
	list := e.list(owner, "/api/v1/employees/"+id+"/pay-terms")
	if len(list) != 3 || list[0].(map[string]any)["current"] != false || list[1].(map[string]any)["current"] != true ||
		list[1].(map[string]any)["amount"] != "6500.00" || list[2].(map[string]any)["amount"] != "6000.00" {
		t.Fatalf("history: %v", list)
	}
	// The raise reached no approved entry.
	if got := e.must(owner, 200, "GET", "/api/v1/payroll/entries/"+entry["id"].(string), nil); got["gross"] != "6000.00" {
		t.Fatalf("approved entry changed with the terms: %v", got)
	}
	for _, c := range []struct {
		name string
		body map[string]any
		key  string
	}{
		{"same date", with(base, "effective_from", "2026-02-01"), "effective_from"},
		{"before employment", with(base, "effective_from", "2023-12-01"), "effective_from"},
		{"three decimals", with(base, "effective_from", "2026-03-01", "amount", "6000.005"), "amount"},
		{"zero", with(base, "effective_from", "2026-03-01", "amount", "0"), "amount"},
		{"no decimals currency", with(base, "effective_from", "2026-03-01", "currency", "JPY"), "currency"},
		{"missing frequency", with(base, "effective_from", "2026-03-01", "frequency", nil), "frequency"},
	} {
		if status, m := terms(c.body); status != 422 || field(m, c.key) == "" {
			t.Errorf("%s: %d %v", c.name, status, m)
		}
	}
	current := list[1].(map[string]any)["id"].(string)
	if status, m := e.send(owner, "DELETE", "/api/v1/employees/"+id+"/pay-terms/"+current, nil); status != 409 {
		t.Fatalf("deleting terms in effect: %d %v", status, m)
	}
	e.must(owner, 204, "DELETE", "/api/v1/employees/"+id+"/pay-terms/"+list[0].(map[string]any)["id"].(string), nil)
	if _, err := e.raw.Exec(context.Background(), `UPDATE employee_pay_terms SET amount = 1 WHERE id = $1`, current); err == nil {
		t.Fatal("the database let pay terms change")
	}
}
