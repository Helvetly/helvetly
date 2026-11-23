package members

import (
	"context"
	"slices"
	"sync"
	"testing"
)

// calendarCalls records what calendar sync was told about members leaving.
type calendarCalls struct {
	mu      sync.Mutex
	asked   []string // workspace/user read before the removal
	revoked []string // workspace/user revoked after it committed
}

func (c *calendarCalls) Leaving(_ context.Context, workspaceID, userID string) (func(), error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.asked = append(c.asked, workspaceID+"/"+userID)
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		c.revoked = append(c.revoked, workspaceID+"/"+userID)
	}, nil
}

func TestLeavingRevokesTheMembersCalendarsOnlyOnceRemoved(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace()
	m := e.join(owner.workspace, "member")
	mID := e.id(m)
	// the last owner cannot leave: read, never revoked
	e.want(owner, "DELETE", "/api/v1/members/"+e.id(owner), nil, 409, "last_owner")
	e.want(owner, "DELETE", "/api/v1/members/"+mID, nil, 204, "")
	e.cals.mu.Lock()
	defer e.cals.mu.Unlock()
	if !slices.Equal(e.cals.revoked, []string{owner.workspace + "/" + mID}) || len(e.cals.asked) != 2 {
		t.Fatalf("asked %v, revoked %v", e.cals.asked, e.cals.revoked)
	}
}
