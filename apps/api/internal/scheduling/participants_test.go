package scheduling

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

// company makes EuroChem Group AG (office@eurochem.example) with Lorenzo and Liam as participants and Oliver as a
// contact only; it answers the client and the people's ids.
func (e *env) company(b *browser) (client, lorenzo, liam, oliver string) {
	e.t.Helper()
	client = e.client(b, "office@eurochem.example")
	ctx := context.Background()
	if _, err := e.db.Exec(ctx, `UPDATE clients SET is_company = true, name = 'EuroChem Group AG' WHERE id = $1`, client); err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.db.Exec(ctx, `INSERT INTO client_contacts (id, client_id, workspace_id, name, email, roles, created_at, updated_at) VALUES
		('con_lorenzo_'||$1, $1, $2, 'Lorenzo Percic', 'lorenzo@eurochem.example', '{participant}', now(), now()),
		('con_liam_'||$1, $1, $2, 'Liam Gallagher', 'liam@eurochem.example', '{participant}', now(), now()),
		('con_oliver_'||$1, $1, $2, 'Oliver Harvey', 'oliver@eurochem.example', '{contact}', now(), now())`, client, b.workspace); err != nil {
		e.t.Fatal(err)
	}
	return client, "con_lorenzo_" + client, "con_liam_" + client, "con_oliver_" + client
}

func TestSessionParticipantValidation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	client, lorenzo, _, oliver := e.company(b)
	other, otherLorenzo, _, _ := e.company(b)
	_ = other
	person := e.client(b, "anna@mueller.example")
	stranger := e.workspace()
	foreign, foreignLorenzo, _, _ := e.company(stranger)
	_ = foreign
	body := func(c string, participant any) map[string]any {
		return map[string]any{"client_id": c, "title": "German lesson", "starts_local": "2026-12-01T09:00", "duration_minutes": 60,
			"participant_contact_id": participant}
	}
	out := e.create(b, body(client, lorenzo))
	if out.Data.Event.Participant == nil || out.Data.Event.Participant.Name != "Lorenzo Percic" ||
		out.Data.Occurrences[0].Participant == nil || out.Data.Occurrences[0].Participant.ID != lorenzo {
		t.Fatalf("participant: %+v %+v", out.Data.Event.Participant, out.Data.Occurrences[0].Participant)
	}
	for name, id := range map[string]string{"a contact only": oliver, "another client's": otherLorenzo,
		"another workspace's": foreignLorenzo, "unknown": "con_nope"} {
		if fields := e.fails(b, "POST", "/api/v1/scheduling/events", body(client, id), 422, "validation_failed"); fields["participant_contact_id"] == "" {
			t.Fatalf("%s: %v", name, fields)
		}
	}
	if fields := e.fails(b, "POST", "/api/v1/scheduling/events", body(person, lorenzo), 422, "validation_failed"); fields["participant_contact_id"] == "" {
		t.Fatalf("a person client's: %v", fields)
	}
	// Changing it (for the whole series) to null clears it; to someone not a participant is refused.
	ev := out.Data.Event.ID
	occ := out.Data.Occurrences[0].ID
	e.fails(b, "PATCH", "/api/v1/scheduling/occurrences/"+occ, map[string]any{"scope": "all", "participant_contact_id": oliver}, 422, "validation_failed")
	e.do(b, "PATCH", "/api/v1/scheduling/occurrences/"+occ, map[string]any{"scope": "all", "participant_contact_id": nil}, http.StatusOK, nil)
	var got store.SchedEvent
	got, err := e.st.Q.SchedEvent(context.Background(), b.workspace, ev, false)
	if err != nil || got.ParticipantContactID != nil {
		t.Fatalf("cleared: %v %v", got.ParticipantContactID, err)
	}
}

func TestSessionMailGoesToTheParticipant(t *testing.T) {
	e := newEnv(t)
	box, _ := e.withEmails()
	b := e.workspace()
	client, lorenzo, _, _ := e.company(b)
	e.create(b, map[string]any{"client_id": client, "title": "German lesson", "starts_local": "2026-12-01T09:00", "duration_minutes": 60,
		"mode": "live", "participant_contact_id": lorenzo, "attendees": []string{"office@eurochem.example", "coach@eurochem.example"}})
	m := one(t, box)
	if !slices.Equal(m.To, []string{"lorenzo@eurochem.example", "coach@eurochem.example"}) {
		t.Fatalf("to: %v", m.To)
	}
	contains(t, "greeting", m.Text, "Lorenzo Percic")
	contains(t, "ics", string(m.Calendar), "mailto:lorenzo@eurochem.example")
	if strings.Contains(string(m.Calendar), "office@eurochem.example") {
		t.Fatalf("the company is no attendee of a participant's session:\n%s", m.Calendar)
	}
	// Without a participant the company gets it, as before.
	e.create(b, map[string]any{"client_id": client, "title": "Team lesson", "starts_local": "2026-12-02T09:00", "duration_minutes": 60})
	if m := one(t, box); !slices.Equal(m.To, []string{"office@eurochem.example"}) {
		t.Fatalf("company session to: %v", m.To)
	}
}

type invoiceLines struct {
	Data struct {
		ParticipantContactID *string `json:"participant_contact_id"`
		Lines                []struct {
			Description string `json:"description"`
		} `json:"lines"`
	} `json:"data"`
}

func TestInvoiceSessionsNameOrAddressTheParticipant(t *testing.T) {
	for _, mode := range []string{"company", "participants"} {
		t.Run(mode, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace()
			client, lorenzo, liam, _ := e.company(b)
			if _, err := e.db.Exec(context.Background(), `UPDATE clients SET documents_to = $2 WHERE id = $1`, client, mode); err != nil {
				t.Fatal(err)
			}
			var ids []string
			for i, p := range []any{lorenzo, liam, lorenzo, nil} {
				o := e.create(b, map[string]any{"client_id": client, "title": "German lesson", "starts_local": "2026-11-16T0" + string(rune('6'+i)) + ":00",
					"duration_minutes": 60, "unit_price": "120.00", "currency": "CHF", "participant_contact_id": p}).Data.Occurrences[0]
				e.do(b, "POST", "/api/v1/scheduling/occurrences/"+o.ID+"/attendance", map[string]any{"status": "attended"}, 200, nil)
				ids = append(ids, o.ID)
			}
			var out struct {
				Data struct {
					InvoiceIDs []string `json:"invoice_ids"`
				}
			}
			e.do(b, "POST", "/api/v1/scheduling/occurrences/invoice", map[string]any{"occurrence_ids": ids}, 201, &out)
			byWhom := map[string][]string{}
			for _, id := range out.Data.InvoiceIDs {
				var inv invoiceLines
				e.do(b, "GET", "/api/v1/invoices/"+id, nil, 200, &inv)
				who := ""
				if inv.Data.ParticipantContactID != nil {
					who = *inv.Data.ParticipantContactID
				}
				for _, l := range inv.Data.Lines {
					byWhom[who] = append(byWhom[who], l.Description)
				}
			}
			if mode == "company" {
				lines := byWhom[""]
				if len(out.Data.InvoiceIDs) != 1 || len(lines) != 4 || strings.Count(strings.Join(lines, "\n"), " · Lorenzo Percic") != 2 ||
					strings.Count(strings.Join(lines, "\n"), " · Liam Gallagher") != 1 {
					t.Fatalf("company invoice: %d %v", len(out.Data.InvoiceIDs), byWhom)
				}
				return
			}
			// One invoice per participant (and the company's for the session without one), never mixed, no suffix.
			if len(out.Data.InvoiceIDs) != 3 || len(byWhom[lorenzo]) != 2 || len(byWhom[liam]) != 1 || len(byWhom[""]) != 1 {
				t.Fatalf("participants invoices: %v", byWhom)
			}
			for _, lines := range byWhom {
				for _, l := range lines {
					if strings.Contains(l, "Percic") || strings.Contains(l, "Gallagher") {
						t.Fatalf("suffix in participants mode: %q", l)
					}
				}
			}
		})
	}
}
