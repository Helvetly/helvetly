package workspaces

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
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// fakeBilling records which workspaces had their subscription ended; fail makes Stripe refuse.
type fakeBilling struct {
	ended []string
	fail  bool
	auth  *auth.Service
}

func (f *fakeBilling) EndSubscription(_ context.Context, ws string) error {
	if f.fail {
		return auth.Error(http.StatusBadGateway, "payment_provider_error", "Stripe could not complete this: try again.", nil)
	}
	f.ended = append(f.ended, ws)
	return nil
}

func (f *fakeBilling) WriteError(w http.ResponseWriter, r *http.Request, err error) {
	f.auth.WriteError(w, r, err)
}

type env struct {
	t       *testing.T
	st      *store.Store
	raw     *pgxpool.Pool
	srv     *httptest.Server
	billing *fakeBilling
	files   *fakeStorage
	svc     *Service
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	fb := &fakeBilling{auth: a}
	mux := http.NewServeMux()
	a.Register(mux)
	files := &fakeStorage{objects: map[string][]byte{}}
	svc := New(st, a, fb, files, discard)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, raw: raw, srv: srv, billing: fb, files: files, svc: svc}
}

// browser keeps cookies, so a session switch carries on in it.
type browser struct {
	c      *http.Client
	csrf   string
	userID string
}

// person signs a new person into a new workspace named name, with role there.
func (e *env) person(name, role string) (*browser, string) {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: name}, "UTC", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, role), ws
}

// join signs a new person into workspace ws, with role there.
func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna"}
	token, csrf := rand.Text(), rand.Text()
	sum := sha256.Sum256([]byte(token))
	for _, err := range []error{
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	jar, _ := cookiejar.New(nil)
	base, _ := url.Parse(e.srv.URL)
	jar.SetCookies(base, []*http.Cookie{{Name: "helvetly_session", Value: token, Path: "/"}})
	return &browser{c: &http.Client{Jar: jar}, csrf: csrf, userID: u.ID}
}

func (e *env) do(b *browser, method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", b.csrf)
	res, err := b.c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	if token, ok := out["csrf_token"].(string); ok && token != "" {
		b.csrf = token
	}
	return res.StatusCode, out
}

func (e *env) session(b *browser) (int, map[string]any) {
	return e.do(b, http.MethodGet, "/api/v1/session", nil)
}

func TestCreate(t *testing.T) {
	e := newEnv(t)
	b, _ := e.person("Home", "member")
	for _, name := range []string{"", "   ", strings.Repeat("x", 101), "Tab\tname"} {
		if code, _ := e.do(b, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": name}); code != http.StatusBadRequest {
			t.Fatalf("name %q: %d", name, code)
		}
	}
	code, _ := e.do(b, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "  Side project ", "timezone": "Europe/Zurich"})
	if code != http.StatusOK {
		t.Fatalf("create: %d", code)
	}
	// The session moved into the new workspace, where the person is owner and the welcome is due.
	code, s := e.session(b)
	ws, _ := s["workspace"].(map[string]any)
	if code != http.StatusOK || ws["name"] != "Side project" || s["role"] != "owner" || s["onboarded"] != false {
		t.Fatalf("session after create: %d %v", code, s)
	}
	var tz string
	if err := e.raw.QueryRow(context.Background(), `SELECT timezone FROM workspaces WHERE id = $1`, ws["id"]).Scan(&tz); err != nil || tz != "Europe/Zurich" {
		t.Fatalf("timezone %q %v", tz, err)
	}
	if code, _ := e.do(b, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": "Bad zone", "timezone": "Mars/Base"}); code != http.StatusOK {
		t.Fatalf("bad zone: %d", code)
	}
}

func TestRename(t *testing.T) {
	e := newEnv(t)
	owner, _ := e.person("Acme", "owner")
	admin, _ := e.person("Other", "admin")
	if code, body := e.do(owner, http.MethodPatch, "/api/v1/workspace", map[string]string{"name": "Acme AG"}); code != http.StatusOK {
		t.Fatalf("rename: %d %v", code, body)
	}
	if _, s := e.session(owner); s["workspace"].(map[string]any)["name"] != "Acme AG" {
		t.Fatalf("session %v", s)
	}
	if code, _ := e.do(owner, http.MethodPatch, "/api/v1/workspace", map[string]string{"name": ""}); code != http.StatusBadRequest {
		t.Fatalf("empty name: %d", code)
	}
	// The admin's session is in a workspace where they are admin, not owner.
	if code, _ := e.do(admin, http.MethodPatch, "/api/v1/workspace", map[string]string{"name": "Mine"}); code != http.StatusForbidden {
		t.Fatalf("admin rename: %d", code)
	}
}

func TestNameLength(t *testing.T) {
	e := newEnv(t)
	owner, _ := e.person("Acme", "owner")
	for _, tc := range []struct {
		name string
		want int
	}{
		{strings.Repeat("x", maxNameRunes), http.StatusOK},
		{strings.Repeat("x", maxNameRunes+1), http.StatusBadRequest},
		{strings.Repeat("ä", maxNameRunes+1), http.StatusBadRequest},
	} {
		if code, _ := e.do(owner, http.MethodPatch, "/api/v1/workspace", map[string]string{"name": tc.name}); code != tc.want {
			t.Fatalf("rename to %d characters: %d, want %d", len([]rune(tc.name)), code, tc.want)
		}
		if code, _ := e.do(owner, http.MethodPost, "/api/v1/workspaces", map[string]string{"name": tc.name}); code != tc.want {
			t.Fatalf("create with %d characters: %d, want %d", len([]rune(tc.name)), code, tc.want)
		}
	}
	// A longer name stored before the limit stays: saving it again is not refused, changing it to another long one is.
	// (creating moved the first session to a new workspace)
	owner, ws := e.person("Old", "owner")
	long := strings.Repeat("y", 80)
	if _, err := e.raw.Exec(context.Background(), `UPDATE workspaces SET name = $1 WHERE id = $2`, long, ws); err != nil {
		t.Fatal(err)
	}
	if code, _ := e.do(owner, http.MethodPatch, "/api/v1/workspace", map[string]string{"name": long}); code != http.StatusOK {
		t.Fatalf("unchanged long name: %d", code)
	}
	if code, _ := e.do(owner, http.MethodPatch, "/api/v1/workspace", map[string]string{"name": long + "z"}); code != http.StatusBadRequest {
		t.Fatalf("another long name: %d", code)
	}
}

func TestTimezone(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Acme", "owner")
	admin := e.join(ws, "admin")
	member := e.join(ws, "member")
	if code, body := e.do(admin, http.MethodPatch, "/api/v1/workspace", map[string]string{"name": "Acme", "timezone": "America/New_York"}); code != http.StatusOK ||
		body["data"].(map[string]any)["timezone"] != "America/New_York" {
		t.Fatalf("admin sets the zone: %d %v", code, body)
	}
	if _, s := e.session(owner); s["workspace"].(map[string]any)["timezone"] != "America/New_York" {
		t.Fatalf("session %v", s)
	}
	if code, body := e.do(owner, http.MethodPatch, "/api/v1/workspace", map[string]string{"timezone": "Mars/Base"}); code != http.StatusUnprocessableEntity ||
		body["error"].(map[string]any)["details"].(map[string]any)["fields"].(map[string]any)["timezone"] == nil {
		t.Fatalf("invalid zone: %d %v", code, body)
	}
	if code, _ := e.do(member, http.MethodPatch, "/api/v1/workspace", map[string]string{"timezone": "UTC"}); code != http.StatusForbidden {
		t.Fatalf("member: %d", code)
	}
	if code, _ := e.do(admin, http.MethodPatch, "/api/v1/workspace", map[string]string{"name": "Mine", "timezone": "UTC"}); code != http.StatusForbidden {
		t.Fatalf("admin renames: %d", code)
	}
	// Only the zone was sent: the name stays.
	if code, body := e.do(owner, http.MethodPatch, "/api/v1/workspace", map[string]string{"timezone": "Europe/Zurich"}); code != http.StatusOK ||
		body["data"].(map[string]any)["name"] != "Acme" {
		t.Fatalf("zone only: %d %v", code, body)
	}
}

func TestDelete(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Acme", "owner")
	ctx := context.Background()
	// A second workspace to land in, and a teammate whose session ends.
	other := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(ctx, store.Workspace{ID: other, Name: "Beta"}, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := e.st.AddMember(ctx, other, owner.userID, "member", time.Now()); err != nil {
		t.Fatal(err)
	}
	teammate, _ := e.person("Teammate home", "owner")
	if err := e.st.AddMember(ctx, ws, teammate.userID, "admin", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.raw.Exec(ctx, `INSERT INTO workspace_invitations (id, workspace_id, email, role, token_hash, created_at, expires_at)
		VALUES ('inv_1', $1, 'b@example.com', 'member', 'h', now(), now() + interval '1 day')`, ws); err != nil {
		t.Fatal(err)
	}

	if code, _ := e.do(owner, http.MethodDelete, "/api/v1/workspace", map[string]string{"confirm": "acme"}); code != http.StatusBadRequest {
		t.Fatalf("wrong confirm: %d", code)
	}
	e.billing.fail = true
	if code, _ := e.do(owner, http.MethodDelete, "/api/v1/workspace", map[string]string{"confirm": "Acme"}); code != http.StatusBadGateway {
		t.Fatalf("Stripe down: %d", code)
	}
	if code, _ := e.session(owner); code != http.StatusOK {
		t.Fatal("a failed deletion ended the session")
	}
	e.billing.fail = false
	if code, _ := e.do(owner, http.MethodDelete, "/api/v1/workspace", map[string]string{"confirm": "Acme"}); code != http.StatusOK {
		t.Fatalf("delete: %d", code)
	}
	if len(e.billing.ended) != 1 || e.billing.ended[0] != ws {
		t.Fatalf("subscription not ended: %v", e.billing.ended)
	}
	if _, s := e.session(owner); s["workspace"].(map[string]any)["id"] != other {
		t.Fatalf("not moved to the other workspace: %v", s)
	}
	var deleted bool
	var members, open int
	err := e.raw.QueryRow(ctx, `SELECT deleted_at IS NOT NULL,
			(SELECT count(*) FROM workspace_members WHERE workspace_id = $1),
			(SELECT count(*) FROM workspace_invitations WHERE workspace_id = $1 AND revoked_at IS NULL)
		FROM workspaces WHERE id = $1`, ws).Scan(&deleted, &members, &open)
	if err != nil || !deleted || members != 0 || open != 0 {
		t.Fatalf("deleted %v members %d open %d: %v", deleted, members, open, err)
	}

	// The last workspace: the session ends.
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/session/workspace", map[string]string{"workspace_id": other}); code != http.StatusOK {
		t.Fatalf("still in other: %d", code)
	}
	if err := e.st.SetMemberRole(ctx, other, owner.userID, "owner", nil); err != nil {
		t.Fatal(err)
	}
	if code, _ := e.do(owner, http.MethodDelete, "/api/v1/workspace", map[string]string{"confirm": "Beta"}); code != http.StatusNoContent {
		t.Fatalf("delete last: %d", code)
	}
	if code, _ := e.session(owner); code != http.StatusUnauthorized {
		t.Fatalf("session after the last workspace: %d", code)
	}
}

func TestDeleteNeedsTheOwner(t *testing.T) {
	e := newEnv(t)
	for _, role := range []string{"admin", "member"} {
		b, _ := e.person("Acme", role)
		code, body := e.do(b, http.MethodDelete, "/api/v1/workspace", map[string]string{"confirm": "Acme"})
		if errBody, _ := body["error"].(map[string]any); code != http.StatusForbidden || errBody["code"] != "forbidden" {
			t.Fatalf("%s deleted: %d %v", role, code, body)
		}
	}
	if len(e.billing.ended) != 0 {
		t.Fatal("a refused deletion ended a subscription")
	}
}
