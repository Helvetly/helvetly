package store_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

var t0 = time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)

// seedWorkspace: wsp_a with the given members (id -> role); names are "N-<id>".
func seedWorkspace(t *testing.T, roles map[string]string) (*store.Store, func(string) string) {
	t.Helper()
	s, _ := storetest.New(t)
	ctx := context.Background()
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_a", Name: "Acme"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	for id, role := range roles {
		if err := s.CreateUser(ctx, store.User{ID: id, Email: id + "@x.ch", Name: "N-" + id}, t0); err != nil {
			t.Fatal(err)
		}
		if err := s.AddMember(ctx, "wsp_a", id, role, t0); err != nil {
			t.Fatal(err)
		}
	}
	return s, func(id string) string { r, _ := s.MemberRole(ctx, "wsp_a", id); return r }
}

func inv(id, email string) store.Invitation {
	return store.Invitation{ID: id, WorkspaceID: "wsp_a", Email: email, Role: "member", InvitedBy: "usr_o",
		CreatedAt: t0, ExpiresAt: t0.Add(7 * 24 * time.Hour)}
}

func TestClaimInvitationOnce(t *testing.T) {
	s, _ := seedWorkspace(t, map[string]string{"usr_o": "owner", "usr_x": "member"})
	ctx := context.Background()
	if err := s.CreateInvitation(ctx, inv("inv_1", "n@x.ch"), "h1"); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	wins := 0
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := s.ClaimInvitation(ctx, "inv_1", "usr_x", t0)
			if err != nil {
				t.Error(err)
			}
			mu.Lock()
			defer mu.Unlock()
			if ok {
				wins++
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("claims won = %d, want 1", wins)
	}
	got, err := s.Invitation(ctx, "wsp_a", "inv_1")
	if err != nil || got.AcceptedBy != "usr_x" || got.AcceptedAt == nil || got.InvitedBy != "N-usr_o" {
		t.Fatalf("got %+v, %v", got, err)
	}
}

func TestJoinMemberRaisesOnly(t *testing.T) {
	s, role := seedWorkspace(t, map[string]string{"usr_o": "owner", "usr_a": "admin", "usr_m": "member"})
	ctx := context.Background()
	for _, c := range []struct{ user, join, want string }{
		{"usr_a", "member", "admin"},
		{"usr_m", "admin", "admin"},
		{"usr_o", "admin", "owner"},
	} {
		if err := s.JoinMember(ctx, "wsp_a", c.user, c.join, nil, t0); err != nil {
			t.Fatal(err)
		}
		if got := role(c.user); got != c.want {
			t.Errorf("%s joined as %s: role %s, want %s", c.user, c.join, got, c.want)
		}
	}
	if err := s.CreateUser(ctx, store.User{ID: "usr_n", Email: "n@x.ch"}, t0); err != nil {
		t.Fatal(err)
	}
	if err := s.JoinMember(ctx, "wsp_a", "usr_n", "member", []string{"*:*"}, t0); err != nil || role("usr_n") != "member" {
		t.Fatalf("new join: %v %s", err, role("usr_n"))
	}
}

func TestOneOpenInvitationPerEmail(t *testing.T) {
	s, _ := seedWorkspace(t, map[string]string{"usr_o": "owner"})
	ctx := context.Background()
	if err := s.CreateInvitation(ctx, inv("inv_1", "n@x.ch"), "h1"); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateInvitation(ctx, inv("inv_2", "n@x.ch"), "h2"); err == nil {
		t.Fatal("second open invitation allowed")
	}
	if err := s.RevokeOpenInvitations(ctx, "wsp_a", "n@x.ch", t0); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateInvitation(ctx, inv("inv_2", "n@x.ch"), "h2"); err != nil {
		t.Fatal(err)
	}
}

func TestListMembersOrder(t *testing.T) {
	s, _ := seedWorkspace(t, map[string]string{"usr_1": "member", "usr_2": "admin", "usr_3": "owner", "usr_4": "member"})
	got, err := s.ListMembers(context.Background(), "wsp_a")
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, m := range got {
		ids = append(ids, m.UserID)
	}
	want := []string{"usr_3", "usr_2", "usr_1", "usr_4"}
	for i := range want {
		if len(ids) != len(want) || ids[i] != want[i] {
			t.Fatalf("order %v, want %v", ids, want)
		}
	}
}

func TestOpenInvitationsSkipsExpiredAndRevoked(t *testing.T) {
	s, _ := seedWorkspace(t, map[string]string{"usr_o": "owner"})
	ctx := context.Background()
	old := inv("inv_old", "old@x.ch")
	old.ExpiresAt = t0.Add(-time.Hour)
	for i, in := range []store.Invitation{old, inv("inv_rev", "rev@x.ch"), inv("inv_ok", "ok@x.ch")} {
		if err := s.CreateInvitation(ctx, in, "h"+in.ID); err != nil {
			t.Fatal(i, err)
		}
	}
	if ok, err := s.RevokeInvitation(ctx, "wsp_a", "inv_rev", t0); err != nil || !ok {
		t.Fatal(ok, err)
	}
	if ok, _ := s.RevokeInvitation(ctx, "wsp_a", "inv_rev", t0); ok {
		t.Fatal("revoked twice")
	}
	got, err := s.OpenInvitations(ctx, "wsp_a", t0)
	if err != nil || len(got) != 1 || got[0].ID != "inv_ok" {
		t.Fatalf("got %+v, %v", got, err)
	}
	if _, err := s.Invitation(ctx, "wsp_other", "inv_ok"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("other workspace: %v", err)
	}
}

func TestLastActiveFromSessions(t *testing.T) {
	s, _ := seedWorkspace(t, map[string]string{"usr_o": "owner", "usr_m": "member"})
	ctx := context.Background()
	exp := t0.Add(time.Hour)
	for i, at := range []time.Time{t0.Add(time.Minute), t0.Add(5 * time.Minute)} {
		id := string(rune('a' + i))
		if err := s.CreateSession(ctx, id, id, id, "usr_o", "wsp_a", at, exp); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := s.ListMembers(ctx, "wsp_a")
	if got[0].LastActiveAt == nil || !got[0].LastActiveAt.Equal(t0.Add(5*time.Minute)) || got[1].LastActiveAt != nil {
		t.Fatalf("got %+v", got)
	}
}

func TestMembersRemoveAndLookups(t *testing.T) {
	s, role := seedWorkspace(t, map[string]string{"usr_o": "owner", "usr_m": "member"})
	ctx := context.Background()
	if n, _ := s.CountOwners(ctx, "wsp_a"); n != 1 {
		t.Fatalf("owners %d", n)
	}
	if err := s.SetMemberRole(ctx, "wsp_a", "usr_m", "admin", nil); err != nil || role("usr_m") != "admin" {
		t.Fatal(err, role("usr_m"))
	}
	if err := s.CreateSession(ctx, "s1", "h", "c", "usr_m", "wsp_a", t0, t0.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.RemoveMember(ctx, "wsp_a", "usr_m"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MemberRole(ctx, "wsp_a", "usr_m"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("after remove: %v", err)
	}
	if _, err := s.SessionByToken(ctx, "h", t0); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("session survived: %v", err)
	}
	ws, err := s.UserWorkspaces(ctx, "usr_o")
	if err != nil || len(ws) != 1 || ws[0] != (store.WorkspaceRole{ID: "wsp_a", Name: "Acme", Role: "owner"}) {
		t.Fatalf("%+v %v", ws, err)
	}
	if n, err := s.WorkspaceName(ctx, "wsp_a"); err != nil || n != "Acme" {
		t.Fatal(n, err)
	}
	if _, err := s.WorkspaceName(ctx, "nope"); !errors.Is(err, store.ErrNotFound) {
		t.Fatal(err)
	}
}

func TestInvitationLinkQueries(t *testing.T) {
	s, _ := seedWorkspace(t, map[string]string{"usr_o": "owner"})
	ctx := context.Background()
	if err := s.CreateInvitation(ctx, inv("inv_1", "n@x.ch"), "h1"); err != nil {
		t.Fatal(err)
	}
	if err := s.RetokenInvitation(ctx, "wsp_a", "inv_1", "h2", t0.Add(24*time.Hour), t0); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InvitationByToken(ctx, "h1"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("old link: %v", err)
	}
	if got, err := s.InvitationByToken(ctx, "h2"); err != nil || got.ID != "inv_1" {
		t.Fatal(got, err)
	}
	if l, _ := s.OpenInvitationsForEmail(ctx, "n@x.ch", t0); len(l) != 1 {
		t.Fatalf("for email: %v", l)
	}
	if n, _ := s.CountInvitationsSince(ctx, "wsp_a", t0.Add(-time.Hour)); n != 1 {
		t.Fatalf("count %d", n)
	}
	if n, _ := s.CountInvitationsSince(ctx, "wsp_a", t0.Add(time.Hour)); n != 0 {
		t.Fatalf("count %d", n)
	}
}

func TestIsMemberEmail(t *testing.T) {
	s, _ := seedWorkspace(t, map[string]string{"usr_o": "owner"})
	ctx := context.Background()
	if err := s.CreateWorkspace(ctx, store.Workspace{ID: "wsp_b", Name: "Other"}, "UTC", t0); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		workspace, email string
		want             bool
	}{
		{"wsp_a", "usr_o@x.ch", true},
		{"wsp_a", "USR_O@X.CH", true},
		{"wsp_a", "client@x.ch", false},
		{"wsp_b", "usr_o@x.ch", false},
	} {
		got, err := s.IsMemberEmail(ctx, c.workspace, c.email)
		if err != nil || got != c.want {
			t.Errorf("%s %s: %v %v", c.workspace, c.email, got, err)
		}
	}
}
