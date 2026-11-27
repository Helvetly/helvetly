package portal

import (
	"strings"

	"helvetly.com/api/internal/store"
	"testing"
	"time"
)

// participants sets up EuroChem (cli_1 made a company) with two participants of its own: Lorenzo (portal on) and
// Liam (portal on), each with a session, plus an invoice to the company, one addressed to Lorenzo and one to Liam,
// and a document shared with the company, one with Lorenzo and one with Liam.
func (e *env) participants() time.Time {
	e.host()
	e.exec(`UPDATE clients SET is_company = true, name = 'EuroChem Group AG' WHERE id = 'cli_1'`)
	e.exec(`INSERT INTO client_contacts (id, client_id, workspace_id, name, email, roles, portal_enabled, created_at, updated_at) VALUES
		('con_lorenzo','cli_1','wsp_a','Lorenzo Percic','lorenzo@eurochem.ch','{participant}',true,now(),now()),
		('con_liam','cli_1','wsp_a','Liam Gallagher','liam@eurochem.ch','{participant}',true,now(),now())`)
	now := time.Now().UTC().Truncate(time.Minute)
	e.session("lorenzo", "cli_1", "scheduled", now.Add(48*time.Hour), "https://meet.example.com/lorenzo")
	e.session("liam", "cli_1", "scheduled", now.Add(50*time.Hour), "")
	e.session("company", "cli_1", "scheduled", now.Add(52*time.Hour), "")
	e.exec(`UPDATE scheduling_events SET participant_contact_id = 'con_lorenzo' WHERE id = 'sev_lorenzo'`)
	e.exec(`UPDATE scheduling_events SET participant_contact_id = 'con_liam' WHERE id = 'sev_liam'`)
	e.invoice("inv_company", "cli_1", "open", "2026-0001", "pdf/company")
	e.invoice("inv_lorenzo", "cli_1", "open", "2026-0002", "pdf/lorenzo")
	e.invoice("inv_liam", "cli_1", "open", "2026-0003", "pdf/liam")
	e.exec(`UPDATE invoices SET participant_contact_id = 'con_lorenzo' WHERE id = 'inv_lorenzo'`)
	e.exec(`UPDATE invoices SET participant_contact_id = 'con_liam' WHERE id = 'inv_liam'`)
	for _, id := range []string{"doc_company", "doc_lorenzo", "doc_liam"} {
		e.document(id, false)
	}
	e.exec(`INSERT INTO document_shares (document_id, client_id, workspace_id, created_at) VALUES ('doc_company','cli_1','wsp_a',now())`)
	e.exec(`INSERT INTO document_participant_shares (document_id, contact_id, client_id, workspace_id, created_at) VALUES
		('doc_lorenzo','con_lorenzo','cli_1','wsp_a',now()), ('doc_liam','con_liam','cli_1','wsp_a',now())`)
	return now
}

func TestParticipantSignsInAndSeesOnlyTheirSessions(t *testing.T) {
	e := newEnv(t)
	e.participants()
	c, _ := e.signIn("LORENZO@eurochem.ch")
	res, out := e.do("GET", "/session", nil, c, "")
	p, _ := out["participant"].(map[string]any)
	if res.StatusCode != 200 || p["id"] != "con_lorenzo" || p["documents"] != false {
		t.Fatalf("session: %d %v", res.StatusCode, out)
	}
	res, body := e.get(c, "/scheduling/occurrences?when=upcoming")
	if res.StatusCode != 200 || !strings.Contains(body, "soc_lorenzo") || strings.Contains(body, "soc_liam") || strings.Contains(body, "soc_company") {
		t.Fatalf("sessions: %d %s", res.StatusCode, body)
	}
	if res, _ := e.get(c, "/scheduling/occurrences/soc_lorenzo/ics"); res.StatusCode != 200 {
		t.Fatalf("own ics: %d", res.StatusCode)
	}
	for _, path := range []string{"/scheduling/occurrences/soc_liam/ics", "/scheduling/occurrences/soc_company/ics", "/scheduling/series/sev_liam/ics"} {
		if res, _ := e.get(c, path); res.StatusCode != 404 {
			t.Fatalf("%s: %d", path, res.StatusCode)
		}
	}
	// Documents: only the one shared with Lorenzo.
	if res, body := e.get(c, "/documents"); res.StatusCode != 200 || !strings.Contains(body, "doc_lorenzo") ||
		strings.Contains(body, "doc_company") || strings.Contains(body, "doc_liam") {
		t.Fatalf("documents: %d %s", res.StatusCode, body)
	}
	for id, want := range map[string]int{"doc_lorenzo": 302, "doc_company": 404, "doc_liam": 404} {
		if res, _ := e.get(c, "/documents/"+id+"/download"); res.StatusCode != want {
			t.Fatalf("%s: %d, want %d", id, res.StatusCode, want)
		}
	}
	// Company mode: no invoices, engagements, profile or signatures at all; booking is not a participant's.
	for _, path := range []string{"/invoices", "/invoices/inv_lorenzo/pdf", "/engagements", "/profile", "/signatures", "/scheduling/booking"} {
		if res, _ := e.get(c, path); res.StatusCode != 404 {
			t.Fatalf("%s: %d", path, res.StatusCode)
		}
	}
}

func TestParticipantWritesOnlyOnTheirOwnSessions(t *testing.T) {
	e := newEnv(t)
	e.participants()
	c, csrf := e.signIn("lorenzo@eurochem.ch")
	if res, out := e.do("POST", "/scheduling/occurrences/soc_liam/cancel-request", map[string]any{}, c, csrf); res.StatusCode != 404 {
		t.Fatalf("other's session: %d %v", res.StatusCode, out)
	}
	if res, out := e.do("POST", "/scheduling/occurrences/soc_company/reschedule-request",
		map[string]any{"proposed_times": []string{time.Now().Add(96 * time.Hour).UTC().Format(time.RFC3339)}}, c, csrf); res.StatusCode != 404 {
		t.Fatalf("company's session: %d %v", res.StatusCode, out)
	}
	if res, out := e.do("POST", "/scheduling/occurrences/soc_lorenzo/cancel-request", map[string]any{}, c, csrf); res.StatusCode != 201 && res.StatusCode != 200 {
		t.Fatalf("own session: %d %v", res.StatusCode, out)
	}
	if res, _ := e.do("POST", "/profile/requests", map[string]any{"name": "Hijack"}, c, csrf); res.StatusCode != 404 {
		t.Fatalf("profile change: %d", res.StatusCode)
	}
	if res, _ := e.do("POST", "/scheduling/booking", map[string]any{}, c, csrf); res.StatusCode != 404 {
		t.Fatalf("booking: %d", res.StatusCode)
	}
}

func TestParticipantsModeShowsOnlyTheirInvoices(t *testing.T) {
	e := newEnv(t)
	e.participants()
	e.exec(`UPDATE clients SET documents_to = 'participants' WHERE id = 'cli_1'`)
	c, _ := e.signIn("lorenzo@eurochem.ch")
	res, body := e.get(c, "/invoices")
	if res.StatusCode != 200 || !strings.Contains(body, "inv_lorenzo") || strings.Contains(body, "inv_company") || strings.Contains(body, "inv_liam") {
		t.Fatalf("invoices: %d %s", res.StatusCode, body)
	}
	e.files.objects["pdf/lorenzo"] = []byte("%PDF")
	for id, want := range map[string]int{"inv_lorenzo": 200, "inv_company": 404, "inv_liam": 404} {
		if res, _ := e.get(c, "/invoices/"+id+"/pdf"); res.StatusCode != want {
			t.Fatalf("%s pdf: %d, want %d", id, res.StatusCode, want)
		}
	}
	// still not the company's engagements or profile
	for _, path := range []string{"/engagements", "/profile"} {
		if res, _ := e.get(c, path); res.StatusCode != 404 {
			t.Fatalf("%s: %d", path, res.StatusCode)
		}
	}
}

func TestCompanyLoginStillSeesEverything(t *testing.T) {
	e := newEnv(t)
	e.participants()
	e.exec(`UPDATE clients SET billing_email = NULL WHERE id = 'cli_2'`) // ana's only login is EuroChem's
	c, _ := e.signIn("ana@acme.ch")
	res, out := e.do("GET", "/session", nil, c, "")
	if res.StatusCode != 200 || out["participant"] != nil {
		t.Fatalf("session: %v", out)
	}
	_, body := e.get(c, "/scheduling/occurrences?when=upcoming")
	for _, id := range []string{"soc_lorenzo", "soc_liam", "soc_company"} {
		if !strings.Contains(body, id) {
			t.Fatalf("company misses %s: %s", id, body)
		}
	}
	_, body = e.get(c, "/invoices")
	for _, id := range []string{"inv_company", "inv_lorenzo", "inv_liam"} {
		if !strings.Contains(body, id) {
			t.Fatalf("company misses %s: %s", id, body)
		}
	}
	if res, body := e.get(c, "/documents"); res.StatusCode != 200 || !strings.Contains(body, "doc_company") {
		t.Fatalf("documents: %s", body)
	}
	for _, path := range []string{"/engagements", "/profile"} {
		if res, _ := e.get(c, path); res.StatusCode != 200 {
			t.Fatalf("%s: %d", path, res.StatusCode)
		}
	}
}

func TestParticipantAccessFollowsEverySwitch(t *testing.T) {
	cases := []struct {
		name, sql string
	}{
		{"own switch off", `UPDATE client_contacts SET portal_enabled = false WHERE id = 'con_lorenzo'`},
		{"role taken", `UPDATE client_contacts SET roles = '{contact}' WHERE id = 'con_lorenzo'`},
		{"client portal off", `UPDATE clients SET portal_enabled = false WHERE id = 'cli_1'`},
		{"workspace portal off", `UPDATE workspaces SET portal_off = true WHERE id = 'wsp_a'`},
		{"email changed", `UPDATE client_contacts SET email = 'lp@private.ch' WHERE id = 'con_lorenzo'`},
		{"no longer a company", `UPDATE clients SET is_company = false WHERE id = 'cli_1'`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			e.participants()
			c, _ := e.signIn("lorenzo@eurochem.ch")
			e.exec(tc.sql)
			if res, _ := e.get(c, "/scheduling/occurrences?when=upcoming"); res.StatusCode != 401 {
				t.Fatalf("after %s: %d", tc.name, res.StatusCode)
			}
			if res, _ := e.do("POST", "/auth/verify", map[string]string{"email": "lorenzo@eurochem.ch", "code": "123456"}, nil, ""); res.StatusCode != 403 {
				t.Fatalf("sign-in after %s: %d", tc.name, res.StatusCode)
			}
		})
	}
}

func TestParticipantSignInSameAnswerAndAudited(t *testing.T) {
	e := newEnv(t)
	e.participants()
	before := e.auth.sent
	for _, email := range []string{"lorenzo@eurochem.ch", "nobody@eurochem.ch"} {
		if res, _ := e.do("POST", "/auth/start", map[string]string{"email": email}, nil, ""); res.StatusCode != 202 {
			t.Fatalf("start %s: %d", email, res.StatusCode)
		}
	}
	if e.auth.sent != before+1 {
		t.Fatalf("codes sent: %d", e.auth.sent-before)
	}
	c, csrf := e.signIn("lorenzo@eurochem.ch")
	if res, _ := e.do("DELETE", "/session", nil, c, csrf); res.StatusCode != 204 {
		t.Fatalf("sign out: %d", res.StatusCode)
	}
	count := func(kind string) int {
		var n int
		if err := e.raw.QueryRow(t.Context(), `SELECT count(*) FROM financial_events WHERE kind = $1 AND subject_id = 'cli_1'
			AND payload->>'participant_id' = 'con_lorenzo'`, kind).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if count("portal.participant_signed_in") != 1 || count("portal.participant_signed_out") != 1 {
		t.Fatalf("audit: in %d out %d", count("portal.participant_signed_in"), count("portal.participant_signed_out"))
	}
}

func TestParticipantOfAnotherWorkspaceIsNotALogin(t *testing.T) {
	e := newEnv(t)
	e.participants()
	if err := e.store.CreateWorkspace(t.Context(), store.Workspace{ID: "wsp_b", Name: "Other"}, "UTC", time.Now()); err != nil {
		t.Fatal(err)
	}
	e.client("cli_b", "wsp_b", "Other AG", "boss@other.ch", "")
	e.exec(`UPDATE clients SET is_company = true WHERE id = 'cli_b'`)
	e.exec(`INSERT INTO client_contacts (id, client_id, workspace_id, name, email, roles, portal_enabled, created_at, updated_at) VALUES
		('con_b','cli_b','wsp_b','Bea','bea@other.ch','{participant}',true,now(),now())`)
	// wsp_a's portal address: Bea is wsp_b's participant, never a login here.
	if res, _ := e.do("POST", "/auth/verify", map[string]string{"email": "bea@other.ch", "code": "123456"}, nil, ""); res.StatusCode != 403 {
		t.Fatalf("other workspace's participant: %d", res.StatusCode)
	}
}

func TestParticipantShareShowsOnTheFile(t *testing.T) {
	e := newEnv(t)
	e.participants()
	d, err := e.store.Q.Document(t.Context(), "wsp_a", "doc_lorenzo")
	if err != nil {
		t.Fatal(err)
	}
	if len(d.SharedWith) != 1 || d.SharedWith[0].ClientName != "Lorenzo Percic · EuroChem Group AG" {
		t.Fatalf("shared with: %+v", d.SharedWith)
	}
}
