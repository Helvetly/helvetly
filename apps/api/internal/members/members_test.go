package members

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
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

type env struct {
	t     *testing.T
	st    *store.Store
	srv   *httptest.Server
	seats *seatSyncs
}

// seatSyncs records the workspaces billing was asked to bill for their members.
type seatSyncs struct {
	mu  sync.Mutex
	got []string
}

func (s *seatSyncs) SyncSeats(_ context.Context, workspaceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.got = append(s.got, workspaceID)
}

func newEnv(t *testing.T) *env {
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
	seats := &seatSyncs{}
	svc := New(st, a, discard)
	svc.SetSeats(seats)
	svc.Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, st: st, srv: srv, seats: seats}
}

type browser struct{ token, csrf, workspace string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "UTC", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, "owner")
}

func (e *env) join(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna " + role}
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

// send makes a request; withCSRF false leaves the token header off.
func (e *env) send(b *browser, method, path string, body any, withCSRF bool) (int, []byte) {
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
	if withCSRF {
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

// want sends the request and checks the status and, for errors, the code.
func (e *env) want(b *browser, method, path string, body any, status int, code string) []byte {
	e.t.Helper()
	got, raw := e.send(b, method, path, body, true)
	if got != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, got, status, raw)
	}
	if code != "" && !strings.Contains(string(raw), `"code":"`+code+`"`) {
		e.t.Fatalf("%s %s: want code %q: %s", method, path, code, raw)
	}
	return raw
}

type row struct {
	UserID    string  `json:"user_id"`
	Role      string  `json:"role"`
	AvatarURL *string `json:"avatar_url"`
	IsYou     bool    `json:"is_you"`
}

func (e *env) list(b *browser) []row {
	e.t.Helper()
	var out struct{ Data []row }
	if err := json.Unmarshal(e.want(b, "GET", "/api/v1/members", nil, 200, ""), &out); err != nil {
		e.t.Fatal(err)
	}
	return out.Data
}

func (e *env) id(b *browser) string {
	e.t.Helper()
	for _, m := range e.list(b) {
		if m.IsYou {
			return m.UserID
		}
	}
	e.t.Fatal("no is_you row")
	return ""
}

func TestAdminCannotDemoteOwner(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	admin := e.join(owner.workspace, "admin")
	e.want(admin, "PATCH", "/api/v1/members/"+e.id(owner), map[string]any{"role": "member"}, 403, "forbidden")
}

func TestLastOwnerCannotLeave(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	e.want(owner, "DELETE", "/api/v1/members/"+e.id(owner), nil, 409, "last_owner")
}

func TestLastOwnerCannotDemoteSelf(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	e.want(owner, "PATCH", "/api/v1/members/"+e.id(owner), map[string]any{"role": "admin"}, 409, "last_owner")
}

func TestTwoOwnersOneLeaves(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	e.join(owner.workspace, "owner")
	e.want(owner, "DELETE", "/api/v1/members/"+e.id(owner), nil, 204, "")
}

func TestMemberCannotRemoveOther(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	m := e.join(owner.workspace, "member")
	e.want(m, "DELETE", "/api/v1/members/"+e.id(owner), nil, 403, "forbidden")
}

func TestMemberLeaves(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	m := e.join(owner.workspace, "member")
	e.want(m, "DELETE", "/api/v1/members/"+e.id(m), nil, 204, "")
	e.want(m, "GET", "/api/v1/members", nil, 401, "")
	if n := len(e.list(owner)); n != 1 {
		t.Fatalf("%d members left, want 1", n)
	}
}

func TestOtherWorkspaceMember404(t *testing.T) {
	e := newEnv(t)
	owner, other := e.workspace(), e.workspace()
	e.want(owner, "PATCH", "/api/v1/members/"+e.id(other), map[string]any{"role": "admin"}, 404, "not_found")
	e.want(owner, "DELETE", "/api/v1/members/"+e.id(other), nil, 404, "not_found")
}

func TestPatchUnknownRole(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	m := e.join(owner.workspace, "member")
	e.want(owner, "PATCH", "/api/v1/members/"+e.id(m), map[string]any{"role": "boss"}, 400, "invalid_request")
}

func TestPatchWithoutCSRF(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	m := e.join(owner.workspace, "member")
	status, raw := e.send(owner, "PATCH", "/api/v1/members/"+e.id(m), map[string]any{"role": "admin"}, false)
	if status != 403 || !strings.Contains(string(raw), "csrf_failed") {
		t.Fatalf("got %d %s", status, raw)
	}
}

func TestPatchChangesRole(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	m := e.join(owner.workspace, "member")
	e.want(owner, "PATCH", "/api/v1/members/"+e.id(m), map[string]any{"role": "admin"}, 200, "")
	if got := e.list(m)[1].Role; got != "admin" {
		t.Fatalf("role %q", got)
	}
}

func TestListIsYou(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	m := e.join(owner.workspace, "member")
	for b, role := range map[*browser]string{owner: "owner", m: "member"} {
		you := 0
		for _, r := range e.list(b) {
			if r.IsYou {
				you++
				if r.Role != role || r.AvatarURL != nil {
					t.Fatalf("you: %+v", r)
				}
			}
		}
		if you != 1 {
			t.Fatalf("%d is_you rows", you)
		}
	}
}

func TestListOrder(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	e.join(owner.workspace, "member")
	e.join(owner.workspace, "admin")
	var roles []string
	for _, r := range e.list(owner) {
		roles = append(roles, r.Role)
	}
	if strings.Join(roles, ",") != "owner,admin,member" {
		t.Fatalf("order %v", roles)
	}
}

func TestPatchScopes(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	m, admin := e.join(owner.workspace, "member"), e.join(owner.workspace, "admin")
	path := "/api/v1/members/" + e.id(m)
	raw := e.want(owner, "PATCH", path, map[string]any{"scopes": []string{"read:*", "write:invoices"}}, 200, "")
	if !strings.Contains(string(raw), `"role":"member","scopes":["read:*","write:invoices"]`) {
		t.Fatalf("scopes not set: %s", raw)
	}
	e.want(owner, "PATCH", path, map[string]any{"scopes": []string{"read:people"}}, 422, "validation_failed")
	e.want(owner, "PATCH", path, map[string]any{"scopes": []string{}}, 422, "validation_failed")
	e.want(owner, "PATCH", "/api/v1/members/"+e.id(admin), map[string]any{"scopes": []string{"read:*"}}, 400, "invalid_request")
	e.want(owner, "PATCH", path, map[string]any{"role": "admin", "scopes": []string{"read:*"}}, 400, "invalid_request")
	// Promoted: no scopes; demoted again: full access.
	if raw := e.want(owner, "PATCH", path, map[string]any{"role": "admin"}, 200, ""); !strings.Contains(string(raw), `"scopes":null`) {
		t.Fatalf("admin keeps scopes: %s", raw)
	}
	if raw := e.want(owner, "PATCH", path, map[string]any{"role": "member"}, 200, ""); !strings.Contains(string(raw), `"scopes":["*:*"]`) {
		t.Fatalf("demoted member scopes: %s", raw)
	}
	e.want(m, "PATCH", path, map[string]any{"scopes": []string{"*:*"}}, 403, "forbidden")
}

// A member who leaves or is removed frees a seat; a refused removal changes nothing to bill.
func TestRemoveSyncsSeats(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	m := e.join(owner.workspace, "member")
	other := e.join(owner.workspace, "member")
	e.want(m, "DELETE", "/api/v1/members/"+e.id(other), nil, 403, "forbidden")
	if len(e.seats.got) != 0 {
		t.Fatalf("a refused removal synced seats: %v", e.seats.got)
	}
	e.want(owner, "DELETE", "/api/v1/members/"+e.id(other), nil, 204, "")
	e.want(m, "DELETE", "/api/v1/members/"+e.id(m), nil, 204, "")
	if len(e.seats.got) != 2 || e.seats.got[0] != owner.workspace || e.seats.got[1] != owner.workspace {
		t.Fatalf("seat syncs %v, want two for %s", e.seats.got, owner.workspace)
	}
}
