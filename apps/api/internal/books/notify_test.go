package books

import (
	"context"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestPeriodChangesNotifyTheOtherManagers(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	admin, member, quiet := e.join(owner.workspace, "admin"), e.join(owner.workspace, "member"), e.join(owner.workspace, "admin")
	other := e.join(e.workspace().workspace, "admin")
	if err := e.st.SetUserNotificationPrefs(context.Background(), quiet.user, store.NotificationPrefs{"period.closed": {}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.do(owner, "POST", "/api/v1/periods", map[string]string{"month": "2025-10"}, 201, nil)
	e.fails(owner, "POST", "/api/v1/periods", map[string]string{"month": "2025-10"}, 409, "conflict") // tells nobody
	e.do(owner, "POST", "/api/v1/periods/2025-10/reopen", nil, 200, nil)

	for _, c := range []struct {
		who  *browser
		want string
	}{
		{owner, ""}, {admin, "period.reopened,period.closed"}, {member, ""}, {quiet, "period.reopened"}, {other, ""},
	} {
		got, err := e.st.Notifications(context.Background(), c.who.workspace, c.who.user, store.NotificationFilter{Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		var events []string
		for _, n := range got {
			events = append(events, n.Event)
			if !strings.Contains(string(n.Data), "October 2025") {
				t.Fatalf("data %s", n.Data)
			}
		}
		if strings.Join(events, ",") != c.want {
			t.Fatalf("%s: %v, want %s", c.who.user, events, c.want)
		}
	}
}
