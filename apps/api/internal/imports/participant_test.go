package imports

import (
	"context"
	"testing"
	"time"
)

// The production shape: EuroChem Group AG with Oliver, Lorenzo and Liam as people. An imported invoice to "Lorenzo
// Percic" belongs to EuroChem, addressed to Lorenzo, instead of to a new person client.
func TestImportedInvoiceOfAParticipant(t *testing.T) {
	st, sess, _ := invoiceStore(t)
	ctx, now := context.Background(), time.Now().UTC()
	if err := st.CreateClient(ctx, "wsp_a", "cli_euro", map[string]any{"name": "EuroChem Group AG", "is_company": true,
		"email": "office@eurochem.ch", "country": "CH"}, now); err != nil {
		t.Fatal(err)
	}
	people := []struct {
		id, name, email string
		roles           []string
	}{
		{"con_o", "Oliver Harvey", "oliver@eurochem.ch", []string{"contact"}},
		{"con_l", "Lorenzo Percic", "l.percic@eurochem.ch", []string{"participant"}},
		{"con_g", "Liam Gallagher", "liam@eurochem.ch", []string{"participant"}},
	}
	for _, p := range people {
		if err := st.CreateContact(ctx, "wsp_a", "cli_euro", p.id, map[string]any{"name": p.name, "email": p.email, "roles": p.roles}, false, now); err != nil {
			t.Fatal(err)
		}
	}
	// Another workspace's participant of the same name never matches.
	if err := st.CreateClient(ctx, "wsp_b", "cli_other", map[string]any{"name": "Other AG", "is_company": true}, now); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateContact(ctx, "wsp_b", "cli_other", "con_x", map[string]any{"name": "Lorenzo Percic", "roles": []string{"participant"}}, false, now); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, extra, client, participant string
	}{
		{"email exactly", `{"client_name": "L. Percic", "client_email": "L.Percic@eurochem.ch"}`, "cli_euro", "con_l"},
		{"name and the company's domain", `{"client_name": "Lorenzo  Percic", "client_email": "lorenzo@eurochem.ch"}`, "cli_euro", "con_l"},
		{"the name alone, unique", `{"client_name": "lorenzo percic", "client_email": "lorenzo.private@gmail.com"}`, "cli_euro", "con_l"},
		{"a contact is no participant", `{"client_name": "Oliver Harvey", "client_email": "oliver.h@gmail.com"}`, "", ""},
		{"no match: the usual client match", `{"client_name": "kunde ag"}`, "cli_a", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data := invoiceData(t, tt.extra)
			client, err := importedClient(ctx, st.Q, "wsp_a", data)
			if err != nil || client != tt.client {
				t.Fatalf("client %q (%v), want %q", client, err, tt.client)
			}
			inv, invalid, err := importedInvoice(ctx, st.Q, "wsp_a", now.Format(time.DateOnly), data)
			if err != nil {
				t.Fatal(err)
			}
			got := ""
			if inv.ParticipantContactID != nil {
				got = *inv.ParticipantContactID
			}
			if tt.client != "" && (got != tt.participant || invalid["client_id"] != "") {
				t.Fatalf("participant %q, want %q (%v)", got, tt.participant, invalid)
			}
		})
	}
	_ = sess
	// Two participants of one name: the name alone picks nobody.
	if err := st.CreateContact(ctx, "wsp_a", "cli_euro", "con_l2", map[string]any{"name": "Lorenzo Percic", "roles": []string{"participant"}}, false, now); err != nil {
		t.Fatal(err)
	}
	if client, err := importedClient(ctx, st.Q, "wsp_a", invoiceData(t, `{"client_name": "Lorenzo Percic", "client_email": "lp@gmail.com"}`)); err != nil || client != "" {
		t.Fatalf("ambiguous: %q %v", client, err)
	}
}
