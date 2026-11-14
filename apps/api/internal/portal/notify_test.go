package portal

import (
	"context"
	"testing"
)

func (e *env) staff() {
	for _, u := range [][2]string{{"owner", "owner"}, {"admin", "admin"}, {"member", "member"}} {
		e.exec(`INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, now(), now())`, "usr_"+u[0], u[0]+"@studio.ch")
		e.exec(`INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ('wsp_a', $1, $2, now())`, "usr_"+u[0], u[1])
	}
}

// counts: notifications of the event per user.
func (e *env) counts(event string) map[string]int {
	e.t.Helper()
	got := map[string]int{}
	for _, u := range []string{"usr_owner", "usr_admin", "usr_member"} {
		var n int
		if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE event = $1 AND user_id = $2`, event, u).Scan(&n); err != nil {
			e.t.Fatal(err)
		}
		got[u] = n
	}
	return got
}

func TestFirstSignInNotifiesOnce(t *testing.T) {
	e := newEnv(t)
	e.staff()
	e.exec(`UPDATE users SET notification_prefs = '{"portal.first_sign_in": {"email": false, "in_app": false}}' WHERE id = 'usr_admin'`)
	e.signIn("bob@beta.ch")
	e.signIn("bob@beta.ch") // a second sign-in is not the first
	got := e.counts("portal.first_sign_in")
	if got["usr_owner"] != 1 || got["usr_admin"] != 0 || got["usr_member"] != 0 {
		t.Fatalf("first sign-in: %v", got)
	}
}

func TestDocumentViewedTellsTheSharerOnce(t *testing.T) {
	for _, c := range []struct {
		name     string
		sharedBy any
		want     map[string]int
	}{
		{"sharer", "usr_member", map[string]int{"usr_owner": 0, "usr_admin": 0, "usr_member": 1}},
		{"unknown sharer", nil, map[string]int{"usr_owner": 1, "usr_admin": 1, "usr_member": 0}},
	} {
		t.Run(c.name, func(t *testing.T) {
			e := newEnv(t)
			e.staff()
			e.document("doc_1", false)
			e.exec(`INSERT INTO document_shares (document_id, client_id, workspace_id, shared_by, created_at) VALUES ('doc_1','cli_1','wsp_a',$1,now())`, c.sharedBy)
			cookie, _ := e.signIn("ana@acme.ch")
			for range 2 {
				if res, _ := e.get(cookie, "/documents/doc_1/download"); res.StatusCode != 302 {
					t.Fatalf("download: %d", res.StatusCode)
				}
			}
			if got := e.counts("portal.document_viewed"); got["usr_owner"] != c.want["usr_owner"] ||
				got["usr_admin"] != c.want["usr_admin"] || got["usr_member"] != c.want["usr_member"] {
				t.Fatalf("viewed: %v, want %v", got, c.want)
			}
		})
	}
}
