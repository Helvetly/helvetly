package imports

import (
	"context"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/store"
)

func init() { register(clientsKind) }

// clientsKind is the reference kind: the fields of POST /clients, checked and created exactly as that endpoint does.
var clientsKind = Kind{
	Name:     "clients",
	Label:    "Clients",
	Resource: "clients",
	Prompt: "Extract the clients (customers) this document names. One record per party, not per name: a person named " +
		"alongside a company is that company's contact, not a second client. When both appear, the company is the client: " +
		"its name goes in name, the person in preferred_name, and is_company is true. A private individual billing under " +
		"their own name is one record with is_company false. A spreadsheet row is one client. Country is the ISO 3166 " +
		"alpha-2 code (CH, DE). Guess nothing: a field the document does not carry is null, never an empty string or an " +
		"invented address, email or phone number.",
	Schema: record(map[string]any{
		"name":                nullable("string", "Company name, or the person's full name"),
		"preferred_name":      nullable("string", "Contact person or short name"),
		"is_company":          nullable("boolean", "true for a company, false for a private person"),
		"email":               nullable("string", "Email address"),
		"billing_email":       nullable("string", "Email address for invoices, when different"),
		"phone":               nullable("string", "Phone number in international format, e.g. +41 78 123 45 67"),
		"website":             nullable("string", "Website"),
		"street":              nullable("string", "Street name without the number"),
		"street_number":       nullable("string", "House number"),
		"apt":                 nullable("string", "Apartment, floor or PO box"),
		"zip":                 nullable("string", "Postal code"),
		"city":                nullable("string", "City"),
		"country":             nullable("string", "ISO 3166 alpha-2 country code"),
		"vat_number":          nullable("string", "VAT or UID number, e.g. CHE-123.456.789 MWST"),
		"registration_number": nullable("string", "Company register number"),
		"language":            nullable("string", "Correspondence language as an ISO 639-1 code"),
		"currency":            nullable("string", "ISO 4217 currency the client is billed in"),
		"payment_terms_days":  nullable("integer", "Payment terms in days"),
		"note":                nullable("string", "Anything else worth keeping, briefly"),
	}),
	Check: func(_ context.Context, _ store.Q, _ string, data Data) (map[string]string, error) {
		_, invalid := clients.CheckCreate(data)
		return invalid, nil
	},
	Duplicate: func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportDuplicate, error) {
		fields, _ := clients.CheckCreate(data)
		return q.SimilarClient(ctx, workspaceID, text(fields["name"]), text(fields["vat_number"]), text(fields["email"]))
	},
	Create: func(ctx context.Context, q store.Q, sess store.Session, data Data, _ Source) (string, error) {
		fields, _ := clients.CheckCreate(data)
		id := auth.NewID("cli")
		return id, q.CreateClient(ctx, sess.Workspace.ID, id, fields, time.Now().UTC())
	},
}
