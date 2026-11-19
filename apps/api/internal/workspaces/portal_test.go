package workspaces

import (
	"context"
	"net/url"
	"testing"
)

func TestPortalAddress(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Müller AG", "owner")
	other, _ := e.person("Beta GmbH", "owner")
	if status, out := e.do(owner, "GET", "/api/v1/workspace/portal", nil); status != 200 ||
		out["data"].(map[string]any)["slug"] != "mueller-ag" || out["data"].(map[string]any)["url"] != "https://portal.example.com/w/mueller-ag/" {
		t.Fatalf("get: %d %v", status, out)
	}
	if status, _ := e.do(other, "PUT", "/api/v1/workspace/portal", map[string]string{"slug": "beta-old"}); status != 200 {
		t.Fatal("beta's first change")
	}
	if status, _ := e.do(other, "PUT", "/api/v1/workspace/portal", map[string]string{"slug": "beta"}); status != 200 {
		t.Fatal("beta's second change")
	}
	admin := e.join(ws, "admin")
	member := e.join(ws, "member")
	for _, tc := range []struct {
		name    string
		who     *browser
		slug    string
		status  int
		problem string
	}{
		{"member", member, "acme", 403, ""},
		{"invalid", owner, " Acme Corp", 422, "invalid"}, // lower-cased and trimmed, the inner space still makes it invalid
		{"too short", owner, "ab", 422, "invalid"},
		{"reserved", owner, "login", 422, "reserved"},
		{"another workspace's", owner, "beta", 409, "taken"},
		{"another workspace's earlier one", owner, "beta-old", 409, "taken"},
		{"free", admin, "mueller", 200, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, avail := e.do(owner, "GET", "/api/v1/workspace/portal/availability?slug="+url.QueryEscape(tc.slug), nil)
			if tc.problem != "" && avail["data"].(map[string]any)["problem"] != tc.problem {
				t.Fatalf("availability: %v", avail)
			}
			status, out := e.do(tc.who, "PUT", "/api/v1/workspace/portal", map[string]string{"slug": tc.slug})
			if status != tc.status {
				t.Fatalf("%d %v", status, out)
			}
		})
	}
	ctx := context.Background()
	// The earlier slug leads to the current one; the change is in the audit log.
	if s, err := e.st.PortalScopeBySlug(ctx, "mueller-ag"); err != nil || s.Slug != "mueller" || s.WorkspaceID != ws {
		t.Fatalf("old slug: %+v %v", s, err)
	}
	var kind, payload string
	if err := e.raw.QueryRow(ctx, `SELECT kind, payload::text FROM financial_events WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 1`, ws).
		Scan(&kind, &payload); err != nil || kind != "workspace.portal_address_changed" || payload != `{"to": "mueller", "from": "mueller-ag"}` {
		t.Fatalf("audit: %q %q %v", kind, payload, err)
	}
	// A workspace takes back its own earlier slug.
	if status, out := e.do(owner, "PUT", "/api/v1/workspace/portal", map[string]string{"slug": "mueller-ag"}); status != 200 {
		t.Fatalf("own earlier slug: %d %v", status, out)
	}
	if s, err := e.st.PortalScopeBySlug(ctx, "mueller"); err != nil || s.Slug != "mueller-ag" {
		t.Fatalf("after taking it back: %+v %v", s, err)
	}
}

// Only an owner or admin turns the whole portal off or on; each change is audited once, and the answer says the state.
func TestPortalAccess(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Müller AG", "owner")
	admin := e.join(ws, "admin")
	member := e.join(ws, "member")
	enabled := func(out map[string]any) any { return out["data"].(map[string]any)["enabled"] }
	if _, out := e.do(owner, "GET", "/api/v1/workspace/portal", nil); enabled(out) != true {
		t.Fatalf("on by default: %v", out)
	}
	for _, tc := range []struct {
		name    string
		who     *browser
		body    any
		status  int
		enabled any
	}{
		{"member", member, map[string]bool{"enabled": false}, 403, nil},
		{"missing", owner, map[string]string{}, 422, nil},
		{"owner off", owner, map[string]bool{"enabled": false}, 200, false},
		{"off again", admin, map[string]bool{"enabled": false}, 200, false},
		{"admin on", admin, map[string]bool{"enabled": true}, 200, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, out := e.do(tc.who, "PUT", "/api/v1/workspace/portal/access", tc.body)
			if status != tc.status || (tc.enabled != nil && enabled(out) != tc.enabled) {
				t.Fatalf("%d %v", status, out)
			}
		})
	}
	rows, err := e.raw.Query(context.Background(), `SELECT kind FROM financial_events WHERE workspace_id = $1 AND kind LIKE 'workspace.portal_turned_%' ORDER BY seq`, ws)
	if err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		kinds = append(kinds, k)
	}
	if len(kinds) != 2 || kinds[0] != "workspace.portal_turned_off" || kinds[1] != "workspace.portal_turned_on" {
		t.Fatalf("audit: %v", kinds)
	}
}
