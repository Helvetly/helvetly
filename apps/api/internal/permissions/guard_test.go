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
	for _, p := range []person{e.join("owner", nil), e.join("admin", nil)} {
		e.allowed(p, "POST", "/api/v1/engagements/eng_1/periods/per_1/invoice")
		e.allowed(p, "PUT", "/api/v1/invoice-settings")
		e.allowed(p, "POST", "/api/v1/billing/checkout")
		if _, body := e.do(p, "GET", "/api/v1/session"); !strings.Contains(body, `"scopes":["*:*"]`) {
			t.Fatalf("effective scopes: %s", body)
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
