package portal

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

func (e *env) portalSessions(clientID string) int {
	e.t.Helper()
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM portal_sessions WHERE client_id = $1`, clientID).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

// A downgrade to a plan without the portal ends the open session on its next request and removes its row.
func TestPortalDowngradeEndsSession(t *testing.T) {
	e := newEnv(t)
	billingtest.Wire(t, e.store)
	billingtest.On(t, e.store, "wsp_a", billing.Business)
	c, _ := e.signIn("bob@beta.ch")
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 200 {
		t.Fatalf("on Business: %d", res.StatusCode)
	}
	billingtest.On(t, e.store, "wsp_a", billing.Basic)
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 401 {
		t.Fatalf("after the downgrade: %d", res.StatusCode)
	}
	if n := e.portalSessions("cli_3"); n != 0 {
		t.Fatalf("session rows left: %d", n)
	}
}

// An address whose only access is in a workspace without the portal gets no code and no session, as with no access.
func TestPortalNoAccessWithoutPlanFeature(t *testing.T) {
	for _, plan := range []string{billing.Basic, billing.Pro} {
		t.Run(plan, func(t *testing.T) {
			e := newEnv(t)
			billingtest.Wire(t, e.store)
			billingtest.On(t, e.store, "wsp_a", plan)
			if res, _ := e.do("POST", "/auth/start", map[string]string{"email": "bob@beta.ch"}, nil, ""); res.StatusCode != 202 || e.auth.sent != 0 {
				t.Fatalf("start: %d delivered=%d", res.StatusCode, e.auth.sent)
			}
			res, out := e.do("POST", "/auth/verify", map[string]string{"email": "bob@beta.ch", "code": "123456"}, nil, "")
			if res.StatusCode != 403 || out["error"].(map[string]any)["code"] != "no_portal_access" || sessionCookie_(res) != nil {
				t.Fatalf("verify: %d %v", res.StatusCode, out)
			}
			if n := e.portalSessions("cli_3"); n != 0 {
				t.Fatalf("session rows: %d", n)
			}
		})
	}
}

// With access in a Business and a Basic workspace, only the Business client is listed and switching to the other fails.
func TestPortalListsOnlyWorkspacesWithPortal(t *testing.T) {
	e := newEnv(t)
	billingtest.Wire(t, e.store)
	if err := e.store.CreateWorkspace(context.Background(), store.Workspace{ID: "wsp_b", Name: "Other"}, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	e.client("cli_b", "wsp_b", "Other client", "bob@beta.ch", "")
	billingtest.On(t, e.store, "wsp_a", billing.Business)
	billingtest.On(t, e.store, "wsp_b", billing.Basic)
	c, csrf := e.signIn("bob@beta.ch")
	_, out := e.do("GET", "/session", nil, c, "")
	if clients := out["clients"].([]any); len(clients) != 1 || clients[0].(map[string]any)["id"] != "cli_3" {
		t.Fatalf("clients: %v", out["clients"])
	}
	if res, _ := e.do("POST", "/session/client", map[string]string{"client_id": "cli_b"}, c, csrf); res.StatusCode != 404 {
		t.Fatalf("switch to the Basic workspace's client: %d", res.StatusCode)
	}
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 200 {
		t.Fatalf("session must survive a refused switch: %d", res.StatusCode)
	}
}
