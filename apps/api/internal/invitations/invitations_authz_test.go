package invitations

import (
	"context"
	"sync"
	"testing"
	"time"
)

// TestConcurrentAcceptsJoinOnce: the invited person accepting the same link from two tabs at once, while signing in
// elsewhere, joins once: one membership with the invited role, and the invitation is used once.
func TestConcurrentAcceptsJoinOnce(t *testing.T) {
	e := newEnv(t, true)
	owner := e.join(e.newWorkspace(), "owner", "")
	tabs := []*browser{e.outsider("tabs@example.com")}
	inv := e.invite(owner, "tabs@example.com", "admin")
	var wg sync.WaitGroup
	start := make(chan struct{})
	codes := make(chan int, 4)
	for range 4 {
		wg.Go(func() {
			<-start
			code, _, _ := e.do(tabs[0], "POST", "/api/v1/invitations/accept", map[string]any{"token": tokenOf(t, inv.URL)})
			codes <- code
		})
	}
	close(start)
	wg.Wait()
	close(codes)
	ok := 0
	for c := range codes {
		if c == 200 {
			ok++
		}
	}
	if ok == 0 {
		t.Fatal("no accept succeeded")
	}
	ctx := context.Background()
	list, err := e.st.ListMembers(ctx, owner.workspace)
	if err != nil {
		t.Fatal(err)
	}
	admins := 0
	for _, m := range list {
		if m.Role == "admin" {
			admins++
		}
	}
	open, err := e.st.OpenInvitations(ctx, owner.workspace, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if admins != 1 || len(list) != 2 || len(open) != 0 {
		t.Fatalf("members %d (admins %d), open invitations %d", len(list), admins, len(open))
	}
}
