package portal

import (
	"context"
	"fmt"
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

// ticketOf is the ticket in the fragment of the address issue answered.
func ticketOf(t *testing.T, url string) string {
	t.Helper()
	_, ticket, ok := strings.Cut(url, "#ticket=")
	if !ok || ticket == "" {
		t.Fatalf("no ticket in %q", url)
	}
	return ticket
}

// handoff follows choose's address (under prefix) without its redirect, as a browser would load it: the state cookie
// it set and where it sends the browser.
func (e *env) handoff(prefix string) (*http.Cookie, string) {
	e.t.Helper()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Get(e.srv.URL + prefix + "/api/v1/public/portal/auth/handoff")
	if err != nil {
		e.t.Fatal(err)
	}
	res.Body.Close()
	for _, c := range res.Cookies() {
		if strings.HasPrefix(c.Name, handoffCookie) && c.Value != "" {
			return c, res.Header.Get("Location")
		}
	}
	return nil, res.Header.Get("Location")
}

// ticket goes the whole way for ana@acme.ch's cli_9 (workspace Other): offer, choose, handoff at /w/other, issue.
// It answers the ticket and the handoff's state cookie of the browser that chose.
func (e *env) ticket() (string, *http.Cookie) {
	e.t.Helper()
	c, csrf, _ := e.offer()
	if res, out := e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_9"}, c, csrf); res.StatusCode != 200 {
		e.t.Fatalf("choose: %d %v", res.StatusCode, out)
	}
	binding, location := e.handoff("/w/other")
	_, state, _ := strings.Cut(location, "#state=")
	res, out := e.do("POST", "/auth/handoff", map[string]string{"state": state}, c, "")
	if res.StatusCode != 200 {
		e.t.Fatalf("issue: %d %v", res.StatusCode, out)
	}
	return ticketOf(e.t, out["url"].(string)), binding
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
		landsAt string
	}{
		{"another workspace's client of the address", "cli_9", true, false, 200, "/w/other/api/v1/public/portal/auth/handoff"},
		{"a client of the first workspace", "cli_2", true, false, 200, "/w/studio/api/v1/public/portal/auth/handoff"},
		{"without the CSRF token", "cli_9", false, false, 403, ""},
		{"a client of another address", "cli_3", true, false, 404, ""},
		{"an unknown client", "cli_none", true, false, 404, ""},
		{"an expired choice", "cli_9", true, true, 401, ""},
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
			if tc.landsAt != "" && out["url"] != e.srv.URL+tc.landsAt {
				t.Fatalf("url: %v", out["url"])
			}
			// Choosing gives no ticket and keeps the choice: the person may still choose another client.
			if strings.Contains(fmt.Sprint(out), "ticket") || choiceCookieOf(res) != nil {
				t.Fatalf("choose answered a ticket: %v", out)
			}
			again, _ := e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_1"}, c, csrf)
			if open := again.StatusCode == 200; open == tc.expire {
				t.Fatalf("choosing again: %d", again.StatusCode)
			}
		})
	}
}

func TestHandoff(t *testing.T) {
	e := scopedEnv(t)
	binding, location := e.handoff("/w/other")
	if binding == nil || binding.Name != handoffCookie+"_wsp_b" || !binding.HttpOnly || !binding.Secure || binding.SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie: %+v", binding)
	}
	if location != e.srv.URL+"/login/#state="+binding.Value {
		t.Fatalf("location: %q", location)
	}
	// Each handoff is a new state; the shared portal has none.
	if again, _ := e.handoff("/w/other"); again.Value == binding.Value {
		t.Fatal("the same state twice")
	}
	if c, _ := e.handoff(""); c != nil {
		t.Fatalf("shared portal: %+v", c)
	}
}

func TestIssue(t *testing.T) {
	for _, tc := range []struct {
		name   string
		choose bool
		cookie bool
		state  string
		status int
	}{
		{"a chosen choice", true, true, "s1", 200},
		{"nothing chosen yet", false, true, "s1", 401},
		{"without the choice cookie", true, false, "s1", 401},
		{"without a state", true, true, "", 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := scopedEnv(t)
			c, csrf, _ := e.offer()
			if tc.choose {
				e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_9"}, c, csrf)
			}
			cookie := c
			if !tc.cookie {
				cookie = nil
			}
			res, out := e.do("POST", "/auth/handoff", map[string]string{"state": tc.state}, cookie, "")
			if res.StatusCode != tc.status {
				t.Fatalf("issue: %d %v", res.StatusCode, out)
			}
			if tc.status != 200 {
				return
			}
			if !strings.HasPrefix(out["url"].(string), e.srv.URL+"/w/other/login/#ticket=") {
				t.Fatalf("url: %v", out["url"])
			}
			// Spent: no second ticket, no other client chosen after it, and nothing under a scope.
			if res, _ := e.do("POST", "/auth/handoff", map[string]string{"state": "s2"}, c, ""); res.StatusCode != 401 {
				t.Fatalf("second ticket: %d", res.StatusCode)
			}
			if res, _ := e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_1"}, c, csrf); res.StatusCode != 401 {
				t.Fatalf("choose after: %d", res.StatusCode)
			}
		})
	}
	e := scopedEnv(t)
	c, csrf, _ := e.offer()
	e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_9"}, c, csrf)
	if res, _ := e.doAt("/w/other", "POST", "/auth/handoff", map[string]string{"state": "s1"}, c, ""); res.StatusCode != 401 {
		t.Fatalf("issue under a scope: %d", res.StatusCode)
	}
}

// TestTicketIsBoundToTheBrowser: a ticket is seen and redeemed only alongside the state cookie of the handoff it was
// issued for, so a link of one's own ticket signs nobody else in.
func TestTicketIsBoundToTheBrowser(t *testing.T) {
	for _, tc := range []struct {
		name, prefix string
		binding      string // "own", "other" (another handoff's), "none", "elsewhere" (own value, another scope's name)
		expire       bool
		status       int
	}{
		{"the browser that chose", "/w/other", "own", false, 201},
		{"a browser without the state", "/w/other", "none", false, 401},
		{"a browser with another state", "/w/other", "other", false, 401},
		{"another workspace's scope", "/w/studio", "elsewhere", false, 401},
		{"the shared portal", "", "elsewhere", false, 401},
		{"expired", "/w/other", "own", true, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := scopedEnv(t)
			ticket, own := e.ticket()
			if tc.expire {
				e.exec(`UPDATE portal_sign_in_choices SET expires_at = now() - interval '1 second'`)
			}
			var cookie *http.Cookie
			switch tc.binding {
			case "own":
				cookie = own
			case "other":
				cookie, _ = e.handoff("/w/other")
			case "elsewhere":
				cookie = &http.Cookie{Name: handoffCookie + "_wsp_a", Value: own.Value}
				if tc.prefix == "" {
					cookie.Name = handoffCookie + "_"
				}
			}
			body := map[string]string{"ticket": ticket}
			wantPeek := 401
			if tc.status == 201 {
				wantPeek = 200
			}
			res, peek := e.doAt(tc.prefix, "POST", "/auth/ticket/peek", body, cookie, "")
			if res.StatusCode != wantPeek {
				t.Fatalf("peek: %d %v", res.StatusCode, peek)
			}
			if tc.status == 201 && (peek["email"] != "ana@acme.ch" || peek["client_name"] != "Acme of Other" || peek["workspace_name"] != "Other" || len(peek) != 3) {
				t.Fatalf("peek: %v", peek)
			}
			res, got := e.doAt(tc.prefix, "POST", "/auth/ticket", body, cookie, "")
			if res.StatusCode != tc.status {
				t.Fatalf("redeem: %d %v", res.StatusCode, got)
			}
			if tc.status != 201 {
				if scopedCookie(res) != nil {
					t.Fatal("a session without the browser's state")
				}
				// Refused, not spent: the browser that chose still signs in (unless it expired).
				if res, _ := e.doAt("/w/other", "POST", "/auth/ticket", body, own, ""); (res.StatusCode == 201) == tc.expire {
					t.Fatalf("the browser that chose, after: %d", res.StatusCode)
				}
				return
			}
			s := scopedCookie(res)
			if s == nil || s.Name != sessionCookie+"_wsp_b" {
				t.Fatalf("cookie: %+v", s)
			}
			cleared := false
			for _, c := range res.Cookies() {
				cleared = cleared || c.Name == own.Name && c.MaxAge < 0
			}
			if !cleared {
				t.Fatal("state cookie kept")
			}
			_, sess := e.doAt("/w/other", "GET", "/session", nil, s, "")
			if sess["client"].(map[string]any)["id"] != "cli_9" || len(sess["clients"].([]any)) != 1 {
				t.Fatalf("session: %v", sess)
			}
			// Single use.
			if res, _ := e.doAt("/w/other", "POST", "/auth/ticket/peek", body, own, ""); res.StatusCode != 401 {
				t.Fatalf("peek after: %d", res.StatusCode)
			}
			if res, _ := e.doAt("/w/other", "POST", "/auth/ticket", body, own, ""); res.StatusCode != 401 {
				t.Fatalf("second redeem: %d", res.StatusCode)
			}
		})
	}
}

// TestPeekLeavesTheTicket: looking at a ticket, however often, does not spend it.
func TestPeekLeavesTheTicket(t *testing.T) {
	e := scopedEnv(t)
	ticket, own := e.ticket()
	for range 3 {
		if res, _ := e.doAt("/w/other", "POST", "/auth/ticket/peek", map[string]string{"ticket": ticket}, own, ""); res.StatusCode != 200 {
			t.Fatalf("peek: %d", res.StatusCode)
		}
	}
	if res, _ := e.doAt("/w/other", "POST", "/auth/ticket", map[string]string{"ticket": ticket}, own, ""); res.StatusCode != 201 {
		t.Fatalf("redeem: %d", res.StatusCode)
	}
}

// TestRedeemEndsTheScopesSession: continuing as the ticket's client ends the session the browser had in that scope.
func TestRedeemEndsTheScopesSession(t *testing.T) {
	e := scopedEnv(t)
	e.client("cli_8", "wsp_b", "Bob of Other", "bob@other.ch", "")
	before, _ := e.signInAt("/w/other", "bob@other.ch")
	ticket, own := e.ticket()
	req, _ := http.NewRequest("POST", e.srv.URL+"/w/other/api/v1/public/portal/auth/ticket", strings.NewReader(`{"ticket":"`+ticket+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(own)
	req.AddCookie(before)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("redeem: %d", res.StatusCode)
	}
	if res, _ := e.doAt("/w/other", "GET", "/session", nil, before, ""); res.StatusCode != 401 {
		t.Fatalf("the earlier session: %d", res.StatusCode)
	}
}

// TestTicketRechecksAccess: a client whose portal went off between the choice and the ticket gets no session.
func TestTicketRechecksAccess(t *testing.T) {
	e := scopedEnv(t)
	ticket, own := e.ticket()
	e.exec(`UPDATE clients SET portal_enabled = false WHERE id = 'cli_9'`)
	for _, path := range []string{"/auth/ticket/peek", "/auth/ticket"} {
		res, _ := e.doAt("/w/other", "POST", path, map[string]string{"ticket": ticket}, own, "")
		if res.StatusCode != 403 || scopedCookie(res) != nil {
			t.Fatalf("%s: %d", path, res.StatusCode)
		}
	}
}

// TestChooseLandsOnTheActiveDomain: a workspace with its own active domain hands off and is opened at that domain.
func TestChooseLandsOnTheActiveDomain(t *testing.T) {
	e := scopedEnv(t)
	e.exec(`INSERT INTO workspace_domains (id, workspace_id, hostname, status, next_check_at, created_by, created_at, updated_at, status_since) VALUES
		('dom_b', 'wsp_b', 'portal.other.ch', 'active', now(), 'usr', now(), now(), now())`)
	c, csrf, _ := e.offer()
	_, out := e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_9"}, c, csrf)
	if url, _ := out["url"].(string); url != "http://portal.other.ch/api/v1/public/portal/auth/handoff" {
		t.Fatalf("url: %v", out)
	}
	_, issued := e.do("POST", "/auth/handoff", map[string]string{"state": "s1"}, c, "")
	if url, _ := issued["url"].(string); !strings.HasPrefix(url, "http://portal.other.ch/login/#ticket=") {
		t.Fatalf("url: %v", issued)
	}
}

// TestChoiceRespectsPortalOff: a workspace that turned its whole portal off is not offered, cannot be chosen, and a
// ticket made before it went off opens no session.
func TestChoiceRespectsPortalOff(t *testing.T) {
	off := func(e *env) {
		if err := e.store.SetPortalOff(context.Background(), "wsp_b", true); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("not offered", func(t *testing.T) {
		e := scopedEnv(t)
		off(e)
		_, _, accounts := e.offer()
		for _, a := range accounts {
			if a.(map[string]any)["client_id"] == "cli_9" {
				t.Fatalf("offered while off: %v", accounts)
			}
		}
		if len(accounts) != 2 {
			t.Fatalf("accounts: %v", accounts)
		}
	})
	t.Run("off between the offer and the choice", func(t *testing.T) {
		e := scopedEnv(t)
		c, csrf, _ := e.offer()
		off(e)
		if res, out := e.do("POST", "/auth/choose", map[string]string{"client_id": "cli_9"}, c, csrf); res.StatusCode != 404 {
			t.Fatalf("choose: %d %v", res.StatusCode, out)
		}
	})
	t.Run("off between the ticket and its redemption", func(t *testing.T) {
		e := scopedEnv(t)
		ticket, own := e.ticket()
		off(e)
		for _, path := range []string{"/auth/ticket/peek", "/auth/ticket"} {
			res, _ := e.doAt("/w/other", "POST", path, map[string]string{"ticket": ticket}, own, "")
			if res.StatusCode == 200 || res.StatusCode == 201 || scopedCookie(res) != nil {
				t.Fatalf("%s: %d", path, res.StatusCode)
			}
		}
	})
}
