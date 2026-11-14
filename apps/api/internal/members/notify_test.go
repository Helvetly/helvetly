package members

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func (e *env) bell(b *browser, user string) []string {
	e.t.Helper()
	got, err := e.st.Notifications(context.Background(), b.workspace, user, store.NotificationFilter{Limit: 50})
	if err != nil {
		e.t.Fatal(err)
	}
	var out []string
	for _, n := range got {
		out = append(out, n.Event)
	}
	return out
}

func TestRoleChangeAndRemovalNotify(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	admin, m, quiet := e.join(owner.workspace, "admin"), e.join(owner.workspace, "member"), e.join(owner.workspace, "admin")
	other := e.join(e.workspace().workspace, "admin")
	ownerID, adminID, mID, quietID, otherID := e.id(owner), e.id(admin), e.id(m), e.id(quiet), e.id(other)
	if err := e.st.SetUserNotificationPrefs(context.Background(), quietID,
		store.NotificationPrefs{"member.removed": {}}, time.Now()); err != nil {
		t.Fatal(err)
	}

	e.want(owner, "PATCH", "/api/v1/members/"+mID, map[string]any{"role": "admin"}, 200, "")
	e.want(owner, "PATCH", "/api/v1/members/"+mID, map[string]any{"role": "admin"}, 200, "") // unchanged: no news
	e.want(owner, "DELETE", "/api/v1/members/"+mID, nil, 204, "")
	e.want(admin, "PATCH", "/api/v1/members/"+adminID, map[string]any{"role": "member"}, 200, "") // their own change

	for _, c := range []struct {
		who  *browser
		id   string
		want []string
	}{
		{owner, ownerID, nil}, // did both
		{admin, adminID, []string{"member.removed"}},
		{m, mID, []string{"member.role_changed"}}, // removed afterwards, the row stays theirs
		{quiet, quietID, nil},                     // switched off
		{other, otherID, nil},                     // another workspace
	} {
		if got := e.bell(c.who, c.id); len(got) != len(c.want) || len(got) > 0 && got[0] != c.want[0] {
			t.Fatalf("%s: %v, want %v", c.id, got, c.want)
		}
	}
}
