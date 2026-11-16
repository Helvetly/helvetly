package permissions

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
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type guardEnv struct {
	t   *testing.T
	st  *store.Store
	srv *httptest.Server
	ws  string
}

type person struct{ id, token, csrf string }

// newGuardEnv serves the guard around a stub API that answers 200 to everything it is let through to.
func newGuardEnv(t *testing.T) *guardEnv {
	t.Helper()
	t.Parallel()
	st, _ := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.Register(mux)
	mux.HandleFunc("/api/v1/", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	srv := httptest.NewServer(Guard(a, mux))
	t.Cleanup(srv.Close)
	ws := auth.NewID("wsp")
	if err := st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	return &guardEnv{t: t, st: st, srv: srv, ws: ws}
}

func (e *guardEnv) join(role string, scopes []string) person {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	p := person{id: auth.NewID("usr"), token: rand.Text(), csrf: rand.Text()}
	sum := sha256.Sum256([]byte(p.token))
	for _, err := range []error{
		e.st.CreateUser(ctx, store.User{ID: p.id, Email: strings.ToLower(rand.Text()) + "@example.com"}, now),
		e.st.JoinMember(ctx, e.ws, p.id, role, scopes, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), p.csrf, p.id, e.ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	return p
}

func (e *guardEnv) do(p person, method, path string) (int, string) {
	e.t.Helper()
	req, err := http.NewRequest(method, e.srv.URL+path, nil)
	if err != nil {
		e.t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: p.token})
	req.Header.Set("X-CSRF-Token", p.csrf)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(raw)
}

// refused checks the request is a 403 forbidden naming the missing scope.
func (e *guardEnv) refused(p person, method, path, scope string) {
	e.t.Helper()
	code, body := e.do(p, method, path)
	var got struct {
		Error struct {
			Code    string
			Details struct{ Scope string }
		}
	}
	_ = json.Unmarshal([]byte(body), &got)
	if code != http.StatusForbidden || got.Error.Code != "forbidden" || got.Error.Details.Scope != scope {
		e.t.Fatalf("%s %s: %d %s, want 403 forbidden with scope %s", method, path, code, body, scope)
	}
}

func (e *guardEnv) allowed(p person, method, path string) {
	e.t.Helper()
	if code, body := e.do(p, method, path); code != http.StatusOK {
		e.t.Fatalf("%s %s: %d %s, want 200", method, path, code, body)
	}
}

func TestGuardReadOnlyMember(t *testing.T) {
	e := newGuardEnv(t)
	m := e.join("member", []string{"read:*"})
	e.allowed(m, "GET", "/api/v1/invoices")
	e.refused(m, "POST", "/api/v1/invoices", "write:invoices")
	e.refused(m, "DELETE", "/api/v1/clients/cli_1", "write:clients")
	e.allowed(m, "DELETE", "/api/v1/members/"+m.id) // leaving needs no scope
	e.allowed(m, "GET", "/api/v1/session")
}

func TestGuardEngagementInvoiceNeedsInvoices(t *testing.T) {
	e := newGuardEnv(t)
	m := e.join("member", []string{"write:engagements"})
	e.allowed(m, "POST", "/api/v1/engagements/eng_1/entries")
	e.refused(m, "POST", "/api/v1/engagements/eng_1/periods/per_1/invoice", "write:invoices")
	e.refused(m, "GET", "/api/v1/invoices", "read:invoices")
}

func TestGuardOwnerAndAdminUnaffected(t *testing.T) {
	e := newGuardEnv(t)
	// the session answers the effective scopes: everything a "*" reaches plus the HR areas held (EffectiveHR)
	for _, c := range []struct {
		p    person
		want string
	}{
		{e.join("owner", nil), `"scopes":["*:*","write:employees","write:payroll"]`},
		{e.join("admin", nil), `"scopes":["*:*","read:payroll"]`},
		{e.join("admin", []string{}), `"scopes":["*:*"]`},
		{e.join("admin", []string{"write:employees"}), `"scopes":["*:*","write:employees"]`},
	} {
		e.allowed(c.p, "POST", "/api/v1/engagements/eng_1/periods/per_1/invoice")
		e.allowed(c.p, "PUT", "/api/v1/invoice-settings")
		e.allowed(c.p, "POST", "/api/v1/billing/checkout")
		if _, body := e.do(c.p, "GET", "/api/v1/session"); !strings.Contains(body, c.want) {
			t.Fatalf("effective scopes: %s, want %s", body, c.want)
		}
	}
}

func TestGuardUsesLiveScopes(t *testing.T) {
	e := newGuardEnv(t)
	m := e.join("member", []string{"read:*"})
	e.refused(m, "POST", "/api/v1/expenses", "write:expenses")
	if err := e.st.SetMemberRole(context.Background(), e.ws, m.id, "member", []string{"read:*", "write:expenses"}); err != nil {
		t.Fatal(err)
	}
	e.allowed(m, "POST", "/api/v1/expenses") // same session, no new sign-in
	if err := e.st.SetMemberRole(context.Background(), e.ws, m.id, "member", []string{"read:clients"}); err != nil {
		t.Fatal(err)
	}
	e.refused(m, "GET", "/api/v1/expenses", "read:expenses")
}

func TestGuardLeavesSignedOutToHandlers(t *testing.T) {
	e := newGuardEnv(t)
	if code, _ := e.do(person{token: "nope"}, "GET", "/api/v1/invoices"); code != http.StatusUnauthorized {
		t.Fatalf("signed out: %d, want 401", code)
	}
}

// TestGuardSettingsAreas: each settings area is its own scope. View reads it, edit changes it, and neither reaches
// a neighbouring area.
func TestGuardSettingsAreas(t *testing.T) {
	e := newGuardEnv(t)
	for _, c := range []struct{ area, read, write, other string }{
		{"invoice-settings", "/api/v1/invoice-settings", "/api/v1/invoice-settings/logo", "/api/v1/ledger"},
		{"vat-return", "/api/v1/vat-return", "/api/v1/vat-return/settings", "/api/v1/periods"},
		{"ledger", "/api/v1/ledger/journal", "/api/v1/ledger/settings", "/api/v1/vat-return"},
		{"periods", "/api/v1/periods", "/api/v1/periods/2026-10/reopen", "/api/v1/audit-log"},
		{"audit-log", "/api/v1/audit-log/verify", "", "/api/v1/workspace"},
		{"workspace", "/api/v1/workspace", "/api/v1/workspace", "/api/v1/invoice-settings"},
	} {
		t.Run(c.area, func(t *testing.T) {
			viewer, editor := e.join("member", []string{"read:" + c.area}), e.join("member", []string{"write:" + c.area})
			e.allowed(viewer, "GET", c.read)
			e.allowed(editor, "GET", c.read)
			if c.write != "" {
				e.refused(viewer, "PUT", c.write, "write:"+c.area)
				e.allowed(editor, "PUT", c.write)
			}
			_, otherArea, _ := strings.Cut(Required("GET", c.other)[0], ":")
			e.refused(editor, "GET", c.other, "read:"+otherArea)
		})
	}
}

// TestGuardAPIArea: a person's own tokens need the api area, at view, for every method (the real token handlers
// answer past the guard, so only a 403 counts as refused).
func TestGuardAPIArea(t *testing.T) {
	e := newGuardEnv(t)
	with, without := e.join("member", []string{"read:api", "read:clients"}), e.join("member", []string{"write:clients"})
	readOnly := e.join("member", []string{"read:*"})
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/v1/account/tokens"},
		{"POST", "/api/v1/account/tokens"},
		{"DELETE", "/api/v1/account/tokens/tok_1"},
	} {
		for _, p := range []person{with, readOnly} {
			if code, body := e.do(p, c.method, c.path); code == http.StatusForbidden {
				t.Fatalf("%s %s: %s", c.method, c.path, body)
			}
		}
		e.refused(without, c.method, c.path, "read:api")
	}
}
