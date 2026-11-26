package workspaces

import (
	"context"
	"strings"
	"testing"
)

// Only an owner or admin changes the client emails; the switches start on, a field left out keeps its value, the
// footer is trimmed and limited, and each change is audited once.
func TestClientEmails(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Müller AG", "owner")
	admin := e.join(ws, "admin")
	member := e.join(ws, "member")
	data := func(out map[string]any) map[string]any { return out["data"].(map[string]any) }
	if status, out := e.do(member, "GET", "/api/v1/workspace/client-emails", nil); status != 200 || data(out)["email_footer"] != "" ||
		data(out)["portal_invitations"] != true || data(out)["session_reminders"] != true {
		t.Fatalf("defaults: %d %v", status, out)
	}
	for _, tc := range []struct {
		name   string
		who    *browser
		body   any
		status int
		footer string
		portal bool
	}{
		{"member", member, map[string]any{"portal_invitations": false}, 403, "", true},
		{"five lines", owner, map[string]any{"email_footer": "a\nb\nc\nd\ne"}, 422, "", true},
		{"too long", owner, map[string]any{"email_footer": strings.Repeat("ä", 301)}, 422, "", true},
		{"owner sets the footer", owner, map[string]any{"email_footer": "  IBAN CH00 <b>\r\n\r\n Bürozeiten Mo–Fr  \n"}, 200, "IBAN CH00 <b>\n\nBürozeiten Mo–Fr", true},
		{"admin turns invitations off", admin, map[string]any{"portal_invitations": false}, 200, "IBAN CH00 <b>\n\nBürozeiten Mo–Fr", false},
		{"same again", admin, map[string]any{"portal_invitations": false}, 200, "IBAN CH00 <b>\n\nBürozeiten Mo–Fr", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, out := e.do(tc.who, "PUT", "/api/v1/workspace/client-emails", tc.body)
			if status != tc.status || (status == 200 && (data(out)["email_footer"] != tc.footer || data(out)["portal_invitations"] != tc.portal ||
				data(out)["session_reminders"] != true)) {
				t.Fatalf("%d %v", status, out)
			}
		})
	}
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'workspace.client_emails_changed'`,
		ws).Scan(&n); err != nil || n != 2 {
		t.Fatalf("audited %d times: %v", n, err)
	}
}
