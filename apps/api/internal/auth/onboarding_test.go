package auth

import (
	"context"
	"testing"
)

// The welcome sets up a new workspace: its owner sees it until it is finished or skipped (the same
// call); people who join a workspace never do. Existing workspaces are set up by migration 00013
// (store.TestWorkspaceOnboarding).
func TestOnboarding(t *testing.T) {
	e := newEnv(t)
	owner := e.emailSignIn("owner@example.com")
	ws := e.session(owner).Workspace.ID
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := e.db.Exec(context.Background(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	// join puts a new person's session into the owner's workspace with `role`, as an invitation would.
	join := func(email, role string) *browser {
		b := e.emailSignIn(email)
		id := e.session(b).User.ID
		exec(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, now())`, ws, id, role)
		exec(`UPDATE sessions SET workspace_id = $1 WHERE user_id = $2`, ws, id)
		return b
	}
	member, admin := join("member@example.com", "member"), join("admin@example.com", "admin")

	for _, tc := range []struct {
		name      string
		client    *browser
		onboarded bool
	}{
		{"a new account's owner sees it", owner, false},
		{"an invited member doesn't", member, true},
		{"an invited admin doesn't", admin, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := e.session(tc.client).Onboarded; got != tc.onboarded {
				t.Fatalf("onboarded %v, want %v", got, tc.onboarded)
			}
		})
	}

	for _, tc := range []struct {
		name   string
		client *browser
		want   int
	}{
		{"signed out", e.newBrowser(), 401},
		{"without the CSRF token", &browser{c: owner.c}, 403},
		{"a member", member, 403},
		{"the owner", owner, 204},
		{"again", owner, 204},
		{"an admin", admin, 204},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e.do(tc.client, "POST", "/api/v1/session/onboarded", nil, tc.want, nil)
		})
	}
	if e.session(owner).Onboarded != true {
		t.Fatal("finished: not shown again")
	}

	// Another workspace the person creates is new: its welcome shows, though the first one's is done.
	exec(`INSERT INTO workspaces (id, name, timezone, created_at) VALUES ('wsp_second', 'Second', 'UTC', now())`)
	id := e.session(owner).User.ID
	exec(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ('wsp_second', $1, 'owner', now())`, id)
	exec(`UPDATE sessions SET workspace_id = 'wsp_second' WHERE user_id = $1`, id)
	if e.session(owner).Onboarded {
		t.Fatal("a second workspace gets its own welcome")
	}
}
