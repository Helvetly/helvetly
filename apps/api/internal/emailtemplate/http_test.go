package emailtemplate

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type env struct {
	t   *testing.T
	st  *store.Store
	raw *pgxpool.Pool
	srv *httptest.Server
	svc *Service
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.Register(mux)
	svc := New(st, a)
	svc.Register(mux)
	srv := httptest.NewServer(permissions.Guard(a, mux))
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, raw: raw, srv: srv, svc: svc}
}

type browser struct{ token, csrf, workspace string }

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	if role == "owner" {
		if err := e.st.CreateWorkspace(ctx, store.Workspace{ID: ws, Name: "Acme"}, "UTC", now); err != nil {
			e.t.Fatal(err)
		}
	}
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna"}
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

func (e *env) owner() *browser { return e.join(auth.NewID("wsp"), "owner") }

// send returns the status and the body; csrf=false leaves the token header out.
func (e *env) send(b *browser, method, path string, body any, csrf bool) (int, []byte) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	if csrf {
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw
}

type got struct {
	Kind, Language, Subject, Body string
	Custom                        bool
	Default                       Template
	Variables                     []string
}

func (e *env) item(b *browser, method, path string, body any, want int) got {
	e.t.Helper()
	status, raw := e.send(b, method, path, body, true)
	if status != want {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, status, want, raw)
	}
	var out struct{ Data got }
	if err := json.Unmarshal(raw, &out); err != nil {
		e.t.Fatal(err)
	}
	return out.Data
}

func (e *env) list(b *browser) []got {
	e.t.Helper()
	status, raw := e.send(b, "GET", "/api/v1/email-templates", nil, true)
	if status != 200 {
		e.t.Fatalf("list: %d %s", status, raw)
	}
	var out struct{ Data []got }
	if err := json.Unmarshal(raw, &out); err != nil {
		e.t.Fatal(err)
	}
	return out.Data
}

func TestListDefaultsThenCustomThenReset(t *testing.T) {
	e := newEnv(t)
	b := e.owner()
	l := e.list(b)
	if len(l) != 32 || l[0].Kind != "invoice" || l[0].Language != "de" || l[31].Kind != "signature_reminder" || l[31].Language != "en" {
		t.Fatalf("list shape: %d items, first %+v", len(l), l[0])
	}
	en := l[3]
	if en.Custom || en.Subject != Default("invoice", "en").Subject || en.Body != en.Default.Body ||
		!slices.Equal(en.Variables, []string{"document", "number", "client", "amount", "company", "due_date"}) {
		t.Fatalf("default item %+v", en)
	}
	put := e.item(b, "PUT", "/api/v1/email-templates/quote/fr", map[string]string{"subject": "  Offre {number}  ", "body": "Bonjour\n\n  "}, 200)
	if !put.Custom || put.Subject != "Offre {number}" || put.Body != "Bonjour\n\n  " || put.Default.Subject != Default("quote", "fr").Subject {
		t.Fatalf("put %+v", put)
	}
	if l := e.list(b); !l[13].Custom || l[13].Body != "Bonjour\n\n  " || l[12].Custom {
		t.Fatalf("list after put: %+v", l[12:14])
	}
	if d := e.item(b, "DELETE", "/api/v1/email-templates/quote/fr", nil, 200); d.Custom || d.Subject != Default("quote", "fr").Subject {
		t.Fatalf("delete %+v", d)
	}
	e.item(b, "DELETE", "/api/v1/email-templates/quote/fr", nil, 200) // resetting twice is fine
}

func TestPutValidationFields(t *testing.T) {
	e := newEnv(t)
	b := e.owner()
	status, raw := e.send(b, "PUT", "/api/v1/email-templates/invoice/en", map[string]string{"subject": "  ", "body": "Hi {nope}"}, true)
	var out struct {
		Error struct {
			Code    string
			Details struct{ Fields map[string]string }
		}
	}
	_ = json.Unmarshal(raw, &out)
	if status != 400 || out.Error.Code != "invalid_request" || len(out.Error.Details.Fields) != 2 ||
		!strings.Contains(out.Error.Details.Fields["body"], "{nope}") {
		t.Fatalf("%d %s", status, raw)
	}
	if e.list(b)[3].Custom {
		t.Fatal("a refused text was stored")
	}
}

func TestUnknownKindOrLanguage404(t *testing.T) {
	e := newEnv(t)
	b := e.owner()
	for _, p := range []string{"/nope/en", "/invoice/xx"} {
		for _, m := range []string{"PUT", "DELETE"} {
			if status, raw := e.send(b, m, "/api/v1/email-templates"+p, map[string]string{"subject": "a", "body": "b"}, true); status != 404 {
				t.Fatalf("%s %s: %d %s", m, p, status, raw)
			}
		}
	}
}

func TestMemberWithoutInvoiceSettingsWriteGets403(t *testing.T) {
	e := newEnv(t)
	o := e.owner()
	m := e.join(o.workspace, "member")
	if _, err := e.raw.Exec(context.Background(), `UPDATE workspace_members SET scopes='{"read:invoice-settings"}' WHERE workspace_id=$1 AND role='member'`, o.workspace); err != nil {
		t.Fatal(err)
	}
	if status, raw := e.send(m, "GET", "/api/v1/email-templates", nil, true); status != 200 {
		t.Fatalf("GET: %d %s", status, raw)
	}
	if status, raw := e.send(m, "PUT", "/api/v1/email-templates/quote/fr", map[string]string{"subject": "a", "body": "b"}, true); status != 403 {
		t.Fatalf("PUT: %d %s", status, raw)
	}
	if status, raw := e.send(m, "DELETE", "/api/v1/email-templates/quote/fr", nil, true); status != 403 {
		t.Fatalf("DELETE: %d %s", status, raw)
	}
}

func TestPutWithoutCSRF403(t *testing.T) {
	e := newEnv(t)
	b := e.owner()
	for _, m := range []string{"PUT", "DELETE"} {
		if status, raw := e.send(b, m, "/api/v1/email-templates/quote/fr", map[string]string{"subject": "a", "body": "b"}, false); status != 403 {
			t.Fatalf("%s: %d %s", m, status, raw)
		}
	}
	if e.list(b)[13].Custom {
		t.Fatal("stored without a CSRF token")
	}
}

func TestWorkspaceIsolation(t *testing.T) {
	e := newEnv(t)
	a, b := e.owner(), e.owner()
	e.item(a, "PUT", "/api/v1/email-templates/invoice/de", map[string]string{"subject": "Mine", "body": "Secret"}, 200)
	if e.list(b)[0].Custom {
		t.Fatal("another workspace's text is visible")
	}
	e.item(b, "DELETE", "/api/v1/email-templates/invoice/de", nil, 200)
	if l := e.list(a)[0]; !l.Custom || l.Body != "Secret" {
		t.Fatalf("another workspace reset it: %+v", l)
	}
}

func TestPutTrimsNothingInBody(t *testing.T) {
	e := newEnv(t)
	b := e.owner()
	body := "\n Hello\r\n\r\n{company} \n"
	if p := e.item(b, "PUT", "/api/v1/email-templates/credit_note/it", map[string]string{"subject": "S", "body": body}, 200); p.Body != body {
		t.Fatalf("body %q", p.Body)
	}
	if l := e.list(b)[6]; l.Body != body {
		t.Fatalf("stored body %q", l.Body)
	}
}
