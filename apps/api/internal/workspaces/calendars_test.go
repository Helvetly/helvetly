package workspaces

import (
	"context"
	"net/http"
	"testing"
)

type calendarCalls struct{ asked, revoked []string }

func (c *calendarCalls) Leaving(_ context.Context, workspaceID, userID string) (func(), error) {
	c.asked = append(c.asked, workspaceID+"/"+userID)
	return func() { c.revoked = append(c.revoked, workspaceID) }, nil
}

func TestDeleteRevokesEveryMembersCalendars(t *testing.T) {
	e := newEnv(t)
	cals := &calendarCalls{}
	e.svc.SetCalendars(cals)
	owner, ws := e.person("Acme", "owner")
	e.billing.fail = true
	if code, _ := e.do(owner, http.MethodDelete, "/api/v1/workspace", map[string]string{"confirm": "Acme"}); code != http.StatusBadGateway {
		t.Fatalf("Stripe down: %d", code)
	}
	if len(cals.revoked) != 0 {
		t.Fatal("a failed deletion revoked calendars")
	}
	e.billing.fail = false
	if code, _ := e.do(owner, http.MethodDelete, "/api/v1/workspace", map[string]string{"confirm": "Acme"}); code != http.StatusNoContent {
		t.Fatalf("delete: %d", code)
	}
	if len(cals.asked) != 1 || cals.asked[0] != ws+"/" || len(cals.revoked) != 1 || cals.revoked[0] != ws {
		t.Fatalf("asked %v, revoked %v", cals.asked, cals.revoked)
	}
}
