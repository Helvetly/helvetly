package invoices

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestAddressee(t *testing.T) {
	str := func(s string) *string { return &s }
	company := store.Client{Name: "EuroChem Group AG", IsCompany: true, Street: str("Industriestrasse"), StreetNumber: str("9"),
		Zip: str("4002"), City: str("Basel"), Country: str("CH"), VATNumber: str("CHE-123.456.789 MWST"), BillingEmail: str("ap@eurochem.ch"),
		Contacts: []store.Contact{
			{ID: "con_l", Name: "Lorenzo Percic", Email: str("lorenzo@eurochem.ch"), Roles: []string{"participant"},
				Street: str("Seestrasse"), StreetNumber: str("5"), Zip: str("8002"), City: str("Zürich"), VATNumber: str("CHE-222.333.444")},
			{ID: "con_m", Name: "Liam Gallagher", Email: str("liam@eurochem.ch"), Roles: []string{"participant"}},
		}}
	tests := []struct {
		name, participant, wantName, wantCity, wantEmail, wantVAT string
	}{
		{"company", "", "EuroChem Group AG", "Basel", "ap@eurochem.ch", "CHE-123.456.789 MWST"},
		{"participant with an address", "con_l", "Lorenzo Percic", "Zürich", "lorenzo@eurochem.ch", "CHE-222.333.444"},
		{"participant without one", "con_m", "Liam Gallagher", "Basel", "liam@eurochem.ch", "CHE-123.456.789 MWST"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			inv := store.Invoice{}
			if tt.participant != "" {
				inv.ParticipantContactID = &tt.participant
			}
			got := addressee(company, inv)
			if got.Name != tt.wantName || got.City != tt.wantCity || *got.Email != tt.wantEmail || *got.VATNumber != tt.wantVAT {
				t.Fatalf("%+v", got)
			}
		})
	}
}

// participantClient makes the ready client a company whose participants are Lorenzo (own address) and Liam.
func (e *env) participantClient(client string) {
	e.t.Helper()
	ctx := context.Background()
	for _, sql := range []string{
		`UPDATE clients SET is_company = true, name = 'EuroChem Group AG', documents_to = 'participants' WHERE id = $1`,
		`INSERT INTO client_contacts (id, client_id, workspace_id, name, email, roles, street, street_number, zip, city, country, created_at, updated_at)
			SELECT 'con_l', id, workspace_id, 'Lorenzo Percic', 'lorenzo@eurochem.ch', '{participant}', 'Seestrasse', '5', '8002', 'Zürich', 'CH', now(), now()
			FROM clients WHERE id = $1`,
		`INSERT INTO client_contacts (id, client_id, workspace_id, name, email, roles, created_at, updated_at)
			SELECT 'con_m', id, workspace_id, 'Liam Gallagher', 'liam@eurochem.ch', '{participant}', now(), now() FROM clients WHERE id = $1`,
	} {
		if _, err := e.raw.Exec(ctx, sql, client); err != nil {
			e.t.Fatal(err)
		}
	}
}

// addressedDraft is a draft of client addressed to participant ("" for the company), as sessions make them.
func (e *env) addressedDraft(b *browser, client, participant string) Invoice {
	e.t.Helper()
	inv := e.draft(b, client, nil)
	if participant != "" {
		if _, err := e.raw.Exec(context.Background(), `UPDATE invoices SET participant_contact_id = $2 WHERE id = $1`, inv.ID, participant); err != nil {
			e.t.Fatal(err)
		}
	}
	return inv
}

func TestParticipantInvoiceGoesToTheParticipant(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.participantClient(client)
	ctx := context.Background()

	lorenzo := e.invoice(b, "POST", "/api/v1/invoices/"+e.addressedDraft(b, client, "con_l").ID+"/issue", nil, http.StatusOK)
	liam := e.invoice(b, "POST", "/api/v1/invoices/"+e.addressedDraft(b, client, "con_m").ID+"/issue", nil, http.StatusOK)
	company := e.issued(b, client, nil)
	// The buyer snapshot: the participant's name, their address or the company's; the invoice stays the company's.
	if lorenzo.Buyer.Name != "Lorenzo Percic" || lorenzo.Buyer.City != "Zürich" ||
		liam.Buyer.Name != "Liam Gallagher" || liam.Buyer.City != "Lausanne" || company.Buyer.Name != "EuroChem Group AG" {
		t.Fatalf("buyers: %+v / %+v / %+v", lorenzo.Buyer, liam.Buyer, company.Buyer)
	}
	// The invoice email, reminders and dunning go to the addressee.
	for inv, want := range map[string]string{lorenzo.ID: "lorenzo@eurochem.ch", liam.ID: "liam@eurochem.ch", company.ID: "ap@kunde.ch"} {
		if got := e.draftOf(b, inv, http.StatusOK).Data.To; !slices.Equal(got, []string{want}) {
			t.Fatalf("%s email to %v, want %s", inv, got, want)
		}
		got, err := e.st.Q.DunningRecipient(ctx, b.workspace, inv)
		if err != nil || got != want {
			t.Fatalf("%s dunning to %q (%v), want %s", inv, got, err, want)
		}
	}
	// The payment confirmation too.
	e.invoice(b, "POST", path(lorenzo.ID, "payments"), pay("50", "paid_on", "2026-01-15"), http.StatusCreated)
	if got := e.confirmations(b); len(got) != 1 || !slices.Equal(got[0].To, []string{"lorenzo@eurochem.ch"}) {
		t.Fatalf("confirmation: %+v", got)
	}
	// Switching the mode back changes no issued invoice.
	if _, err := e.raw.Exec(ctx, `UPDATE clients SET documents_to = 'company' WHERE id = $1`, client); err != nil {
		t.Fatal(err)
	}
	var again struct{ Data Invoice }
	e.do(b, "GET", "/api/v1/invoices/"+lorenzo.ID, nil, http.StatusOK, &again)
	if again.Data.Buyer.Name != "Lorenzo Percic" || again.Data.ParticipantContactID == nil {
		t.Fatalf("after switching: %+v", again.Data.Buyer)
	}
}

func TestDraftChangingClientDropsTheParticipant(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.participantClient(client)
	other := e.client(b, map[string]any{"name": "Other AG"})
	inv := e.addressedDraft(b, client, "con_l")
	moved := e.invoice(b, "PATCH", "/api/v1/invoices/"+inv.ID, map[string]any{"client_id": other}, http.StatusOK)
	if moved.ParticipantContactID != nil {
		t.Fatalf("participant kept across clients: %v", *moved.ParticipantContactID)
	}
}
