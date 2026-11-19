package portal

import (
	"net/http"
	"strings"
	"testing"
)

func choiceCookieOf(res *http.Response) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == choiceCookie && c.Value != "" {
			return c
		}
	}
	return nil
}

// offer verifies ana@acme.ch (Acme AG and Beta AG at Studio, Acme of Other at Other) on the shared portal.
func (e *env) offer() (*http.Cookie, string, []any) {
	e.t.Helper()
	res, out := e.do("POST", "/auth/verify", map[string]string{"email": "ana@acme.ch", "code": "123456"}, nil, "")
	c := choiceCookieOf(res)
	if res.StatusCode != 200 || c == nil || scopedCookie(res) != nil {
		e.t.Fatalf("verify: %d %v", res.StatusCode, out)
	}
	return c, out["csrf_token"].(string), out["accounts"].([]any)
}

// ticketOf is the ticket in the fragment of the address choose answered.
func ticketOf(t *testing.T, url string) string {
	t.Helper()
	_, ticket, ok := strings.Cut(url, "#ticket=")
	if !ok || ticket == "" {
		t.Fatalf("no ticket in %q", url)
	}
	return ticket
}

func TestChooserOffersEveryClient(t *testing.T) {
	e := scopedEnv(t)
	e.exec(`UPDATE workspaces SET logo_file_id = 'logo1' WHERE id = 'wsp_a'`)
	c, _, accounts := e.offer()
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie: %+v", c)
	}
	want := []struct{ client, name, workspace, logo string }{
		{"cli_1", "Acme AG", "Studio", "/w/studio/api/v1/public/portal/scope/logo?v=logo1"},
		{"cli_9", "Acme of Other", "Other", ""},
		{"cli_2", "Beta AG", "Studio", "/w/studio/api/v1/public/portal/scope/logo?v=logo1"},
	}
	if len(accounts) != len(want) {
		t.Fatalf("accounts: %v", accounts)
	}
	for i, w := range want {
		a := accounts[i].(map[string]any)
		logo, _ := a["logo_url"].(string)
		if a["client_id"] != w.client || a["client_name"] != w.name || a["workspace_name"] != w.workspace || logo != w.logo || len(a) != 4 {
			t.Fatalf("account %d: %v", i, a)
		}
	}
	// A client whose portal is off is not offered; one client left goes straight in.
	e.exec(`UPDATE clients SET portal_enabled = false WHERE id IN ('cli_2', 'cli_9')`)
	res, _ := e.do("POST", "/auth/verify", map[string]string{"email": "ana@acme.ch", "code": "123456"}, nil, "")
	if res.StatusCode != 201 || sessionCookie_(res) == nil || choiceCookieOf(res) != nil {
		t.Fatalf("one client: %d", res.StatusCode)
	}
}

// TestChoiceOpensNothingElse: the choice's cookie is no session, under any name or scope.
func TestChoiceOpensNothingElse(t *testing.T) {
	e := scopedEnv(t)
	c, csrf, _ := e.offer()
	for _, tc := range []struct{ prefix, name, method, path string }{
		{"", choiceCookie, "GET", "/session"},
		{"", sessionCookie, "GET", "/session"},
		{"", sessionCookie, "GET", "/invoices"},
		{"", sessionCookie, "GET", "/profile"},
		{"", sessionCookie, "POST", "/session/client"},
		{"", sessionCookie, "DELETE", "/session"},
		{"/w/studio", sessionCookie + "_wsp_a", "GET", "/session"},
		{"/w/studio", choiceCookie, "GET", "/documents"},
	} {
		cookie := &http.Cookie{Name: tc.name, Value: c.Value}
		if res, _ := e.doAt(tc.prefix, tc.method, tc.path, map[string]string{"client_id": "cli_1"}, cookie, csrf); res.StatusCode != 401 {
			t.Fatalf("%s %s%s as %s: %d", tc.method, tc.prefix, tc.path, tc.name, res.StatusCode)
		}
	}
	// Nor is a choice made under a scope: there the workspace is fixed and the first client opens.
	res, _ := e.doAt("/w/studio", "POST", "/auth/verify", map[string]string{"email": "ana@acme.ch", "code": "123456"}, nil, "")
	if res.StatusCode != 201 || scopedCookie(res) == nil || choiceCookieOf(res) != nil {
		t.Fatalf("scoped verify: %d", res.StatusCode)
	}
	if res, _ := e.doAt("/w/studio", "POST", "/auth/choose", map[string]string{"client_id": "cli_1"}, c, csrf); res.StatusCode != 401 {
		t.Fatalf("choose under a scope: %d", res.StatusCode)
	}
}

func TestChoose(t *testing.T) {
	for _, tc := range []struct {
		name    string
		client  string
		csrf    bool
		expire  bool
		status  int
		spent   bool // the choice is gone afterwards
		landsAt string
	}{
		{"another workspace's client of the address", "cli_9", true, false, 200, true, "/w/other/login/#ticket="},
		{"a client of the first workspace", "cli_2", true, false, 200, true, "/w/studio/login/#ticket="},
		{"without the CSRF token", "cli_9", false, false, 403, false, ""},
		{"a client of another address", "cli_3", true, false, 404, false, ""},
		{"an unknown client", "cli_none", true, false, 404, false, ""},
		{"an expired choice", "cli_9", true, true, 401, true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := scopedEnv(t)
			c, csrf, _ := e.offer()
			if tc.expire {
				e.exec(`UPDATE portal_sign_in_choices SET expires_at = now() - interval '1 second'`)
			}
			send := csrf
			if !tc.csrf {
				send = ""
			}
			res, out := e.do("POST", "/auth/choose", map[string]string{"client_id": tc.client}, c, send)
			if res.StatusCode != tc.status {
				t.Fatalf("choose: %d %v", res.StatusCode, out)
			}
			if tc.landsAt != "" && !strings.HasPrefix(out["url"].(string), e.srv.URL+tc.landsAt) {
				t.Fatalf("url: %v", out["url"])
			}
			again, _ := e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_1"}, c, csrf)
			if spent := again.StatusCode == 401; spent != tc.spent {
				t.Fatalf("choosing again: %d", again.StatusCode)
			}
		})
	}
}

func TestTicket(t *testing.T) {
	for _, tc := range []struct {
		name, prefix string
		expire       bool
		status       int
	}{
		{"its workspace's scope", "/w/other", false, 201},
		{"another workspace's scope", "/w/studio", false, 401},
		{"the shared portal", "", false, 401},
		{"expired", "/w/other", true, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := scopedEnv(t)
			c, csrf, _ := e.offer()
			_, out := e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_9"}, c, csrf)
			ticket := ticketOf(t, out["url"].(string))
			if tc.expire {
				e.exec(`UPDATE portal_sign_in_choices SET expires_at = now() - interval '1 second'`)
			}
			res, got := e.doAt(tc.prefix, "POST", "/auth/ticket", map[string]string{"ticket": ticket}, nil, "")
			if res.StatusCode != tc.status {
				t.Fatalf("redeem: %d %v", res.StatusCode, got)
			}
			if tc.status == 201 {
				s := scopedCookie(res)
				if s == nil || s.Name != sessionCookie+"_wsp_b" {
					t.Fatalf("cookie: %+v", s)
				}
				_, sess := e.doAt("/w/other", "GET", "/session", nil, s, "")
				if sess["client"].(map[string]any)["id"] != "cli_9" || len(sess["clients"].([]any)) != 1 {
					t.Fatalf("session: %v", sess)
				}
				if res, _ := e.doAt("/w/studio", "GET", "/invoices", nil, &http.Cookie{Name: sessionCookie + "_wsp_a", Value: s.Value}, ""); res.StatusCode != 401 {
					t.Fatalf("read another workspace: %d", res.StatusCode)
				}
			}
			// Single use, whatever the first try did.
			if res, _ := e.doAt("/w/other", "POST", "/auth/ticket", map[string]string{"ticket": ticket}, nil, ""); res.StatusCode != 401 {
				t.Fatalf("second redeem: %d", res.StatusCode)
			}
		})
	}
}

// TestTicketRechecksAccess: a client whose portal went off between the choice and the ticket gets no session.
func TestTicketRechecksAccess(t *testing.T) {
	e := scopedEnv(t)
	c, csrf, _ := e.offer()
	_, out := e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_9"}, c, csrf)
	e.exec(`UPDATE clients SET portal_enabled = false WHERE id = 'cli_9'`)
	res, _ := e.doAt("/w/other", "POST", "/auth/ticket", map[string]string{"ticket": ticketOf(t, out["url"].(string))}, nil, "")
	if res.StatusCode != 403 || scopedCookie(res) != nil {
		t.Fatalf("redeem: %d", res.StatusCode)
	}
}

// TestChooseLandsOnTheActiveDomain: a workspace with its own active domain is opened at that domain's root.
func TestChooseLandsOnTheActiveDomain(t *testing.T) {
	e := scopedEnv(t)
	e.exec(`INSERT INTO workspace_domains (id, workspace_id, hostname, status, next_check_at, created_by, created_at, updated_at, status_since) VALUES
		('dom_b', 'wsp_b', 'portal.other.ch', 'active', now(), 'usr', now(), now(), now())`)
	c, csrf, _ := e.offer()
	_, out := e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_9"}, c, csrf)
	if url, _ := out["url"].(string); !strings.HasPrefix(url, "http://portal.other.ch/login/#ticket=") {
		t.Fatalf("url: %v", out)
	}
}
