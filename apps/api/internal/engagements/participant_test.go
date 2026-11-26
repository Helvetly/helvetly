package engagements

import (
	"context"
	"strings"
	"testing"
)

// euroChem makes client a company with the participants Lorenzo and Liam (ids con_l_<client>, con_m_<client>).
func (e *env) euroChem(client, mode string) (lorenzo, liam string) {
	e.t.Helper()
	ctx := context.Background()
	if _, err := e.pool.Exec(ctx, `UPDATE clients SET is_company = true, documents_to = $2 WHERE id = $1`, client, mode); err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `INSERT INTO client_contacts (id, client_id, workspace_id, name, email, roles, created_at, updated_at)
		SELECT 'con_l_'||id, id, workspace_id, 'Lorenzo Percic', 'lorenzo@eurochem.ch', '{participant}'::text[], now(), now() FROM clients WHERE id = $1
		UNION ALL SELECT 'con_m_'||id, id, workspace_id, 'Liam Gallagher', NULL, '{participant,contact}'::text[], now(), now() FROM clients WHERE id = $1`,
		client); err != nil {
		e.t.Fatal(err)
	}
	return "con_l_" + client, "con_m_" + client
}

func TestEngagementParticipant(t *testing.T) {
	for _, mode := range []string{"company", "participants"} {
		t.Run(mode, func(t *testing.T) {
			e := newEnv(t)
			realDrafts(e)
			b := e.workspace()
			client := e.client(b)
			lorenzo, liam := e.euroChem(client, mode)
			// Only a participant of the client.
			e.fails(b, "POST", "/api/v1/engagements", input(client, map[string]any{"participant_contact_id": "con_nope"}), 422,
				"validation_failed", "participant_contact_id")
			other := e.client(b)
			e.fails(b, "POST", "/api/v1/engagements", input(other, map[string]any{"participant_contact_id": lorenzo}), 422,
				"validation_failed", "participant_contact_id")
			eng := e.create(b, input(client, map[string]any{"participant_contact_id": lorenzo, "billing": "arrears"}))
			root := "/api/v1/engagements/" + eng.ID
			// An entry of its own is the engagement's participant's; one from Liam's session carries Liam.
			e.do(b, "POST", root+"/entries", map[string]any{"quantity": "2", "date": "2026-11-02"}, 201, nil)
			if _, err := e.pool.Exec(context.Background(), `INSERT INTO engagement_entries (id, engagement_id, period_id, date, quantity, created_at, participant_contact_id)
				VALUES ('ent_liam', $1, $2, '2026-11-03', 1000, now(), $3)`, eng.ID, eng.CurrentPeriod.ID, liam); err != nil {
				t.Fatal(err)
			}
			var inv invoiceOut
			e.do(b, "POST", root+"/periods/"+eng.CurrentPeriod.ID+"/invoice", map[string]any{"kind": "usage", "detail": "per_entry"}, 201, &inv)
			lines := strings.Join(e.lines(inv.Data.InvoiceID), "\n")
			var addressed *string
			if err := e.pool.QueryRow(context.Background(), `SELECT participant_contact_id FROM invoices WHERE id = $1`, inv.Data.InvoiceID).Scan(&addressed); err != nil {
				t.Fatal(err)
			}
			if mode == "company" {
				if addressed != nil || !strings.Contains(lines, "02.11.2026 · Lorenzo Percic|") || !strings.Contains(lines, "03.11.2026 · Liam Gallagher|") {
					t.Fatalf("company invoice: %v\n%s", addressed, lines)
				}
				return
			}
			if addressed == nil || *addressed != lorenzo || strings.Contains(lines, "Percic") || strings.Contains(lines, "Gallagher") {
				t.Fatalf("participants invoice: %v\n%s", addressed, lines)
			}
		})
	}
}
