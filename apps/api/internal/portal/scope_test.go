package portal

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// scopedEnv adds a second workspace (Other, slug "other") where ana@acme.ch is also a client, and gives Studio the
// slug "studio".
func scopedEnv(t *testing.T) *env {
	e := newEnv(t)
	if err := e.store.CreateWorkspace(context.Background(), store.Workspace{ID: "wsp_b", Name: "Other"}, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	e.client("cli_9", "wsp_b", "Acme of Other", "ana@acme.ch", "")
	e.exec(`INSERT INTO portal_slugs (slug, workspace_id, created_at, retired_at) VALUES ('studio', 'wsp_a', now(), NULL),
		('other', 'wsp_b', now(), NULL), ('studio-old', 'wsp_a', now(), now())`)
	return e
}

// scopedCookie is the session cookie a response set, whatever its scope's name.
func scopedCookie(res *http.Response) *http.Cookie {
	for _, c := range res.Cookies() {
		if strings.HasPrefix(c.Name, sessionCookie) && c.Value != "" {
			return c
		}
	}
	return nil
}

func (e *env) signInAt(prefix, email string) (*http.Cookie, string) {
	e.t.Helper()
	res, out := e.doAt(prefix, "POST", "/auth/verify", map[string]string{"email": email, "code": "123456"}, nil, "")
	c := scopedCookie(res)
	if res.StatusCode != 201 || c == nil {
		e.t.Fatalf("verify at %q: %d %v", prefix, res.StatusCode, out)
	}
	return c, out["csrf_token"].(string)
}

// TestScopedStartIsEnumerationSafe: under a scope, an address of another workspace's client gets the same answer as
// any unknown one, and no code.
func TestScopedStartIsEnumerationSafe(t *testing.T) {
	e := scopedEnv(t)
	answer := func(prefix, email string) (int, any, any) {
		res, out := e.doAt(prefix, "POST", "/auth/start", map[string]string{"email": email}, nil, "")
		return res.StatusCode, out["resend_in"], out["expires_in"]
	}
	wantStatus, wantResend, wantExpires := answer("/w/other", "nobody@x.ch")
	for _, tc := range []struct {
		name, prefix, email string
		sends               bool
	}{
		{"unknown address", "/w/other", "nobody@x.ch", false},
		{"client of another workspace only", "/w/other", "bob@beta.ch", false},
		{"client of this workspace", "/w/other", "ana@acme.ch", true},
		{"client here, by billing address", "/w/studio", "ANA@acme.ch", true},
		{"unscoped keeps today's search", "", "bob@beta.ch", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := e.auth.sent
			status, resend, expires := answer(tc.prefix, tc.email)
			if status != wantStatus || resend != wantResend || expires != wantExpires {
				t.Fatalf("answer %d %v %v differs from %d %v %v", status, resend, expires, wantStatus, wantResend, wantExpires)
			}
			if sent := e.auth.sent > before; sent != tc.sends {
				t.Fatalf("code sent = %v, want %v", sent, tc.sends)
			}
		})
	}
}

// TestScopedSignInReachesOnlyThatWorkspace: a session made under a scope lists and switches to that workspace's
// clients only, and verifying there with another workspace's address finds nothing.
func TestScopedSignInReachesOnlyThatWorkspace(t *testing.T) {
	e := scopedEnv(t)
	if res, out := e.doAt("/w/other", "POST", "/auth/verify", map[string]string{"email": "bob@beta.ch", "code": "123456"}, nil, ""); res.StatusCode != 403 {
		t.Fatalf("another workspace's client signed in: %d %v", res.StatusCode, out)
	}
	c, csrf := e.signInAt("/w/studio", "ana@acme.ch")
	if c.Name != sessionCookie+"_wsp_a" {
		t.Fatalf("cookie name %q", c.Name)
	}
	_, out := e.doAt("/w/studio", "GET", "/session", nil, c, "")
	clients := out["clients"].([]any)
	for _, cl := range clients {
		if cl.(map[string]any)["workspace_name"] != "Studio" {
			t.Fatalf("scoped session lists %v", clients)
		}
	}
	if len(clients) != 2 {
		t.Fatalf("clients %v", clients)
	}
	if res, _ := e.doAt("/w/studio", "POST", "/session/client", map[string]string{"client_id": "cli_9"}, c, csrf); res.StatusCode != 404 {
		t.Fatalf("switched to another workspace's client: %d", res.StatusCode)
	}
	// The same client unscoped still sees both workspaces, as before scopes.
	u, _ := e.signIn("ana@acme.ch")
	if _, out := e.do("GET", "/session", nil, u, ""); len(out["clients"].([]any)) != 3 {
		t.Fatalf("unscoped clients %v", out["clients"])
	}
}

// TestSessionValidOnlyInItsScope: a session of one scope reads nothing under another or unscoped, even under the
// other's cookie name; an unscoped one reads nothing under a scope.
func TestSessionValidOnlyInItsScope(t *testing.T) {
	e := scopedEnv(t)
	a, _ := e.signInAt("/w/studio", "ana@acme.ch")
	u, _ := e.signIn("ana@acme.ch")
	rename := func(c *http.Cookie, name string) *http.Cookie { return &http.Cookie{Name: name, Value: c.Value} }
	for _, tc := range []struct {
		name, prefix string
		cookie       *http.Cookie
		status       int
	}{
		{"own scope", "/w/studio", a, 200},
		{"own scope under a retired slug", "/w/studio-old", a, 200},
		{"another scope", "/w/other", a, 401},
		{"another scope, its cookie name", "/w/other", rename(a, sessionCookie+"_wsp_b"), 401},
		{"unscoped", "", rename(a, sessionCookie), 401},
		{"unscoped session under a scope", "/w/studio", rename(u, sessionCookie+"_wsp_a"), 401},
		{"unscoped session unscoped", "", u, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, path := range []string{"/session", "/invoices"} {
				if res, _ := e.doAt(tc.prefix, "GET", path, nil, tc.cookie, ""); res.StatusCode != tc.status {
					t.Fatalf("%s: %d, want %d", path, res.StatusCode, tc.status)
				}
			}
		})
	}
}

// TestSignInOnEachScopeSeparately: one address, client of two workspaces, holds a session on each scope at once.
func TestSignInOnEachScopeSeparately(t *testing.T) {
	e := scopedEnv(t)
	a, _ := e.signInAt("/w/studio", "ana@acme.ch")
	b, _ := e.signInAt("/w/other", "ana@acme.ch")
	if a.Name == b.Name {
		t.Fatalf("one cookie for both scopes: %q", a.Name)
	}
	for prefix, want := range map[string]string{"/w/studio": "Studio", "/w/other": "Other"} {
		_, out := e.doAt(prefix, "GET", "/session", nil, map[string]*http.Cookie{"/w/studio": a, "/w/other": b}[prefix], "")
		if out["workspace"].(map[string]any)["name"] != want {
			t.Fatalf("%s: %v", prefix, out)
		}
	}
}

func TestScopeEndpoint(t *testing.T) {
	e := scopedEnv(t)
	e.exec(`UPDATE workspaces SET logo_file_id = 'logo1' WHERE id = 'wsp_a'`)
	e.files.objects[store.WorkspaceLogoKey("wsp_a", "logo1")] = []byte("png")
	res, out := e.doAt("/w/studio-old", "GET", "/scope", nil, nil, "")
	if res.StatusCode != 200 || out["name"] != "Studio" || out["slug"] != "studio" ||
		out["logo_url"] != "/w/studio/api/v1/public/portal/scope/logo?v=logo1" || out["url"] != e.srv.URL+"/w/studio/" {
		t.Fatalf("scope: %d %v", res.StatusCode, out)
	}
	if len(out) != 4 {
		t.Fatalf("more than the minimum: %v", out)
	}
	if res, out = e.doAt("/w/other", "GET", "/scope", nil, nil, ""); res.StatusCode != 200 || out["logo_url"] != nil {
		t.Fatalf("no logo: %d %v", res.StatusCode, out)
	}
	if res, _ = e.doAt("", "GET", "/scope", nil, nil, ""); res.StatusCode != 404 {
		t.Fatalf("unscoped: %d", res.StatusCode)
	}
	if res, _ = e.doAt("/w/nobody", "GET", "/scope", nil, nil, ""); res.StatusCode != 404 {
		t.Fatalf("unknown: %d", res.StatusCode)
	}
	if res, _ = e.doAt("/w/other", "GET", "/scope/logo", nil, nil, ""); res.StatusCode != 404 {
		t.Fatalf("logo of a workspace without one: %d", res.StatusCode)
	}
	e.exec(`UPDATE workspaces SET deleted_at = now() WHERE id = 'wsp_b'`)
	if res, _ = e.doAt("/w/other", "GET", "/scope", nil, nil, ""); res.StatusCode != 404 {
		t.Fatalf("deleted workspace: %d", res.StatusCode)
	}
}

// onHost asks the portal API at path on a workspace's own domain (the Host header, as Cloudflare and Caddy pass it).
func (e *env) onHost(host, method, path string, cookie *http.Cookie, body string) (*http.Response, map[string]any) {
	e.t.Helper()
	req, _ := http.NewRequest(method, e.srv.URL+path, strings.NewReader(body))
	req.Host = host
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res, out
}

// TestCustomDomains: an active domain is its workspace's portal at the root; a session of one workspace's domain is
// refused on another's, even under that one's cookie name, and the cookie is host-only.
func TestCustomDomains(t *testing.T) {
	e := scopedEnv(t)
	if err := e.store.CreateWorkspace(context.Background(), store.Workspace{ID: "wsp_c", Name: "Third"}, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	e.exec(`INSERT INTO portal_slugs (slug, workspace_id, created_at) VALUES ('third', 'wsp_c', now())`)
	e.exec(`INSERT INTO workspace_domains (id, workspace_id, hostname, status, next_check_at, created_by, created_at, updated_at) VALUES
		('dom_a', 'wsp_a', 'portal.studio.ch', 'active', now(), 'usr', now(), now()),
		('dom_b', 'wsp_b', 'portal.other.ch', 'active', now(), 'usr', now(), now()),
		('dom_c', 'wsp_c', 'pending.third.ch', 'pending', now(), 'usr', now(), now())`)
	e.exec(`UPDATE workspaces SET logo_file_id = 'logo1' WHERE id = 'wsp_a'`) // before the first request: the resolver caches
	const api = "/api/v1/public/portal"
	res, out := e.onHost("portal.studio.ch", "POST", api+"/auth/verify", nil, `{"email":"ana@acme.ch","code":"123456"}`)
	a := scopedCookie(res)
	if res.StatusCode != 201 || a == nil || a.Name != sessionCookie+"_wsp_a" || a.Domain != "" {
		t.Fatalf("sign in on the domain: %d %v %+v", res.StatusCode, out, a)
	}
	if res, _ := e.onHost("portal.other.ch", "POST", api+"/auth/verify", nil, `{"email":"bob@beta.ch","code":"123456"}`); res.StatusCode != 403 {
		t.Fatalf("another workspace's client signed in on B's domain: %d", res.StatusCode)
	}
	rename := func(name string) *http.Cookie { return &http.Cookie{Name: name, Value: a.Value} }
	for _, tc := range []struct {
		name, host, path string
		cookie           *http.Cookie
		status           int
	}{
		{"own domain", "portal.studio.ch", api + "/session", a, 200},
		{"own workspace under its slug", "127.0.0.1", "/w/studio" + api + "/session", a, 200},
		{"another workspace's domain", "portal.other.ch", api + "/session", a, 401},
		{"another workspace's domain, its cookie name", "portal.other.ch", api + "/session", rename(sessionCookie + "_wsp_b"), 401},
		{"unscoped", "127.0.0.1", api + "/session", rename(sessionCookie), 401},
		{"staff api on a domain", "portal.studio.ch", "/api/v1/invoices", a, 404},
		{"pending domain is no scope", "pending.third.ch", api + "/scope", nil, 404},
		{"unknown host is no scope", "portal.nobody.ch", api + "/scope", nil, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			host := tc.host
			if host == "127.0.0.1" {
				host = strings.TrimPrefix(e.srv.URL, "http://")
			}
			if res, _ := e.onHost(host, "GET", tc.path, tc.cookie, ""); res.StatusCode != tc.status {
				t.Fatalf("%s %s: %d, want %d", host, tc.path, res.StatusCode, tc.status)
			}
		})
	}
	res, out = e.onHost("portal.studio.ch", "GET", api+"/scope", nil, "")
	if res.StatusCode != 200 || out["slug"] != "studio" || out["url"] != "http://portal.studio.ch/" || out["logo_url"] != api+"/scope/logo?v=logo1" {
		t.Fatalf("scope on the domain: %d %v", res.StatusCode, out)
	}
}
