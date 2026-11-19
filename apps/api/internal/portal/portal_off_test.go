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
		{"unscoped", "", "bob@beta.ch", 404, "portal_link_required"},
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
	res, out := e.doAt("/w/other", "POST", "/auth/verify", map[string]string{"email": "ana@acme.ch", "code": "123456"}, nil, "")
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

// A portal that would not be open anyway (no plan with it, no client with it on) answers a plain 404 while off too:
// "closed" never says that a workspace without a portal exists.
func TestPortalOffSaysClosedOnlyOfAnOpenPortal(t *testing.T) {
	e := scopedEnv(t)
	billingtest.Wire(t, e.store)
	billingtest.On(t, e.store, "wsp_a", billing.Business)
	if err := e.store.SetPortalOff(context.Background(), "wsp_a", true); err != nil {
		t.Fatal(err)
	}
	code := func() any {
		res, out := e.doAt("/w/studio", "GET", "/scope", nil, nil, "")
		if res.StatusCode != 404 {
			t.Fatalf("scope: %d %v", res.StatusCode, out)
		}
		return out["error"].(map[string]any)["code"]
	}
	for _, tc := range []struct {
		name  string
		setup func()
		want  string
	}{
		{"open portal", func() {}, "portal_closed"},
		{"plan without the portal", func() { billingtest.On(t, e.store, "wsp_a", billing.Basic) }, "not_found"},
		{"no client with the portal", func() {
			billingtest.On(t, e.store, "wsp_a", billing.Business)
			e.exec(`UPDATE clients SET portal_enabled = false WHERE workspace_id = 'wsp_a'`)
		}, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.setup()
			if got := code(); got != tc.want {
				t.Fatalf("code %v, want %s", got, tc.want)
			}
		})
	}
}

// A sign-in that passed its access check just before the portal went off may still store its session; turning the
// portal on again must not bring it back.
func TestPortalOnEndsSessionsFromWhileOff(t *testing.T) {
	e := newEnv(t)
	billingtest.Wire(t, e.store)
	billingtest.On(t, e.store, "wsp_a", billing.Business)
	c, _ := e.signIn("bob@beta.ch")
	ctx := context.Background()
	if err := e.store.SetPortalOff(ctx, "wsp_a", true); err != nil {
		t.Fatal(err)
	}
	// The racing sign-in's session, stored after the switch.
	e.exec(`INSERT INTO portal_sessions (id, token_hash, csrf_token, email, client_id, workspace_id, created_at, expires_at, last_active_at, scoped)
		VALUES ('pss_race', 'race', 'csrf', 'bob@beta.ch', 'cli_3', 'wsp_a', now(), now() + interval '1 hour', now(), false)`)
	if err := e.store.SetPortalOff(ctx, "wsp_a", false); err != nil {
		t.Fatal(err)
	}
	if n := e.portalSessions("cli_3"); n != 0 {
		t.Fatalf("sessions after on: %d", n)
	}
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != 401 {
		t.Fatalf("old session after on: %d", res.StatusCode)
	}
}
