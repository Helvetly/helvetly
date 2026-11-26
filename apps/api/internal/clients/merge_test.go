package clients

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// lorenzoCase is the production shape: the company EuroChem Group AG with Oliver, Lorenzo and Liam, and a separate
// person client "Lorenzo Percic" (private email and address) that an import made, holding the paid imported invoice
// 2026/IN/003 (its buyer snapshot is Lorenzo at home), a session, a linked file in its client folder and a share.
type lorenzoCase struct {
	company, person, lorenzo string
}

func (e *env) lorenzoCase(b *browser) lorenzoCase {
	e.t.Helper()
	ctx := context.Background()
	company := e.create(b, map[string]any{"name": "EuroChem Group AG", "is_company": true, "email": "office@eurochem.ch"})
	var lorenzo struct{ Data store.Contact }
	for _, p := range []map[string]any{{"name": "Oliver Harvey", "email": "oliver@eurochem.ch"},
		{"name": "Lorenzo Percic", "email": "l.percic@eurochem.ch"}, {"name": "Liam Gallagher", "email": "liam@eurochem.ch"}} {
		var out struct{ Data store.Contact }
		e.do(b, "POST", "/api/v1/clients/"+company.ID+"/contacts", p, 201, &out)
		if p["name"] == "Lorenzo Percic" {
			lorenzo = out
		}
	}
	person := e.create(b, map[string]any{"name": "Lorenzo Percic", "email": "lorenzo.private@gmail.com", "street": "Seestrasse",
		"street_number": "5", "zip": "8002", "city": "Zürich", "country": "CH", "portal_enabled": false})
	buyer, _ := json.Marshal(store.Party{Name: "Lorenzo Percic", Street: "Seestrasse", StreetNumber: "5", Zip: "8002", City: "Zürich", Country: "CH"})
	exec := func(sql string, args ...any) {
		e.t.Helper()
		if _, err := e.raw.Exec(ctx, sql, args...); err != nil {
			e.t.Fatal(err)
		}
	}
	exec(`INSERT INTO closed_periods (workspace_id, month, closed_at) VALUES ($1, '2026-03', now())`, b.workspace)
	if err := e.st.Q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: b.workspace, Kind: "invoice.imported", SubjectType: "invoice",
		SubjectID: "inv_003", At: time.Now(), Payload: json.RawMessage(`{"client_id":"` + person.ID + `"}`)}); err != nil {
		e.t.Fatal(err)
	}
	exec(`INSERT INTO scheduling_events (id, workspace_id, client_id, title, mode, time_zone, starts_local, duration_minutes, created_at, updated_at)
		VALUES ('sev_l',$1,$2,'German lesson','live','UTC','2026-12-01T09:00',60,now(),now())`, b.workspace, person.ID)
	exec(`INSERT INTO scheduling_occurrences (id, workspace_id, event_id, client_id, original_start, starts_at, ends_at, status, timed_at, created_at, updated_at)
		VALUES ('soc_l',$1,'sev_l',$2,'2026-12-01T09:00Z','2026-12-01T09:00Z','2026-12-01T10:00Z','scheduled',now(),now(),now())`, b.workspace, person.ID)
	folder, err := e.st.Q.ClientRecordFolder(ctx, b.workspace, person.ID, "invoices", 2026, "", time.Now())
	if err != nil {
		e.t.Fatal(err)
	}
	exec(`INSERT INTO documents (id, workspace_id, folder_id, name, size, content_type, object_key, created_at, updated_at)
		VALUES ('doc_003',$1,$2,'2026-IN-003.pdf',10,'application/pdf','pdf/003',now(),now())`, b.workspace, folder)
	exec(`INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date, currency, language, vat_mode,
		discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount, amount_paid, vat_breakdown, pdf_key,
		buyer, origin, source_document_id, issued_at, created_at, updated_at)
		VALUES ('inv_003',$1,'invoice','paid','2026/IN/003',$2,'2026-03-02','2026-04-01','CHF','en','none',0,48000,0,48000,0,48000,0,48000,
		'[]','pdf/003',$3,'imported','doc_003',now(),now(),now())`, b.workspace, person.ID, buyer)
	exec(`INSERT INTO document_links (document_id, target_type, target_id, workspace_id, created_at) VALUES ('doc_003','client',$2,$1,now())`,
		b.workspace, person.ID)
	exec(`INSERT INTO document_shares (document_id, client_id, workspace_id, created_at) VALUES ('doc_003',$2,$1,now())`, b.workspace, person.ID)
	return lorenzoCase{company: company.ID, person: person.ID, lorenzo: lorenzo.Data.ID}
}

type mergeOut struct{ Data mergeResult }

func TestMakeParticipantMovesEverythingOnce(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.lorenzoCase(b)
	ctx := context.Background()
	path := "/api/v1/clients/" + c.person + "/make-participant"
	hashes := func() []string {
		rows, err := e.raw.Query(ctx, `SELECT encode(hash, 'hex') FROM financial_events WHERE workspace_id = $1 ORDER BY seq`, b.workspace)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var h string
			if err := rows.Scan(&h); err != nil {
				t.Fatal(err)
			}
			out = append(out, h)
		}
		return out
	}
	before := hashes()

	// Dry run: what moves, whom it matched (by name: the private email differs), and nothing written.
	var dry mergeOut
	e.do(b, "POST", path, map[string]any{"company_id": c.company, "dry_run": true}, 200, &dry)
	if dry.Data.Match != "name" || dry.Data.ParticipantID != c.lorenzo || dry.Data.Counts.Invoices != 1 || dry.Data.Counts.Sessions != 1 ||
		dry.Data.Counts.Documents != 1 || dry.Data.Counts.Shares != 1 || !dry.Data.SuggestParticipants {
		t.Fatalf("dry run: %+v", dry.Data)
	}
	if got := hashes(); len(got) != len(before) {
		t.Fatalf("dry run logged: %d events", len(got)-len(before))
	}

	var done mergeOut
	e.do(b, "POST", path, map[string]any{"company_id": c.company}, 200, &done)
	if done.Data.ParticipantID != c.lorenzo || done.Data.CompanyID != c.company {
		t.Fatalf("merge: %+v", done.Data)
	}
	// The invoice moved, with its number, buyer snapshot, PDF, amounts and status as they were.
	var client, participant, number, pdf, status, buyerName, buyerStreet string
	var total int64
	if err := e.raw.QueryRow(ctx, `SELECT client_id, participant_contact_id, number, pdf_key, status, buyer->>'name', buyer->>'street', total
		FROM invoices WHERE id = 'inv_003'`).Scan(&client, &participant, &number, &pdf, &status, &buyerName, &buyerStreet, &total); err != nil {
		t.Fatal(err)
	}
	if client != c.company || participant != c.lorenzo || number != "2026/IN/003" || pdf != "pdf/003" || status != "paid" ||
		buyerName != "Lorenzo Percic" || buyerStreet != "Seestrasse" || total != 48000 {
		t.Fatalf("invoice: %s %s %s %s %s %s %s %d", client, participant, number, pdf, status, buyerName, buyerStreet, total)
	}
	// The session, the file (now in the company's folder), its link and the share followed.
	var sessionClient, eventParticipant, linkTarget, folderRef string
	var shares int
	if err := e.raw.QueryRow(ctx, `SELECT o.client_id, e.participant_contact_id FROM scheduling_occurrences o JOIN scheduling_events e ON e.id = o.event_id
		WHERE o.id = 'soc_l'`).Scan(&sessionClient, &eventParticipant); err != nil {
		t.Fatal(err)
	}
	if err := e.raw.QueryRow(ctx, `SELECT target_id FROM document_links WHERE document_id = 'doc_003'`).Scan(&linkTarget); err != nil {
		t.Fatal(err)
	}
	if err := e.raw.QueryRow(ctx, `WITH RECURSIVE up AS (SELECT f.id, f.parent_id, f.system_kind, f.system_ref FROM documents d
			JOIN document_folders f ON f.id = d.folder_id WHERE d.id = 'doc_003'
		UNION ALL SELECT p.id, p.parent_id, p.system_kind, p.system_ref FROM document_folders p JOIN up ON p.id = up.parent_id)
		SELECT system_ref FROM up WHERE system_kind = 'client'`).Scan(&folderRef); err != nil {
		t.Fatal(err)
	}
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM document_participant_shares WHERE document_id = 'doc_003' AND contact_id = $1`,
		c.lorenzo).Scan(&shares); err != nil {
		t.Fatal(err)
	}
	if sessionClient != c.company || eventParticipant != c.lorenzo || linkTarget != c.company || folderRef != c.company || shares != 1 {
		t.Fatalf("moved: %s %s %s %s %d", sessionClient, eventParticipant, linkTarget, folderRef, shares)
	}
	// Lorenzo keeps his company email, gains the participant role and his private address.
	var company struct{ Data store.Client }
	e.do(b, "GET", "/api/v1/clients/"+c.company, nil, 200, &company)
	p := company.Data.Participant(&c.lorenzo)
	if p == nil || *p.Email != "l.percic@eurochem.ch" || !p.Is(store.RoleContact) || p.Street == nil || *p.Street != "Seestrasse" {
		t.Fatalf("participant: %+v", p)
	}
	// The person client is gone; earlier financial events are untouched and one new event says what happened.
	e.fails(b, "GET", "/api/v1/clients/"+c.person, nil, 404, "not_found")
	after := hashes()
	if len(after) != len(before)+1 || after[len(before)-1] != before[len(before)-1] {
		t.Fatalf("financial events: %d → %d", len(before), len(after))
	}
	var kind string
	if err := e.raw.QueryRow(ctx, `SELECT kind FROM financial_events WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 1`, b.workspace).Scan(&kind); err != nil {
		t.Fatal(err)
	}
	if kind != "client.merged_into_participant" {
		t.Fatalf("last event: %s", kind)
	}
	// A repeat answers done, moving and logging nothing.
	var again mergeOut
	e.do(b, "POST", path, map[string]any{"company_id": c.company}, 200, &again)
	if !again.Data.Done || again.Data.ParticipantID != c.lorenzo || len(hashes()) != len(after) {
		t.Fatalf("repeat: %+v", again.Data)
	}
}

func TestMakeParticipantRefuses(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.lorenzoCase(b)
	path := "/api/v1/clients/" + c.person + "/make-participant"
	other := e.create(b, map[string]any{"name": "Anna Muster"})
	e.fails(b, "POST", path, map[string]any{"company_id": other.ID, "dry_run": true}, 422, "validation_failed", "company_id")
	e.fails(b, "POST", path, map[string]any{"company_id": c.person, "dry_run": true}, 422, "validation_failed", "company_id")
	e.fails(b, "POST", "/api/v1/clients/"+c.company+"/make-participant", map[string]any{"company_id": c.company}, 422, "validation_failed")
	e.fails(b, "POST", path, map[string]any{"company_id": c.company, "participant_id": "con_nope", "dry_run": true}, 422,
		"validation_failed", "participant_id")
	// Only owners and admins; another workspace sees nothing.
	member := e.join(b.workspace, "member")
	e.fails(member, "POST", path, map[string]any{"company_id": c.company}, 403, "forbidden")
	stranger := e.workspace()
	e.fails(stranger, "POST", path, map[string]any{"company_id": c.company, "dry_run": true}, 404, "not_found")
	theirs := e.create(stranger, map[string]any{"name": "Theirs AG", "is_company": true})
	e.fails(stranger, "POST", path, map[string]any{"company_id": theirs.ID, "dry_run": true}, 404, "not_found")
	e.fails(b, "POST", path, map[string]any{"company_id": theirs.ID, "dry_run": true}, 422, "validation_failed", "company_id")
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM invoices WHERE client_id = $1`, c.person).Scan(&n); err != nil || n != 1 {
		t.Fatalf("person's invoices after refusals: %d %v", n, err)
	}
}
