package portal

import (
	"context"
	"net/http"
	"testing"
	"time"
)

// previewLink stores a member's one-use link to cli_1 of workspace ws, good until expires.
func (e *env) previewLink(token, ws, user string, expires time.Time) {
	e.t.Helper()
	if err := e.store.CreatePortalPreviewLink(context.Background(), hashToken(token), ws, "cli_1", user, time.Now(), expires); err != nil {
		e.t.Fatal(err)
	}
}

// openPreview follows the link at prefix without following its redirect; the preview cookie is nil when none was set.
func (e *env) openPreview(prefix, token string) (*http.Response, *http.Cookie) {
	e.t.Helper()
	req, _ := http.NewRequest("GET", e.srv.URL+prefix+"/api/v1/public/portal/auth/preview?token="+token, nil)
	res, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	res.Body.Close()
	for _, c := range res.Cookies() {
		if c.Name == sessionCookie+"_wsp_a_preview" && c.Value != "" {
			return res, c
		}
	}
	return res, nil
}

// previewing signs the member usr_owner ("Olivia") in as a preview of Acme AG.
func (e *env) previewing() (*http.Cookie, string) {
	e.t.Helper()
	e.staff()
	e.exec(`UPDATE users SET name = 'Olivia' WHERE id = 'usr_owner'`)
	e.previewLink("good", "wsp_a", "usr_owner", time.Now().Add(5*time.Minute))
	res, c := e.openPreview("/w/studio", "good")
	if res.StatusCode != http.StatusFound || res.Header.Get("Location") != "/w/studio/" || c == nil {
		e.t.Fatalf("preview: %d %v", res.StatusCode, res.Header)
	}
	_, out := e.do("GET", "/session", nil, c, "")
	return c, out["csrf_token"].(string)
}

func (e *env) auditKinds(kind string) int {
	e.t.Helper()
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE kind = $1 AND actor_id = 'usr_owner'
		AND subject_type = 'client' AND subject_id = 'cli_1' AND payload->>'client_name' = 'Acme AG'`, kind).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestPreviewLinkOpensOnce(t *testing.T) {
	expired := "/w/studio/login?preview=expired"
	for _, tc := range []struct {
		name, prefix, token string
		setup               func(e *env)
		location            string
	}{
		{"good", "/w/studio", "good", nil, "/w/studio/"},
		{"unknown token", "/w/studio", "nope", nil, expired},
		{"expired", "/w/studio", "old", nil, expired},
		{"another workspace's address", "/w/other", "good", nil, "/w/other/login?preview=expired"},
		{"member gone", "/w/studio", "good", func(e *env) { e.exec(`DELETE FROM workspace_members WHERE user_id = 'usr_owner'`) }, expired},
		{"client's portal off", "/w/studio", "good", func(e *env) { e.exec(`UPDATE clients SET portal_enabled = false WHERE id = 'cli_1'`) }, expired},
		{"workspace's portal off", "/w/studio", "good", func(e *env) { e.exec(`UPDATE workspaces SET portal_off = true WHERE id = 'wsp_a'`) }, expired},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := scopedEnv(t)
			e.staff()
			e.previewLink("good", "wsp_a", "usr_owner", time.Now().Add(5*time.Minute))
			e.previewLink("old", "wsp_a", "usr_owner", time.Now().Add(-time.Second))
			if tc.setup != nil {
				tc.setup(e)
			}
			res, c := e.openPreview(tc.prefix, tc.token)
			if res.StatusCode != http.StatusFound || res.Header.Get("Location") != tc.location || (c != nil) != (tc.location == "/w/studio/") {
				t.Fatalf("%d %q cookie %v", res.StatusCode, res.Header.Get("Location"), c)
			}
			// Whatever came of it, the link is used up.
			if res, c := e.openPreview("/w/studio", tc.token); res.Header.Get("Location") != expired || c != nil {
				t.Fatalf("second use: %q %v", res.Header.Get("Location"), c)
			}
		})
	}
	t.Run("shared portal", func(t *testing.T) {
		e := newEnv(t)
		if res, _ := e.openPreview("", "good"); res.StatusCode != http.StatusNotFound {
			t.Fatalf("unscoped: %d", res.StatusCode)
		}
	})
}

func TestPreviewIsReadOnly(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.previewing()
	var expires time.Time
	if err := e.raw.QueryRow(context.Background(), `SELECT expires_at FROM portal_sessions WHERE preview_by = 'usr_owner'`).Scan(&expires); err != nil ||
		expires.After(time.Now().Add(30*time.Minute)) || expires.Before(time.Now().Add(29*time.Minute)) {
		t.Fatalf("preview lasts until %v (%v)", expires, err)
	}
	res, out := e.do("GET", "/session", nil, c, "")
	if res.StatusCode != 200 || out["client"].(map[string]any)["name"] != "Acme AG" ||
		out["preview"].(map[string]any)["started_by"] != "Olivia" {
		t.Fatalf("session: %d %v", res.StatusCode, out)
	}
	if res, _ := e.get(c, "/invoices"); res.StatusCode != 200 {
		t.Fatalf("read: %d", res.StatusCode)
	}
	for _, tc := range []struct{ method, path string }{
		{"POST", "/quotes/quo_1/accept"},
		{"POST", "/quotes/quo_1/decline"},
		{"POST", "/profile/requests"},
		{"PUT", "/avatar"},
		{"DELETE", "/avatar"},
		{"POST", "/session/client"},
		{"POST", "/scheduling/booking"},
		{"POST", "/scheduling/occurrences/occ_1/cancel-request"},
		{"POST", "/scheduling/requests/req_1/accept"},
		{"DELETE", "/scheduling/requests/req_1"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			res, out := e.do(tc.method, tc.path, map[string]any{"city": "Bern", "client_id": "cli_2"}, c, csrf)
			if res.StatusCode != http.StatusForbidden || out["error"].(map[string]any)["code"] != "preview_read_only" {
				t.Fatalf("%d %v", res.StatusCode, out)
			}
		})
	}
	if e.auditKinds("portal.preview_started") != 1 {
		t.Fatal("start not audited")
	}
	if res, _ := e.do("DELETE", "/session", nil, c, csrf); res.StatusCode != http.StatusNoContent {
		t.Fatalf("end: %d", res.StatusCode)
	}
	if e.auditKinds("portal.preview_ended") != 1 {
		t.Fatal("end not audited")
	}
	if res, _ := e.do("GET", "/session", nil, c, ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("after the end: %d", res.StatusCode)
	}
}

func TestPreviewLeavesNoTrace(t *testing.T) {
	e := newEnv(t)
	e.document("doc_1", false)
	e.exec(`INSERT INTO document_shares (document_id, client_id, workspace_id, created_at) VALUES ('doc_1','cli_1','wsp_a',now())`)
	c, _ := e.previewing()
	e.exec(`UPDATE portal_sessions SET last_active_at = now() - interval '1 hour' WHERE preview_by = 'usr_owner'`)
	if res, _ := e.get(c, "/documents/doc_1/download"); res.StatusCode != 302 {
		t.Fatalf("download: %d", res.StatusCode)
	}
	var signedIn, touched bool
	var notes int
	if err := e.raw.QueryRow(context.Background(), `SELECT (SELECT portal_signed_in_at IS NOT NULL FROM clients WHERE id = 'cli_1'),
		(SELECT last_active_at > now() - interval '1 minute' FROM portal_sessions WHERE preview_by = 'usr_owner'),
		(SELECT count(*) FROM notifications)`).Scan(&signedIn, &touched, &notes); err != nil {
		t.Fatal(err)
	}
	if signedIn || touched || notes != 0 {
		t.Fatalf("signed in %v, touched %v, notifications %d", signedIn, touched, notes)
	}
}

// A preview in a browser where the client is signed in shadows that session while it lasts and never ends it.
func TestPreviewKeepsTheClientsSession(t *testing.T) {
	e := newEnv(t)
	own, _ := e.signIn("ana@acme.ch")
	preview, csrf := e.previewing()
	both := func(method string) (int, map[string]any) {
		req, _ := http.NewRequest(method, e.srv.URL+"/w/studio/api/v1/public/portal/session", nil)
		req.AddCookie(own)
		req.AddCookie(preview)
		req.Header.Set("X-CSRF-Token", csrf)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		for _, c := range res.Cookies() {
			if c.Name == own.Name {
				t.Fatalf("the client's cookie was touched: %v", c)
			}
		}
		_, out := e.do("GET", "/session", nil, own, "")
		return res.StatusCode, out
	}
	if status, _ := both("GET"); status != 200 {
		t.Fatalf("both: %d", status)
	}
	// The preview cookie never stands in for a client's: the client's cookie name with the preview's token is nothing.
	if res, _ := e.do("GET", "/session", nil, &http.Cookie{Name: own.Name, Value: preview.Value}, ""); res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("preview token in the client's cookie: %d", res.StatusCode)
	}
	if status, out := both("DELETE"); status != http.StatusNoContent || out["preview"] != nil || out["email"] != "ana@acme.ch" {
		t.Fatalf("end: %d, own session %v", status, out)
	}
}
