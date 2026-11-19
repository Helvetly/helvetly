package portal

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestProfileRequestReplacesPending(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	res, out := e.do("POST", "/profile/requests", map[string]any{"phone": "+41 44 000 00 00", "city": "Bern"}, c, csrf)
	if res.StatusCode != 201 || out["id"] == nil {
		t.Fatalf("first: %d %v", res.StatusCode, out)
	}
	res2, out2 := e.do("POST", "/profile/requests", map[string]any{"city": nil}, c, csrf)
	if res2.StatusCode != 201 || out2["id"] != out["id"] {
		t.Fatalf("second: %d %v", res2.StatusCode, out2)
	}
	if f := out2["fields"].(map[string]any); len(f) != 1 || f["city"] != nil {
		t.Fatalf("fields replaced: %v", f)
	}
	_, got := e.do("GET", "/profile", nil, c, "")
	profile := got["profile"].(map[string]any)
	if got["pending"].(map[string]any)["id"] != out["id"] || profile["name"] != "Acme AG" {
		t.Fatalf("profile: %v", got)
	}
	// Shown read-only next to the fields a client may ask to change.
	if _, isBool := profile["is_company"].(bool); profile["email"] != "ana@acme.ch" || !isBool {
		t.Fatalf("read-only fields: %v", profile)
	}
}

func TestProfileRequestContactAndWebsite(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	res, out := e.do("POST", "/profile/requests", map[string]any{"preferred_name": "Anna Muster", "website": "acme.ch"}, c, csrf)
	if res.StatusCode != 201 {
		t.Fatalf("got %d %v", res.StatusCode, out)
	}
	if f := out["fields"].(map[string]any); f["preferred_name"] != "Anna Muster" || f["website"] != "https://acme.ch" {
		t.Fatalf("fields: %v", f)
	}
	if res, out := e.do("POST", "/profile/requests", map[string]any{"email": "eve@evil.test"}, c, csrf); res.StatusCode != 400 {
		t.Fatalf("sign-in email: %d %v", res.StatusCode, out)
	}
}

func TestProfileRequestRejections(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	for name, tc := range map[string]struct {
		body any
		want int
	}{
		"unknown field": {map[string]any{"is_active": false}, 400},
		"empty":         {map[string]any{}, 400},
		"invalid":       {map[string]any{"billing_email": "nope"}, 422},
	} {
		if res, out := e.do("POST", "/profile/requests", tc.body, c, csrf); res.StatusCode != tc.want {
			t.Fatalf("%s: %d %v", name, res.StatusCode, out)
		}
	}
	if res, _ := e.do("POST", "/profile/requests", map[string]any{"city": "Bern"}, c, ""); res.StatusCode != http.StatusForbidden {
		t.Fatalf("csrf: %d", res.StatusCode)
	}
	_, got := e.do("GET", "/profile", nil, c, "")
	if got["pending"] != nil {
		t.Fatalf("nothing pending: %v", got)
	}
}

func TestProfileInvalidVAT422(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	if res, out := e.do("POST", "/profile/requests", map[string]any{"vat_number": "CHE-12"}, c, csrf); res.StatusCode != 422 {
		t.Fatalf("got %d %v", res.StatusCode, out)
	}
}

func TestProfileRequestNotifiesManagers(t *testing.T) {
	e := newEnv(t)
	for _, u := range [][2]string{{"owner", "owner"}, {"admin", "admin"}, {"member", "member"}} {
		e.exec(`INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, now(), now())`, "usr_"+u[0], u[0]+"@studio.ch")
		e.exec(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ('wsp_a', $1, $2, now())`, "usr_"+u[0], u[1])
	}
	c, csrf := e.signIn("ana@acme.ch")
	if res, out := e.do("POST", "/profile/requests", map[string]any{"city": "Bern"}, c, csrf); res.StatusCode != 201 {
		t.Fatalf("got %d %v", res.StatusCode, out)
	}
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE event = 'client.change_requested' AND user_id IN ('usr_owner', 'usr_admin')`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("managers notified: %d %v", n, err)
	}
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE user_id = 'usr_member'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("member notified: %d %v", n, err)
	}
}

func TestProfileShowsLastDecision(t *testing.T) {
	e := newEnv(t)
	c, csrf := e.signIn("ana@acme.ch")
	if _, got := e.do("GET", "/profile", nil, c, ""); got["last_decision"] != nil {
		t.Fatalf("last_decision before any: %v", got["last_decision"])
	}
	e.do("POST", "/profile/requests", map[string]any{"city": "Bern"}, c, csrf)
	if _, err := e.store.DecideChangeRequest(context.Background(), "wsp_a", "cli_1", "rejected", "", nil, "Not your VAT number", time.Now()); err != nil {
		t.Fatal(err)
	}
	_, got := e.do("GET", "/profile", nil, c, "")
	last, ok := got["last_decision"].(map[string]any)
	if !ok || last["status"] != "rejected" || last["reason"] != "Not your VAT number" || got["pending"] != nil {
		t.Fatalf("profile: %v", got)
	}
}
