package portal

import (
	"context"
	"testing"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
)

// Turning the whole portal off ends the open session, refuses every sign-in (also under the workspace's address) and
// makes the scope say the portal is closed; turning it on again restores each client's access as it was.
func TestPortalOffForWholeWorkspace(t *testing.T) {
	e := scopedEnv(t)
	billingtest.Wire(t, e.store)
	billingtest.On(t, e.store, "wsp_a", billing.Business)
	billingtest.On(t, e.store, "wsp_b", billing.Business)
	c, _ := e.signIn("bob@beta.ch")
	ctx := context.Background()
	if err := e.store.SetPortalOff(ctx, "wsp_a", true); err != nil {
		t.Fatal(err)
	}
	if n := e.portalSessions("cli_3"); n != 0 {
		t.Fatalf("session rows left: %d", n)
	}
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 401 {
		t.Fatalf("session after off: %d", res.StatusCode)
	}
	for _, tc := range []struct {
		name, prefix, email string
		status              int
		code                string
	}{
		{"unscoped", "", "bob@beta.ch", 403, "no_portal_access"},
		{"scoped", "/w/studio", "bob@beta.ch", 403, "no_portal_access"},
		{"another workspace still open", "/w/other", "ana@acme.ch", 201, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res, out := e.doAt(tc.prefix, "POST", "/auth/verify", map[string]string{"email": tc.email, "code": "123456"}, nil, "")
			if res.StatusCode != tc.status || (tc.code != "" && out["error"].(map[string]any)["code"] != tc.code) {
				t.Fatalf("%d %v", res.StatusCode, out)
			}
		})
	}
	// Ana is a client of both: off in Studio, she is listed only in Other.
	res, out := e.do("POST", "/auth/verify", map[string]string{"email": "ana@acme.ch", "code": "123456"}, nil, "")
	if res.StatusCode != 201 {
		t.Fatalf("ana: %d %v", res.StatusCode, out)
	}
	if res, out := e.doAt("/w/studio", "GET", "/scope", nil, nil, ""); res.StatusCode != 404 || out["error"].(map[string]any)["code"] != "portal_closed" {
		t.Fatalf("scope while off: %d %v", res.StatusCode, out)
	}
	if res, out := e.doAt("/w/nobody", "GET", "/scope", nil, nil, ""); res.StatusCode != 404 || out["error"] != nil && out["error"].(map[string]any)["code"] == "portal_closed" {
		t.Fatalf("unknown scope must not look closed: %d %v", res.StatusCode, out)
	}
	if err := e.store.SetPortalOff(ctx, "wsp_a", false); err != nil {
		t.Fatal(err)
	}
	e.signIn("bob@beta.ch")
	if res, _ := e.doAt("/w/studio", "GET", "/scope", nil, nil, ""); res.StatusCode != 200 {
		t.Fatalf("scope after on: %d", res.StatusCode)
	}
}
