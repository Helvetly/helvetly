package auth

import (
	"context"
	"net/url"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

type wsItem struct {
	ID, Name, Role string
	Current        bool
}

func (e *env) workspaces(b *browser) []wsItem {
	e.t.Helper()
	var out struct{ Data []wsItem }
	e.do(b, "GET", "/api/v1/session/workspaces", nil, 200, &out)
	return out.Data
}

// otherWorkspace makes a workspace with the person as a member of the role.
func (e *env) otherWorkspace(name, userID, role string) string {
	e.t.Helper()
	id := NewID("wsp")
	now := time.Now()
	if err := e.svc.db.CreateWorkspace(e.t.Context(), store.Workspace{ID: id, Name: name}, "UTC", now); err != nil {
		e.t.Fatal(err)
	}
	if userID != "" {
		if err := e.svc.db.AddMember(e.t.Context(), id, userID, role, now); err != nil {
			e.t.Fatal(err)
		}
	}
	return id
}

func (e *env) invite(ws, email, role string, created time.Time, ttl time.Duration) {
	e.t.Helper()
	inv := store.Invitation{ID: NewID("inv"), WorkspaceID: ws, Email: email, Role: role, CreatedAt: created, ExpiresAt: created.Add(ttl)}
	if err := e.svc.db.CreateInvitation(e.t.Context(), inv, hashSecret(inv.ID)); err != nil {
		e.t.Fatal(err)
	}
}

func TestSwitchWorkspace(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("sw@example.com")
	s := e.session(b)
	other := e.otherWorkspace("Acme", s.User.ID, "admin")
	oldCookie := e.cookie(b, sessionCookie)

	old := &browser{c: e.newBrowser().c, csrf: b.csrf}
	u, _ := url.Parse(e.srv.URL)
	old.c.Jar.SetCookies(u, b.c.Jar.Cookies(u))

	var out struct {
		CSRF string `json:"csrf_token"`
	}
	e.do(b, "POST", "/api/v1/session/workspace", map[string]any{"workspace_id": other}, 200, &out)
	if out.CSRF == "" || e.cookie(b, sessionCookie) == oldCookie {
		t.Fatal("new session expected")
	}
	b.csrf = out.CSRF
	if got := e.session(b); got.Workspace.ID != other || got.Role != "admin" {
		t.Fatalf("session: %+v", got)
	}
	e.do(old, "GET", "/api/v1/session", nil, 401, nil)
}

func TestSwitchToForeignWorkspace404(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("fw@example.com")
	e.session(b)
	foreign := e.otherWorkspace("Not mine", "", "")
	before := e.cookie(b, sessionCookie)
	e.do(b, "POST", "/api/v1/session/workspace", map[string]any{"workspace_id": foreign}, 404, nil)
	e.do(b, "POST", "/api/v1/session/workspace", map[string]any{"workspace_id": "wsp_nope"}, 404, nil)
	if e.cookie(b, sessionCookie) != before {
		t.Fatal("cookie changed")
	}
	e.session(b)
}

func TestListWorkspacesCurrent(t *testing.T) {
	e := newEnv(t)
	b := e.emailSignIn("lw@example.com")
	s := e.session(b)
	e.otherWorkspace("Aardvark", s.User.ID, "member")
	list := e.workspaces(b)
	if len(list) != 2 || list[0].Name != "Aardvark" || list[0].Role != "member" || list[0].Current ||
		list[1].Name != "My workspace" || list[1].ID != s.Workspace.ID || !list[1].Current || list[1].Role != "owner" {
		t.Fatalf("list: %+v", list)
	}
}

func TestFirstSignInJoinsInvitations(t *testing.T) {
	e := newEnv(t)
	a, b := e.otherWorkspace("A", "", ""), e.otherWorkspace("B", "", "")
	now := time.Now()
	e.invite(a, "new@example.com", "admin", now.Add(-2*time.Hour), 24*time.Hour)
	e.invite(b, "new@example.com", "member", now.Add(-time.Hour), 24*time.Hour)
	var joined []string
	e.svc.OnJoin = func(_ context.Context, _ store.Q, ws string, u store.User, role string, _ time.Time) error {
		joined = append(joined, ws+":"+role+":"+u.Email)
		return nil
	}

	br := e.emailSignIn("new@example.com")
	s := e.session(br)
	if s.Workspace.ID != b || s.Role != "member" {
		t.Fatalf("session: %+v", s)
	}
	list := e.workspaces(br)
	if len(list) != 2 || list[0].Name != "A" || list[0].Role != "admin" || list[1].Name != "B" {
		t.Fatalf("list: %+v", list)
	}
	if n := e.count(`SELECT count(*) FROM workspaces WHERE name = 'My workspace'`); n != 0 {
		t.Fatal("no own workspace expected")
	}
	if n := e.count(`SELECT count(*) FROM workspace_invitations WHERE email = 'new@example.com' AND accepted_at IS NOT NULL AND accepted_by = $1`, s.User.ID); n != 2 {
		t.Fatalf("accepted: %d", n)
	}
	if want := []string{b + ":member:new@example.com", a + ":admin:new@example.com"}; !slices.Equal(joined, want) {
		t.Fatalf("OnJoin %v, want %v", joined, want)
	}
}

func TestFirstSignInExpiredInvitationIgnored(t *testing.T) {
	e := newEnv(t)
	a := e.otherWorkspace("A", "", "")
	e.invite(a, "late@example.com", "member", time.Now().Add(-48*time.Hour), time.Hour)
	s := e.session(e.emailSignIn("late@example.com"))
	if s.Workspace.Name != "My workspace" || s.Role != "owner" {
		t.Fatalf("session: %+v", s)
	}
}

func TestExistingUserSignInUnchanged(t *testing.T) {
	e := newEnv(t)
	first := e.session(e.emailSignIn("old@example.com"))
	a := e.otherWorkspace("A", "", "")
	e.invite(a, "old@example.com", "member", time.Now(), 24*time.Hour)
	e.clock.add(time.Minute)
	again := e.session(e.emailSignIn("old@example.com"))
	if again.Workspace.ID != first.Workspace.ID {
		t.Fatalf("workspace changed: %+v", again)
	}
	if n := e.count(`SELECT count(*) FROM workspace_members WHERE workspace_id = $1`, a); n != 0 {
		t.Fatal("existing user must not auto-join")
	}
}
