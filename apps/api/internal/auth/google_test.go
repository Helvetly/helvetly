package auth

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestLoginPage(t *testing.T) {
	s := &Service{}
	for _, tc := range []struct{ input, want string }{
		{"", "/login"},
		{"/login", "/login"},
		{"/de/login", "/de/login"},
		{"/pt-BR/login/", "/pt-BR/login"},
		{"https://evil.example/login", "/login"},
		{"//evil.example/login", "/login"},
		{"/de/login/other", "/login"},
		{"/de/login?next=//evil.example", "/login"},
		{"/de\\login", "/login"},
	} {
		r := httptest.NewRequest("GET", "/api/v1/auth/google/start?login="+url.QueryEscape(tc.input), nil)
		if got := s.loginPage(r); got != tc.want {
			t.Errorf("loginPage(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestGoogleCancellationKeepsLocale(t *testing.T) {
	e := newEnv(t)
	b := e.newBrowser()
	e.do(b, "GET", "/api/v1/auth/google/start?login=%2Fde%2Flogin&next=%2Fde%2Finvoices", nil, 302, nil)
	response := e.do(b, "GET", "/api/v1/auth/google/callback?error=access_denied", nil, 302, nil)
	if got := response.Header.Get("Location"); got != "/de/login?error=google_cancelled" {
		t.Fatalf("localized cancellation redirected to %q", got)
	}
}

var (
	ana = fakeIdentity{Sub: "sub-ana", Email: "ana@example.com", Name: "Ana Owner"}
	bob = fakeIdentity{Sub: "sub-bob", Email: "bob@example.com", Name: "Bob"}
)

// googleSignIn runs the browser flow; it returns the browser and where the callback sent it.
func (e *env) googleSignIn(id fakeIdentity, query string, tweak func(*fakeGrant)) (*browser, string) {
	e.t.Helper()
	b := e.newBrowser()
	resp := e.do(b, "GET", "/api/v1/auth/google/start?"+query, nil, 302, nil)
	if e.cookie(b, loginCookie) != "" {
		e.t.Fatal("the login cookie must only be sent to the Google routes")
	}
	state, code := e.google.authorize(resp.Header.Get("Location"), id, tweak)
	resp = e.do(b, "GET", "/api/v1/auth/google/callback?state="+url.QueryEscape(state)+"&code="+url.QueryEscape(code), nil, 302, nil)
	loc := resp.Header.Get("Location")
	if !strings.HasPrefix(loc, "/login") {
		e.session(b)
	}
	return b, loc
}

func (e *env) mustGoogleSignIn(id fakeIdentity, query string) *browser {
	e.t.Helper()
	b, loc := e.googleSignIn(id, query, nil)
	if strings.HasPrefix(loc, "/login") {
		e.t.Fatalf("sign-in of %s failed: %s", id.Email, loc)
	}
	return b
}

func TestGoogleSignIn(t *testing.T) {
	e := newEnv(t)
	b, loc := e.googleSignIn(ana, "next="+url.QueryEscape("/invoices?view=list")+"&timezone=Europe/Warsaw", nil)
	if loc != "/invoices?view=list" {
		t.Fatalf("landing: %q", loc)
	}
	s := e.session(b)
	if s.User.Email != ana.Email || s.User.Name != ana.Name || s.User.AvatarURL != "https://example.com/a.png" ||
		s.Role != "owner" || s.Workspace.Name != "My workspace" || !strings.HasPrefix(s.User.ID, "usr_") || !strings.HasPrefix(s.Workspace.ID, "wsp_") {
		t.Fatalf("session: %+v", s)
	}
	if n := e.count(`SELECT count(*) FROM workspaces WHERE id = $1 AND timezone = 'Europe/Warsaw'`, s.Workspace.ID); n != 1 {
		t.Fatal("the first workspace is not in the browser's zone")
	}

	// Signing in again: the same person and workspace, a new session.
	again := e.mustGoogleSignIn(ana, "")
	if e.cookie(again, sessionCookie) == e.cookie(b, sessionCookie) {
		t.Fatal("a sign-in must issue a new session token")
	}
	if s2 := e.session(again); s2.User.ID != s.User.ID || s2.Workspace.ID != s.Workspace.ID {
		t.Fatalf("returning person: %+v", s2)
	}
	// The address is the person: another Google account with the same verified address is the same user.
	other := e.session(e.mustGoogleSignIn(fakeIdentity{Sub: "sub-ana-2", Email: "Ana@Example.com", Name: "Other Ana"}, ""))
	if other.User.ID != s.User.ID || other.User.Name != ana.Name {
		t.Fatalf("the same address got another person: %+v", other)
	}
	if n := e.count(`SELECT count(*) FROM workspaces`); n != 1 {
		t.Fatalf("%d workspaces, want 1", n)
	}
}

func TestGoogleSignInRejects(t *testing.T) {
	e := newEnv(t)
	for _, tc := range []struct {
		name  string
		id    fakeIdentity
		query string
		tweak func(*fakeGrant)
		want  string
	}{
		{"another nonce", ana, "", func(g *fakeGrant) { g.nonce = "replayed" }, "login_failed"},
		{"another audience", ana, "", func(g *fakeGrant) { g.audience = "someone-else" }, "login_failed"},
		{"another issuer", ana, "", func(g *fakeGrant) { g.issuer = "https://evil.example" }, "login_failed"},
		{"wrong PKCE", ana, "", func(g *fakeGrant) { g.challenge = "nope" }, "login_failed"},
		{"no ID token", ana, "", func(g *fakeGrant) { g.noIDToken = true }, "login_failed"},
		{"unverified email", fakeIdentity{Sub: "u", Email: "u@example.com", Unverified: true}, "", nil, "email_unverified"},
		{"too late", ana, "", func(*fakeGrant) { e.clock.add(loginTTL + time.Second) }, "login_expired"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, loc := e.googleSignIn(tc.id, tc.query, tc.tweak); loc != "/login?error="+tc.want {
				t.Fatalf("landing: %s", loc)
			}
		})
	}
	if n := e.count(`SELECT count(*) FROM users`); n != 0 {
		t.Fatalf("a refused sign-in made %d users", n)
	}

	// A callback with a state this browser did not start, or in another browser, or used twice.
	b := e.newBrowser()
	resp := e.do(b, "GET", "/api/v1/auth/google/start", nil, 302, nil)
	state, code := e.google.authorize(resp.Header.Get("Location"), ana, nil)
	for _, tc := range []struct {
		name  string
		b     *browser
		query string
	}{
		{"forged state", b, "state=forged&code=" + code},
		{"another browser", e.newBrowser(), "state=" + url.QueryEscape(state) + "&code=" + code},
		{"cookie used up", b, "state=" + url.QueryEscape(state) + "&code=" + code},
	} {
		if loc := e.do(tc.b, "GET", "/api/v1/auth/google/callback?"+tc.query, nil, 302, nil).Header.Get("Location"); loc != "/login?error=login_expired" {
			t.Errorf("%s: %s", tc.name, loc)
		}
	}
	if loc := e.do(e.newBrowser(), "GET", "/api/v1/auth/google/callback?error=access_denied", nil, 302, nil).Header.Get("Location"); loc != "/login?error=google_cancelled" {
		t.Errorf("cancelled: %s", loc)
	}

	// next never leaves the platform.
	for _, next := range []string{"//evil.example/x", "https://evil.example", "/login"} {
		if _, loc := e.googleSignIn(bob, "next="+url.QueryEscape(next), nil); loc != "/" {
			t.Errorf("next %q: %s", next, loc)
		}
	}
}
