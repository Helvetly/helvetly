package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// tokenEnv serves auth plus two stand-in public routes that echo the session's workspace; only they accept tokens.
func tokenEnv(t *testing.T) (*env, *httptest.Server) {
	e := newEnv(t)
	e.svc.BearerRoutes = func(r *http.Request) (bool, string, bool) {
		resource, ok := strings.CutPrefix(r.URL.Path, "/api/v1/")
		ok = ok && (resource == "things" || resource == "others")
		return ok, resource, r.Method != http.MethodGet
	}
	e.svc.TokenResources = []string{"things", "others"}
	mux := http.NewServeMux()
	e.svc.Register(mux)
	echo := e.svc.SignedIn(func(w http.ResponseWriter, _ *http.Request, sess store.Session) {
		WriteJSON(w, http.StatusOK, map[string]string{"workspace": sess.Workspace.ID, "user": sess.User.ID})
	})
	mux.HandleFunc("GET /api/v1/things", echo)
	mux.HandleFunc("POST /api/v1/things", echo)
	mux.HandleFunc("GET /api/v1/others", echo)
	mux.HandleFunc("POST /api/v1/others", echo)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	e.srv = srv // the browser helpers now reach this server
	return e, srv
}

type tokenOut struct {
	Data struct {
		ID, Name, Prefix, Token string
		Scopes                  []string
		Workspace               struct{ ID, Name string }
		LastUsedAt              *time.Time `json:"last_used_at"`
		ExpiresAt               *time.Time `json:"expires_at"`
	}
}

// bearer calls srv with the token only (no cookie, no CSRF) and returns the status and error code.
func bearer(t *testing.T, srv *httptest.Server, token, method, path string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+path, bytes.NewReader(nil))
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var e apiErr
	_ = json.Unmarshal(raw, &e)
	return res.StatusCode, e.Error.Code
}

func TestAPITokenLifecycle(t *testing.T) {
	e, srv := tokenEnv(t)
	b := e.emailSignIn("tokens@example.com")
	sess := e.session(b)

	for _, c := range []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"empty name", map[string]any{"name": " ", "scopes": []string{"read:*"}}, "name"},
		{"long name", map[string]any{"name": strings.Repeat("x", 81), "scopes": []string{"read:*"}}, "name"},
		{"no scopes", map[string]any{"name": "x", "scopes": []string{}}, "scopes"},
		{"unknown action", map[string]any{"name": "x", "scopes": []string{"admin:*"}}, "scopes"},
		{"unknown resource", map[string]any{"name": "x", "scopes": []string{"read:members"}}, "scopes"},
		{"bad expiry", map[string]any{"name": "x", "scopes": []string{"read:*"}, "expires_in_days": 7}, "expires_in_days"},
	} {
		t.Run(c.name, func(t *testing.T) {
			var out apiErr
			e.do(b, "POST", "/api/v1/account/tokens", c.body, 422, &out)
			if fields, _ := out.Error.Details["fields"].(map[string]any); fields[c.field] == nil {
				t.Fatalf("fields: %+v", out.Error.Details)
			}
		})
	}

	var read, write, narrow tokenOut
	e.do(b, "POST", "/api/v1/account/tokens", map[string]any{"name": " Reports ", "scopes": []string{"read:*"}}, 201, &read)
	e.do(b, "POST", "/api/v1/account/tokens", map[string]any{"name": "Claude", "scopes": []string{"write:*"}, "expires_in_days": 30}, 201, &write)
	e.do(b, "POST", "/api/v1/account/tokens", map[string]any{"name": "Things bot", "scopes": []string{"write:things", "read:others"}}, 201, &narrow)
	if !slices.Equal(write.Data.Scopes, []string{"read:*", "write:*"}) || !slices.Equal(narrow.Data.Scopes, []string{"read:others", "read:things", "write:things"}) {
		t.Fatalf("stored scopes: %v %v", write.Data.Scopes, narrow.Data.Scopes)
	}
	if !strings.HasPrefix(read.Data.Token, "hvt_") || read.Data.Prefix != read.Data.Token[:8] || read.Data.Name != "Reports" ||
		read.Data.Workspace.ID != sess.Workspace.ID || read.Data.ExpiresAt != nil || write.Data.ExpiresAt == nil {
		t.Fatalf("created: %+v %+v", read.Data, write.Data)
	}
	if n := e.count(`SELECT count(*) FROM api_tokens WHERE token_hash = $1`, hashSecret(write.Data.Token)); n != 1 {
		t.Fatalf("stored hash rows = %d", n)
	}
	if n := e.count(`SELECT count(*) FROM api_tokens WHERE token_hash = $1 OR prefix = $1`, write.Data.Token); n != 0 {
		t.Fatal("secret stored in clear")
	}

	for _, c := range []struct {
		name, token, method, path string
		status                    int
		code                      string
	}{
		{"read token reads", read.Data.Token, "GET", "/api/v1/things", 200, ""},
		{"read token cannot write", read.Data.Token, "POST", "/api/v1/things", 403, "token_scope"},
		{"resource write token writes it", narrow.Data.Token, "POST", "/api/v1/things", 200, ""},
		{"resource read token reads it", narrow.Data.Token, "GET", "/api/v1/others", 200, ""},
		{"resource read token cannot write it", narrow.Data.Token, "POST", "/api/v1/others", 403, "token_scope"},
		{"write token writes without CSRF", write.Data.Token, "POST", "/api/v1/things", 200, ""},
		{"token cannot mint tokens", write.Data.Token, "POST", "/api/v1/account/tokens", 403, "token_not_allowed"},
		{"token cannot read the session", write.Data.Token, "GET", "/api/v1/session", 403, "token_not_allowed"},
		{"unknown token", "hvt_NOPE", "GET", "/api/v1/things", 401, "unauthenticated"},
		{"not a Helvetly token", "abc", "GET", "/api/v1/things", 401, "unauthenticated"},
	} {
		t.Run(c.name, func(t *testing.T) {
			if status, code := bearer(t, srv, c.token, c.method, c.path); status != c.status || code != c.code {
				t.Fatalf("%d %q, want %d %q", status, code, c.status, c.code)
			}
		})
	}

	var raw struct {
		Data []map[string]any
	}
	e.do(b, "GET", "/api/v1/account/tokens", nil, 200, &raw)
	if len(raw.Data) != 3 || raw.Data[0]["token"] != nil || raw.Data[2]["last_used_at"] == nil {
		t.Fatalf("list: %+v", raw.Data)
	}

	other := e.emailSignIn("other@example.com")
	e.session(other)
	e.do(other, "DELETE", "/api/v1/account/tokens/"+write.Data.ID, nil, 404, nil)
	e.do(b, "DELETE", "/api/v1/account/tokens/"+write.Data.ID, nil, 204, nil)
	if status, _ := bearer(t, srv, write.Data.Token, "GET", "/api/v1/things"); status != 401 {
		t.Fatalf("revoked: %d, want 401", status)
	}
}

func TestAPITokenFollowsMembershipAndExpiry(t *testing.T) {
	e, srv := tokenEnv(t)
	b := e.emailSignIn("expiry@example.com")
	sess := e.session(b)
	var short, long tokenOut
	e.do(b, "POST", "/api/v1/account/tokens", map[string]any{"name": "a", "scopes": []string{"read:*"}, "expires_in_days": 30}, 201, &short)
	e.do(b, "POST", "/api/v1/account/tokens", map[string]any{"name": "b", "scopes": []string{"read:*"}}, 201, &long)

	e.clock.add(31 * 24 * time.Hour)
	if status, _ := bearer(t, srv, short.Data.Token, "GET", "/api/v1/things"); status != 401 {
		t.Fatalf("expired: %d", status)
	}
	if status, _ := bearer(t, srv, long.Data.Token, "GET", "/api/v1/things"); status != 200 {
		t.Fatalf("no expiry: %d", status)
	}
	if _, err := e.db.Exec(t.Context(), `DELETE FROM workspace_members WHERE user_id = $1`, sess.User.ID); err != nil {
		t.Fatal(err)
	}
	if status, _ := bearer(t, srv, long.Data.Token, "GET", "/api/v1/things"); status != 401 {
		t.Fatalf("after leaving: %d", status)
	}
}

// TestAPITokenRateLimitAndCap: the plan's API requests a minute (APIRate) hold for the workspace, reads and writes
// apart, shared by its tokens and by every instance; a refused write never reaches its handler (audit A04).
func TestAPITokenRateLimitAndCap(t *testing.T) {
	e, srv := tokenEnv(t)
	e.clock.mu.Lock()
	e.clock.t = e.clock.t.Truncate(time.Minute).Add(time.Second) // the minute before weighs nothing yet
	e.clock.mu.Unlock()
	rate := func(_ context.Context, _ string, write bool) (int64, error) {
		if write {
			return 1, nil
		}
		return 2, nil
	}
	e.svc.APIRate = rate
	b := e.emailSignIn("busy@example.com")
	e.session(b)
	var tok, other tokenOut
	e.do(b, "POST", "/api/v1/account/tokens", map[string]any{"name": "a", "scopes": []string{"write:*"}}, 201, &tok)
	e.do(b, "POST", "/api/v1/account/tokens", map[string]any{"name": "b", "scopes": []string{"write:*"}}, 201, &other)

	// a second instance on the same database counts in the same rows
	second, err := New(e.svc.cfg, e.svc.db, e.svc.log)
	if err != nil {
		t.Fatal(err)
	}
	second.now, second.APIRate, second.BearerRoutes = e.clock.now, rate, e.svc.BearerRoutes
	written := 0
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/things", second.SignedIn(func(w http.ResponseWriter, _ *http.Request, _ store.Session) {
		WriteJSON(w, http.StatusOK, nil)
	}))
	mux.HandleFunc("POST /api/v1/things", second.SignedIn(func(w http.ResponseWriter, _ *http.Request, _ store.Session) {
		written++
		WriteJSON(w, http.StatusOK, nil)
	}))
	srv2 := httptest.NewServer(mux)
	t.Cleanup(srv2.Close)

	for i, c := range []struct {
		srv    *httptest.Server
		token  string
		method string
		want   int
	}{
		{srv, tok.Data.Token, "GET", 200},
		{srv2, other.Data.Token, "GET", 200},
		{srv, tok.Data.Token, "GET", 429},     // the workspace's two reads are used, by either token and instance
		{srv2, other.Data.Token, "POST", 200}, // writes count apart
		{srv, tok.Data.Token, "POST", 429},
		{srv2, tok.Data.Token, "POST", 429},
	} {
		if status, _ := bearer(t, c.srv, c.token, c.method, "/api/v1/things"); status != c.want {
			t.Fatalf("request %d: %d, want %d", i, status, c.want)
		}
	}
	if written != 1 {
		t.Fatalf("writes handled: %d", written)
	}
	e.clock.add(time.Minute) // the minute before still weighs 59/60 of its requests
	if status, _ := bearer(t, srv, tok.Data.Token, "GET", "/api/v1/things"); status != 429 {
		t.Fatalf("a minute later: %d", status)
	}
	e.clock.add(time.Minute)
	if status, _ := bearer(t, srv, tok.Data.Token, "GET", "/api/v1/things"); status != 200 {
		t.Fatalf("two minutes later: %d", status)
	}
	for range store.MaxAPITokens - 2 {
		e.do(b, "POST", "/api/v1/account/tokens", map[string]any{"name": "more", "scopes": []string{"read:*"}}, 201, nil)
	}
	var out apiErr
	e.do(b, "POST", "/api/v1/account/tokens", map[string]any{"name": "one too many", "scopes": []string{"read:*"}}, 409, &out)
	if out.Error.Code != "too_many_tokens" {
		t.Fatalf("cap: %+v", out)
	}
}

func TestCanonicalScopes(t *testing.T) {
	resources := []string{"clients", "invoices"}
	for _, c := range []struct {
		in, want []string
	}{
		{[]string{"read:*"}, []string{"read:*"}},
		{[]string{"write:*"}, []string{"read:*", "write:*"}},
		{[]string{"write:invoices"}, []string{"read:invoices", "write:invoices"}},
		{[]string{"read:invoices", "read:*", "write:clients"}, []string{"read:*", "write:clients"}},
		{[]string{"write:*", "write:clients", "read:clients", "read:clients"}, []string{"read:*", "write:*"}},
		{[]string{"read:invoices", "read:clients"}, []string{"read:clients", "read:invoices"}},
		{nil, nil},
		{[]string{"read"}, nil},
		{[]string{"delete:*"}, nil},
		{[]string{"read:members"}, nil},
		{[]string{"read:*", "read:"}, nil},
	} {
		got, ok := canonicalScopes(c.in, resources)
		if ok != (c.want != nil) || !slices.Equal(got, c.want) {
			t.Errorf("%v: %v %v, want %v", c.in, got, ok, c.want)
		}
	}
}

func TestScopesAllow(t *testing.T) {
	for _, c := range []struct {
		scopes          []string
		resource        string
		write, expected bool
	}{
		{[]string{"read:*"}, "invoices", false, true},
		{[]string{"read:*"}, "invoices", true, false},
		{[]string{"read:*", "write:*"}, "clients", true, true},
		{[]string{"read:invoices"}, "invoices", false, true},
		{[]string{"read:invoices"}, "clients", false, false},
		{[]string{"read:invoices", "write:invoices"}, "invoices", true, true},
		{[]string{"read:*", "write:invoices"}, "clients", true, false},
		{[]string{"write:invoices"}, "invoices", false, true}, // write implies read, even if stored alone
	} {
		if got := scopesAllow(c.scopes, c.resource, c.write); got != c.expected {
			t.Errorf("%v %s write=%v: %v", c.scopes, c.resource, c.write, got)
		}
	}
}
