package auth

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store/storetest"
)

// ---- a deterministic fake Google: OpenID discovery, JWKS, a token endpoint signing RS256 ID tokens ----

type fakeIdentity struct {
	Sub, Email, Name string
	Unverified       bool
}

type fakeGrant struct {
	id               fakeIdentity
	nonce, challenge string
	audience, issuer string
	noIDToken        bool
}

type fakeGoogle struct {
	t      *testing.T
	srv    *httptest.Server
	key    *rsa.PrivateKey
	mu     sync.Mutex
	grants map[string]fakeGrant
}

const testClientID = "client.apps.googleusercontent.com"

func newFakeGoogle(t *testing.T) *fakeGoogle {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	g := &fakeGoogle{t: t, key: key, grants: map[string]fakeGrant{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"issuer": g.srv.URL, "authorization_endpoint": g.srv.URL + "/auth",
			"token_endpoint": g.srv.URL + "/token", "jwks_uri": g.srv.URL + "/jwks", "id_token_signing_alg_values_supported": []string{"RS256"}})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"}}})
	})
	mux.HandleFunc("/token", g.token)
	g.srv = httptest.NewServer(mux)
	t.Cleanup(g.srv.Close)
	return g
}

// token checks the client secret and the PKCE verifier, then signs an ID token for the grant.
func (g *fakeGoogle) token(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	id, secret, ok := r.BasicAuth()
	if !ok {
		id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	g.mu.Lock()
	gr, found := g.grants[r.PostForm.Get("code")]
	delete(g.grants, r.PostForm.Get("code")) // codes are single use
	g.mu.Unlock()
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if !found || id != testClientID || secret != "secret" || base64.RawURLEncoding.EncodeToString(sum[:]) != gr.challenge {
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	signer, _ := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: g.key}, (&jose.SignerOptions{}).WithHeader("kid", "k1").WithType("JWT"))
	aud, iss := testClientID, g.srv.URL
	if gr.audience != "" {
		aud = gr.audience
	}
	if gr.issuer != "" {
		iss = gr.issuer
	}
	now := time.Now()
	raw, err := jwt.Signed(signer).Claims(jwt.Claims{Issuer: iss, Subject: gr.id.Sub, Audience: jwt.Audience{aud},
		IssuedAt: jwt.NewNumericDate(now), Expiry: jwt.NewNumericDate(now.Add(time.Hour))}).Claims(map[string]any{
		"email": gr.id.Email, "email_verified": !gr.id.Unverified, "name": gr.id.Name, "picture": "https://example.com/a.png", "nonce": gr.nonce}).Serialize()
	if err != nil {
		g.t.Error(err)
	}
	body := map[string]any{"access_token": "at", "token_type": "Bearer", "expires_in": 3600, "id_token": raw}
	if gr.noIDToken {
		delete(body, "id_token")
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

// authorize stands in for the person approving at Google: a code bound to the start URL's nonce and PKCE challenge.
func (g *fakeGoogle) authorize(authURL string, id fakeIdentity, tweak func(*fakeGrant)) (state, code string) {
	g.t.Helper()
	u, err := url.Parse(authURL)
	if err != nil || !strings.HasPrefix(authURL, g.srv.URL+"/auth") {
		g.t.Fatalf("start did not redirect to Google: %q", authURL)
	}
	q := u.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("nonce") == "" || q.Get("state") == "" || q.Get("client_id") != testClientID {
		g.t.Fatalf("authorization request without PKCE, nonce or state: %s", authURL)
	}
	gr := fakeGrant{id: id, nonce: q.Get("nonce"), challenge: q.Get("code_challenge")}
	if tweak != nil {
		tweak(&gr)
	}
	code = "code_" + rand.Text()
	g.mu.Lock()
	g.grants[code] = gr
	g.mu.Unlock()
	return q.Get("state"), code
}

// ---- the test server ----

type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) add(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type fakeMailer struct {
	mu   sync.Mutex
	sent []mail.Message
	err  error
}

func (m *fakeMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return m.err
}

const (
	testRPID   = "helvetly.example.com"
	testOrigin = "https://helvetly.example.com"
)

type env struct {
	t      *testing.T
	svc    *Service
	srv    *httptest.Server
	db     *pgxpool.Pool // raw SQL on the test's schema
	google *fakeGoogle
	clock  *testClock
	mail   *fakeMailer
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	g := newFakeGoogle(t)
	cfg := config.Config{PublicURL: testOrigin, SecretKey: bytes.Repeat([]byte{7}, 32), GoogleClientID: testClientID,
		GoogleClientSecret: "secret", SessionTTL: time.Hour, DevSignIn: true, PortalURL: "https://portal.example.com"}
	svc, err := New(cfg, st, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	clock := &testClock{t: time.Now().UTC()}
	m := &fakeMailer{}
	svc.googleIssuer, svc.now, svc.mail = g.srv.URL, clock.now, m
	mux := http.NewServeMux()
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, svc: svc, srv: srv, db: raw, google: g, clock: clock, mail: m}
}

// browser is one client with its cookies and, once signed in, its CSRF token.
type browser struct {
	c    *http.Client
	csrf string
}

func (e *env) newBrowser() *browser {
	jar, _ := cookiejar.New(nil)
	return &browser{c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// do sends a JSON request (body nil: none) and decodes the answer into out; want 0 accepts any status.
func (e *env) do(b *browser, method, path string, body any, want int, out any) *http.Response {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			e.t.Fatal(err)
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	c := http.DefaultClient
	if b != nil {
		c = b.c
		if b.csrf != "" {
			req.Header.Set(csrfHeader, b.csrf)
		}
	}
	resp, err := c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if want != 0 && resp.StatusCode != want {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, want, raw)
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
	return resp
}

type apiErr struct {
	Error struct {
		Code    string         `json:"code"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

type sessionOut struct {
	User struct {
		ID, Email, Name string
		AvatarURL       string `json:"avatar_url"`
	} `json:"user"`
	Workspace struct{ ID, Name string } `json:"workspace"`
	Role      string                    `json:"role"`
	Onboarded bool                      `json:"onboarded"`
	CSRF      string                    `json:"csrf_token"`
}

// session reads GET /session and remembers the CSRF token.
func (e *env) session(b *browser) sessionOut {
	e.t.Helper()
	var s sessionOut
	e.do(b, "GET", "/api/v1/session", nil, 200, &s)
	b.csrf = s.CSRF
	return s
}

func (e *env) cookie(b *browser, name string) string {
	u, _ := url.Parse(e.srv.URL)
	for _, c := range b.c.Jar.Cookies(u) {
		if c.Name == name {
			return c.Value
		}
	}
	return ""
}

func (e *env) count(sql string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.db.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestRequests(t *testing.T) {
	e := newEnv(t)
	var cfg map[string]any
	e.do(nil, "GET", "/api/v1/auth/config", nil, 200, &cfg)
	if cfg["google"] != true || cfg["email"] != true || cfg["passkey"] != true || cfg["dev_codes"] != true || cfg["portal_url"] != "https://portal.example.com" || cfg["google_analytics_id"] != "" || cfg["api_url"] != testOrigin {
		t.Fatalf("config: %v", cfg)
	}

	for _, tc := range []struct {
		name, contentType, body string
		status                  int
		code                    string
	}{
		{"form post", "application/x-www-form-urlencoded", "email=a@example.com", 415, "unsupported_media_type"},
		{"no content type", "", `{"email":"a@example.com"}`, 415, "unsupported_media_type"},
		{"unknown field", "application/json", `{"email":"a@example.com","admin":true}`, 400, "invalid_request"},
		{"two objects", "application/json", `{"email":"a@example.com"}{}`, 400, "invalid_request"},
		{"not json", "application/json; charset=utf-8", `email`, 400, "invalid_request"},
		{"not an address", "application/json", `{"email":"not an address"}`, 400, "invalid_email"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/auth/email/start", strings.NewReader(tc.body))
			if tc.contentType != "" {
				req.Header.Set("Content-Type", tc.contentType)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			var out apiErr
			_ = json.NewDecoder(resp.Body).Decode(&out)
			if resp.StatusCode != tc.status || out.Error.Code != tc.code {
				t.Fatalf("%d %q, want %d %q", resp.StatusCode, out.Error.Code, tc.status, tc.code)
			}
		})
	}

	// Without AUTH_DEV_SIGNIN, the dev-code endpoint does not exist.
	e.sendCode("dev@example.com", 202)
	e.svc.cfg.DevSignIn = false
	e.do(nil, "GET", "/api/v1/auth/email/dev-code?email=dev@example.com", nil, 404, nil)
}

func TestSessionAndCSRF(t *testing.T) {
	e := newEnv(t)
	var out apiErr
	e.do(e.newBrowser(), "GET", "/api/v1/session", nil, 401, &out)
	if out.Error.Code != "unauthenticated" {
		t.Fatalf("signed out: %+v", out)
	}
	b := e.emailSignIn("csrf@example.com")
	other := e.emailSignIn("other@example.com")

	// Unsafe requests need the session's own token.
	for _, token := range []string{"", "wrong", other.csrf} {
		forged := &browser{c: b.c, csrf: token}
		e.do(forged, "DELETE", "/api/v1/session", nil, 403, &out)
		if out.Error.Code != "csrf_failed" {
			t.Fatalf("token %q: %+v", token, out)
		}
		e.do(forged, "POST", "/api/v1/account/passkeys/start", map[string]any{}, 403, nil)
	}
	e.do(b, "POST", "/api/v1/account/passkeys/start", map[string]any{}, 200, nil)

	// Logout ends this session only.
	e.do(b, "DELETE", "/api/v1/session", nil, 204, nil)
	e.do(b, "GET", "/api/v1/session", nil, 401, nil)
	if e.cookie(b, sessionCookie) != "" {
		t.Fatal("logout left the cookie")
	}
	e.session(other)

	// Sessions end after SESSION_TTL.
	e.clock.add(time.Hour + time.Second)
	e.do(other, "GET", "/api/v1/session", nil, 401, nil)
}

func TestSafeNext(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"", "/"},
		{"/invoices?view=list#top", "/invoices?view=list#top"},
		{"/", "/"},
		{"//evil.example/x", "/"},
		{"https://evil.example", "/"},
		{"/\\evil.example", "/"},
		{"javascript:alert(1)", "/"},
		{"/ok\r\nSet-Cookie: x", "/"},
		{"/login", "/"},
		{"/login?next=/x", "/"},
		{"/login/", "/"},
		{"/de/login", "/"},
		{"/pt-BR/login/again", "/"},
		{"/de/invoices", "/de/invoices"},
		{"/loginx", "/loginx"},
		{"/" + strings.Repeat("a", 600), "/"},
	} {
		if got := SafeNext(tc.in); got != tc.want {
			t.Errorf("SafeNext(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestClientIP(t *testing.T) {
	for _, tc := range []struct{ remote, want string }{
		{"203.0.113.7:5000", "203.0.113.7"},
		{"[::ffff:203.0.113.7]:5000", "203.0.113.7"},
		{"[2001:db8:1:2:3:4:5:6]:5000", "2001:db8:1:2::/64"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = tc.remote
		if got := clientIP(r); got != tc.want {
			t.Errorf("clientIP(%q) = %q, want %q", tc.remote, got, tc.want)
		}
	}
}
