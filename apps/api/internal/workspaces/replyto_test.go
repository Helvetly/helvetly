package workspaces

import (
	"context"
	"testing"
)

// Only an owner or admin sets the reply-to email; it is validated, lower-cased, cleared by a blank, and each change
// is audited once with the new address.
func TestReplyTo(t *testing.T) {
	e := newEnv(t)
	owner, ws := e.person("Müller AG", "owner")
	admin := e.join(ws, "admin")
	member := e.join(ws, "member")
	address := func(out map[string]any) any { return out["data"].(map[string]any)["reply_to_email"] }
	if status, out := e.do(member, "GET", "/api/v1/workspace/reply-to", nil); status != 200 || address(out) != nil {
		t.Fatalf("none by default: %d %v", status, out)
	}
	for _, tc := range []struct {
		name   string
		who    *browser
		body   any
		status int
		want   any
	}{
		{"member", member, map[string]string{"reply_to_email": "x@muster.ch"}, 403, nil},
		{"invalid", owner, map[string]string{"reply_to_email": "not an address"}, 422, nil},
		{"a name too", owner, map[string]string{"reply_to_email": "Office <office@muster.ch>"}, 422, nil},
		{"owner sets", owner, map[string]string{"reply_to_email": " Office@Muster.ch "}, 200, "office@muster.ch"},
		{"same again", admin, map[string]string{"reply_to_email": "office@muster.ch"}, 200, "office@muster.ch"},
		{"admin clears", admin, map[string]any{"reply_to_email": ""}, 200, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, out := e.do(tc.who, "PUT", "/api/v1/workspace/reply-to", tc.body)
			if status != tc.status || (status == 200 && address(out) != tc.want) {
				t.Fatalf("%d %v", status, out)
			}
		})
	}
	rows, err := e.raw.Query(context.Background(), `SELECT payload->>'to' FROM financial_events
		WHERE workspace_id = $1 AND kind = 'workspace.reply_to_changed' ORDER BY seq`, ws)
	if err != nil {
		t.Fatal(err)
	}
	var tos []string
	for rows.Next() {
		var to string
		_ = rows.Scan(&to)
		tos = append(tos, to)
	}
	if len(tos) != 2 || tos[0] != "office@muster.ch" || tos[1] != "" {
		t.Fatalf("audit: %q", tos)
	}
}
