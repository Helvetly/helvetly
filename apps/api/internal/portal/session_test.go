package portal

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"helvetly.com/api/internal/auth"

	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/portalscope"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// fakeAuth keeps the real error and JSON conventions; the code is always 123456 and sending is counted.
type fakeAuth struct {
	*auth.Service
	sent int
}

func (f *fakeAuth) SendEmailCode(_ *http.Request, _ string, deliver bool) error {
	if deliver {
		f.sent++
	}
	return nil
}
func (f *fakeAuth) ConsumeEmailCode(_ context.Context, email, code string) (string, error) {
	if code != "123456" {
		return "", auth.Error(http.StatusGone, "code_expired", "bad code", nil)
	}
	return strings.ToLower(email), nil
}

type env struct {
	t    *testing.T
	srv  *httptest.Server
	auth *fakeAuth
	exec func(sql string, args ...any)
	raw  interface {
		QueryRow(context.Context, string, ...any) pgx.Row
	}
	files *fakeFiles
	store *store.Store
}

func newEnv(t *testing.T) *env {
	t.Helper()
	st, raw := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32), SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	fa := &fakeAuth{Service: a}
	mux := http.NewServeMux()
	files := &fakeFiles{objects: map[string][]byte{}}
	// The real resolver in front, as in main: /w/<slug>/api/… reaches the mux scoped.
	var front http.Handler
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { front.ServeHTTP(w, r) }))
	t.Cleanup(srv.Close)
	scopes := portalscope.New(srv.URL, st.Q)
	scopes.EnableDomains() // the test server's own host stays the portal's; workspace_domains rows add others
	New(st, fa, files, scopes, Config{SessionTTL: time.Hour, CookieSecure: true}, discard).Register(mux)
	front = scopes.Handler(mux)
	e := &env{t: t, srv: srv, auth: fa, files: files, raw: raw, store: st}
	e.exec = func(sql string, args ...any) {
		t.Helper()
		if _, err := raw.Exec(context.Background(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	if err := st.CreateWorkspace(context.Background(), store.Workspace{ID: "wsp_a", Name: "Studio"}, "UTC", now); err != nil {
		t.Fatal(err)
	}
	// One address can be the login of several clients (Acme and Beta); a contact's address is never one.
	e.client("cli_1", "wsp_a", "Acme AG", "ana@acme.ch", "")
	e.client("cli_2", "wsp_a", "Beta AG", "", "ANA@acme.ch")
	e.client("cli_3", "wsp_a", "Gamma AG", "bob@beta.ch", "")
	e.exec(`INSERT INTO client_contacts (id, client_id, workspace_id, name, email, created_at, updated_at) VALUES ('con_1','cli_1','wsp_a','Cleo','cleo@acme.ch',now(),now())`)
	return e
}

// client adds a client with the portal on; email and billing ("" for none) decide its login.
func (e *env) client(id, workspace, name, email, billing string) {
	e.exec(`INSERT INTO clients (id, workspace_id, number, name, email, billing_email, portal_enabled, created_at, updated_at)
		VALUES ($1,$2,(SELECT count(*)+1 FROM clients),$3,nullif($4,''),nullif($5,''),true,now(),now())`, id, workspace, name, email, billing)
}

func (e *env) do(method, path string, body any, cookie *http.Cookie, csrf string) (*http.Response, map[string]any) {
	e.t.Helper()
	return e.doAt("", method, path, body, cookie, csrf)
}

// doAt calls the portal API under prefix ("" unscoped, "/w/<slug>" scoped), as the portal's pages do.
func (e *env) doAt(prefix, method, path string, body any, cookie *http.Cookie, csrf string) (*http.Response, map[string]any) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+prefix+"/api/v1/public/portal"+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
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

func sessionCookie_(res *http.Response) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == sessionCookie {
			return c
		}
	}
	return nil
}

// signIn opens an unscoped session for email in its first client. An address with several clients is offered a
// choice on the shared portal instead; its session is then the one the account menu's switch opens there, made
// directly here (the choice itself is TestChooser's).
func (e *env) signIn(email string) (*http.Cookie, string) {
	e.t.Helper()
	res, out := e.do("POST", "/auth/verify", map[string]string{"email": email, "code": "123456"}, nil, "")
	if res.StatusCode == 200 && out["accounts"] != nil {
		first := out["accounts"].([]any)[0].(map[string]any)["client_id"].(string)
		var workspace string
		if err := e.raw.QueryRow(context.Background(), `SELECT workspace_id FROM clients WHERE id = $1`, first).Scan(&workspace); err != nil {
			e.t.Fatal(err)
		}
		token, csrf := rand.Text(), rand.Text()
		if err := e.store.Q.CreatePortalSession(context.Background(), auth.NewID("pse"), hashToken(token), csrf, email, first, workspace, false, time.Now(), time.Now().Add(time.Hour)); err != nil {
			e.t.Fatal(err)
		}
		return &http.Cookie{Name: sessionCookie, Value: token}, csrf
	}
	c := sessionCookie_(res)
	if res.StatusCode != 201 || c == nil {
		e.t.Fatalf("verify: %d %v", res.StatusCode, out)
	}
	return c, out["csrf_token"].(string)
}

func TestStartUnknownEmail202NoCode(t *testing.T) {
	e := newEnv(t)
	res, out := e.do("POST", "/auth/start", map[string]string{"email": "nobody@x.ch"}, nil, "")
	if res.StatusCode != 202 || out["resend_in"] == nil || e.auth.sent != 0 {
		t.Fatalf("unknown: %d %v sent=%d", res.StatusCode, out, e.auth.sent)
	}
	if res, _ = e.do("POST", "/auth/start", map[string]string{"email": "ANA@acme.ch"}, nil, ""); res.StatusCode != 202 || e.auth.sent != 1 {
		t.Fatalf("known: %d sent=%d", res.StatusCode, e.auth.sent)
	}
	if res, _ = e.do("POST", "/auth/start", map[string]string{"email": "nope"}, nil, ""); res.StatusCode != 400 {
		t.Fatalf("invalid: %d", res.StatusCode)
	}
}

func TestVerifyNoAccess403(t *testing.T) {
	e := newEnv(t)
	res, out := e.do("POST", "/auth/verify", map[string]string{"email": "nobody@x.ch", "code": "123456"}, nil, "")
	if res.StatusCode != 403 || out["error"].(map[string]any)["code"] != "no_portal_access" {
		t.Fatalf("got %d %v", res.StatusCode, out)
	}
	// A contact of a client with the portal on is not a login.
	if res, _ = e.do("POST", "/auth/verify", map[string]string{"email": "cleo@acme.ch", "code": "123456"}, nil, ""); res.StatusCode != 403 {
		t.Fatalf("contact: %d", res.StatusCode)
	}
	if res, _ = e.do("POST", "/auth/verify", map[string]string{"email": "ana@acme.ch", "code": "000000"}, nil, ""); res.StatusCode != 410 {
		t.Fatalf("bad code: %d", res.StatusCode)
	}
}

func TestVerifyCookieOfTheOnlyClient(t *testing.T) {
	e := newEnv(t)
	res, _ := e.do("POST", "/auth/verify", map[string]string{"email": "Bob@Beta.ch", "code": "123456"}, nil, "")
	c := sessionCookie_(res)
	if res.StatusCode != 201 || c == nil || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie: %d %+v", res.StatusCode, c)
	}
	_, out := e.do("GET", "/session", nil, c, "")
	if out["client"].(map[string]any)["id"] != "cli_3" || len(out["clients"].([]any)) != 1 {
		t.Fatalf("session: %v", out)
	}
}

func TestCSRFRequiredOnWrite(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	res, out := e.do("DELETE", "/session", nil, c, "")
	if res.StatusCode != 403 || out["error"].(map[string]any)["code"] != "csrf_failed" {
		t.Fatalf("no csrf: %d %v", res.StatusCode, out)
	}
	if res, _ = e.do("DELETE", "/session", nil, c, csrf); res.StatusCode != 204 {
		t.Fatalf("logout: %d", res.StatusCode)
	}
	if res, _ = e.do("GET", "/session", nil, c, ""); res.StatusCode != 401 {
		t.Fatalf("after logout: %d", res.StatusCode)
	}
	if res, _ = e.do("GET", "/session", nil, nil, ""); res.StatusCode != 401 {
		t.Fatalf("no cookie: %d", res.StatusCode)
	}
}

func TestSwitchClientNewTokenOldDeleted(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	res, out := e.do("POST", "/session/client", map[string]string{"client_id": "cli_2"}, c, csrf)
	c2 := sessionCookie_(res)
	if res.StatusCode != 201 || c2 == nil || c2.Value == c.Value || out["csrf_token"] == csrf {
		t.Fatalf("switch: %d %v", res.StatusCode, out)
	}
	if res, _ = e.do("GET", "/session", nil, c, ""); res.StatusCode != 401 {
		t.Fatalf("old session: %d", res.StatusCode)
	}
	_, got := e.do("GET", "/session", nil, c2, "")
	if got["client"].(map[string]any)["id"] != "cli_2" {
		t.Fatalf("new session: %v", got)
	}
}

func TestSwitchClientOtherAddress404(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("bob@beta.ch")
	if res, _ := e.do("POST", "/session/client", map[string]string{"client_id": "cli_1"}, c, csrf); res.StatusCode != 404 {
		t.Fatalf("got %d", res.StatusCode)
	}
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 200 {
		t.Fatalf("session must survive: %d", res.StatusCode)
	}
}

func TestSessionRevokedMidway(t *testing.T) {
	e := newEnv(t)
	c, _ := e.signIn("ana@acme.ch")
	e.exec(`UPDATE clients SET portal_enabled = false WHERE id = 'cli_1'`)
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 401 {
		t.Fatalf("got %d", res.StatusCode)
	}
}

func TestSwitchClientIsOneTransaction(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	// A session row that cannot be created must keep the old session.
	e.exec(`CREATE FUNCTION fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'no'; END $$`)
	e.exec(`CREATE TRIGGER fail_insert BEFORE INSERT ON portal_sessions FOR EACH ROW EXECUTE FUNCTION fail_insert()`)
	if res, _ := e.do("POST", "/session/client", map[string]string{"client_id": "cli_2"}, c, csrf); res.StatusCode != 500 {
		t.Fatalf("switch: %d", res.StatusCode)
	}
	e.exec(`DROP TRIGGER fail_insert ON portal_sessions`)
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 200 {
		t.Fatalf("old session must survive a failed switch: %d", res.StatusCode)
	}
}

// TestStartSameAnswerWithOrWithoutAccess: with the real email codes, an address with access and one without
// get the same status and body on every start, the cooldown and the daily limit included, and only the first
// gets a code.
func TestStartSameAnswerWithOrWithoutAccess(t *testing.T) {
	e := newEnv(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32), DevSignIn: true, SessionTTL: time.Hour}, e.store, discard)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	a.Register(mux)
	New(e.store, a, e.files, portalscope.New("", e.store.Q), Config{SessionTTL: time.Hour}, discard).Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	post := func(email string) (int, string) {
		res, err := http.Post(srv.URL+"/api/v1/public/portal/auth/start", "application/json", strings.NewReader(`{"email":"`+email+`"}`))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	devCode := func(email string) int {
		res, err := http.Get(srv.URL + "/api/v1/auth/email/dev-code?email=" + email)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	for i, tc := range []struct {
		name   string
		seed   int // codes sent to the address two hours ago, by anyone
		starts int
		want   []int
	}{
		{"first start", 0, 1, []int{202}},
		{"repeat within the cooldown", 0, 3, []int{202, 429, 429}},
		{"daily limit per address", 60, 1, []int{429}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			with, without := fmt.Sprintf("ana%d@acme.ch", i), fmt.Sprintf("nobody%d@acme.ch", i)
			e.client(fmt.Sprintf("cli_s%d", i), "wsp_a", "Start AG", with, "")
			for _, email := range []string{with, without} {
				for j := 0; j < tc.seed; j++ {
					e.exec(`INSERT INTO email_codes (id, email, code_hash, client, created_at, expires_at) VALUES ($1,$2,'x','someone',now()-interval '2 hours',now()-interval '110 minutes')`, fmt.Sprintf("emc_%s_%d", email, j), email)
				}
			}
			for j := 0; j < tc.starts; j++ {
				ws, wb := post(with)
				ns, nb := post(without)
				if ws != tc.want[j] || ns != ws || nb != wb {
					t.Fatalf("start %d: with access %d %s, without %d %s; want %d for both", j+1, ws, wb, ns, nb, tc.want[j])
				}
			}
			if tc.want[0] == 202 && (devCode(with) != 200 || devCode(without) != 404) {
				t.Fatalf("code delivered: with access %d, without %d; want 200 and 404", devCode(with), devCode(without))
			}
		})
	}
}

func TestClientLoginRules(t *testing.T) {
	e := newEnv(t)
	// The billing email is the login only while there is no email.
	e.client("cli_p", "wsp_a", "John Smith", "John@Home.ch", "books@home.ch")
	if res, _ := e.do("POST", "/auth/start", map[string]string{"email": "john@home.ch"}, nil, ""); res.StatusCode != 202 || e.auth.sent != 1 {
		t.Fatalf("start: %d sent=%d", res.StatusCode, e.auth.sent)
	}
	if res, _ := e.do("POST", "/auth/verify", map[string]string{"email": "books@home.ch", "code": "123456"}, nil, ""); res.StatusCode != 403 {
		t.Fatalf("billing email next to an email: %d", res.StatusCode)
	}
	c, _ := e.signIn("JOHN@home.ch")
	_, out := e.do("GET", "/session", nil, c, "")
	if out["client"].(map[string]any)["id"] != "cli_p" || out["email"] != "john@home.ch" {
		t.Fatalf("session: %v", out)
	}

	// Changing the client's email ends the session; the new login works, then the billing email once the email is gone.
	e.exec(`UPDATE clients SET email = 'john@new.ch' WHERE id = 'cli_p'`)
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 401 {
		t.Fatalf("after the email changed: %d", res.StatusCode)
	}
	c, _ = e.signIn("john@new.ch")
	e.exec(`UPDATE clients SET email = NULL WHERE id = 'cli_p'`)
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 401 {
		t.Fatalf("after the email was removed: %d", res.StatusCode)
	}
	c, _ = e.signIn("books@home.ch")

	// The switch off: the session ends, no code is delivered and verify is refused.
	e.exec(`UPDATE clients SET portal_enabled = false WHERE id = 'cli_p'`)
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 401 {
		t.Fatalf("after the switch off: %d", res.StatusCode)
	}
	sent := e.auth.sent
	if res, _ := e.do("POST", "/auth/start", map[string]string{"email": "books@home.ch"}, nil, ""); res.StatusCode != 202 || e.auth.sent != sent {
		t.Fatalf("start with the switch off: %d delivered=%d", res.StatusCode, e.auth.sent-sent)
	}
	if res, _ := e.do("POST", "/auth/verify", map[string]string{"email": "books@home.ch", "code": "123456"}, nil, ""); res.StatusCode != 403 {
		t.Fatalf("verify with the switch off: %d", res.StatusCode)
	}
}

func TestClientLoginStaysInItsWorkspace(t *testing.T) {
	e := newEnv(t)
	if err := e.store.CreateWorkspace(context.Background(), store.Workspace{ID: "wsp_b", Name: "Other"}, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	// Same address at a client of another workspace: listed while its portal is on, never otherwise.
	e.client("cli_b", "wsp_b", "Other client", "bob@beta.ch", "")
	e.exec(`UPDATE clients SET portal_enabled = false WHERE id = 'cli_b'`)
	c, csrf := e.signIn("bob@beta.ch")
	_, out := e.do("GET", "/session", nil, c, "")
	if clients := out["clients"].([]any); len(clients) != 1 || clients[0].(map[string]any)["id"] != "cli_3" {
		t.Fatalf("clients: %v", clients)
	}
	if res, _ := e.do("POST", "/session/client", map[string]string{"client_id": "cli_b"}, c, csrf); res.StatusCode != 404 {
		t.Fatalf("switch to a client with the portal off: %d", res.StatusCode)
	}
	e.exec(`UPDATE clients SET portal_enabled = true WHERE id = 'cli_b'`)
	res, sw := e.do("POST", "/session/client", map[string]string{"client_id": "cli_b"}, c, csrf)
	if res.StatusCode != 201 {
		t.Fatalf("switch: %d %v", res.StatusCode, sw)
	}
	_, out = e.do("GET", "/session", nil, sessionCookie_(res), "")
	if out["client"].(map[string]any)["id"] != "cli_b" || out["workspace"].(map[string]any)["name"] != "Other" {
		t.Fatalf("session: %v", out)
	}
}
