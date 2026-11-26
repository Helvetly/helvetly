package clients

import (
	"context"
	"slices"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestPeopleRoles(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	company := e.create(b, map[string]any{"name": "EuroChem Group AG", "is_company": true})
	person := e.create(b, map[string]any{"name": "Lorenzo Percic"})
	base := "/api/v1/clients/" + company.ID + "/contacts"
	add := func(body map[string]any) store.Contact {
		var out struct{ Data store.Contact }
		e.do(b, "POST", base, body, 201, &out)
		return out.Data
	}

	// Existing and new people are contacts unless they say otherwise.
	oliver := add(map[string]any{"name": "Oliver Harvey", "email": "oliver@eurochem.ch"})
	if !slices.Equal(oliver.Roles, []string{"contact"}) || !oliver.IsPrimary {
		t.Fatalf("default roles: %+v", oliver)
	}
	// A participant alone is never primary, even as the first of a new company.
	other := e.create(b, map[string]any{"name": "Other AG", "is_company": true})
	var p struct{ Data store.Contact }
	e.do(b, "POST", "/api/v1/clients/"+other.ID+"/contacts", map[string]any{"name": "Pat", "roles": []string{"participant"}}, 201, &p)
	if p.Data.IsPrimary || !slices.Equal(p.Data.Roles, []string{"participant"}) {
		t.Fatalf("participant first: %+v", p.Data)
	}
	lorenzo := add(map[string]any{"name": "Lorenzo Percic", "roles": []string{"participant"}, "email": "lorenzo@eurochem.ch",
		"street": "Seestrasse", "street_number": "5", "zip": "8002", "city": "Zürich", "country": "ch"})
	if lorenzo.IsPrimary || *lorenzo.Country != "CH" {
		t.Fatalf("participant: %+v", lorenzo)
	}
	// Both roles, in a fixed order.
	var both struct{ Data store.Contact }
	e.do(b, "PATCH", base+"/"+oliver.ID, map[string]any{"roles": []string{"participant", "contact"}}, 200, &both)
	if !slices.Equal(both.Data.Roles, []string{"contact", "participant"}) || !both.Data.IsPrimary {
		t.Fatalf("both: %+v", both.Data)
	}

	// Validation on every write.
	e.fails(b, "POST", base, map[string]any{"name": "X", "roles": []string{}}, 422, "validation_failed", "roles")
	e.fails(b, "POST", base, map[string]any{"name": "X", "roles": []string{"boss"}}, 422, "validation_failed", "roles")
	e.fails(b, "PATCH", base+"/"+lorenzo.ID, map[string]any{"is_primary": true}, 422, "validation_failed", "is_primary")
	e.fails(b, "POST", base, map[string]any{"name": "No mail", "roles": []string{"participant"}, "portal_enabled": true}, 422,
		"validation_failed", "portal_enabled")
	e.fails(b, "PATCH", base+"/"+oliver.ID, map[string]any{"roles": []string{"contact"}, "portal_enabled": true}, 422,
		"validation_failed", "portal_enabled")
	// A person client is its own participant.
	e.fails(b, "POST", "/api/v1/clients/"+person.ID+"/contacts", map[string]any{"name": "Y", "roles": []string{"participant"}}, 422,
		"validation_failed", "roles")
	// A refused write left nothing behind.
	var got struct{ Data store.Client }
	e.do(b, "GET", "/api/v1/clients/"+company.ID, nil, 200, &got)
	if len(got.Data.Contacts) != 2 {
		t.Fatalf("contacts after refusals: %+v", got.Data.Contacts)
	}

	// Taking the contact role from the primary passes primary to the oldest remaining contact.
	gina := add(map[string]any{"name": "Gina", "email": "gina@eurochem.ch"})
	e.do(b, "PATCH", base+"/"+oliver.ID, map[string]any{"roles": []string{"participant"}}, 200, nil)
	e.do(b, "GET", "/api/v1/clients/"+company.ID, nil, 200, &got)
	for _, c := range got.Data.Contacts {
		if c.IsPrimary != (c.ID == gina.ID) {
			t.Fatalf("primary after role change: %+v", got.Data.Contacts)
		}
	}

	// Portal access on and off is audited.
	e.do(b, "PATCH", base+"/"+lorenzo.ID, map[string]any{"portal_enabled": true}, 200, nil)
	e.do(b, "PATCH", base+"/"+lorenzo.ID, map[string]any{"roles": []string{"contact"}, "portal_enabled": false}, 200, nil)
	for _, kind := range []string{"portal.participant_access_granted", "portal.participant_access_revoked"} {
		var n int
		if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE kind = $1`, kind).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("%s: %d", kind, n)
		}
	}

	// The documents switch takes company or participants only.
	e.do(b, "PATCH", "/api/v1/clients/"+company.ID, map[string]any{"documents_to": "participants"}, 200, &got)
	if got.Data.DocumentsTo != "participants" {
		t.Fatalf("documents_to: %q", got.Data.DocumentsTo)
	}
	e.fails(b, "PATCH", "/api/v1/clients/"+company.ID, map[string]any{"documents_to": "everyone"}, 422, "validation_failed", "documents_to")
}

func TestPeopleWorkspaceIsolation(t *testing.T) {
	e := newEnv(t)
	a, other := e.workspace(), e.workspace()
	company := e.create(a, map[string]any{"name": "EuroChem Group AG", "is_company": true})
	var p struct{ Data store.Contact }
	e.do(a, "POST", "/api/v1/clients/"+company.ID+"/contacts", map[string]any{"name": "Lorenzo", "roles": []string{"participant"}}, 201, &p)
	e.fails(other, "PATCH", "/api/v1/clients/"+company.ID+"/contacts/"+p.Data.ID, map[string]any{"roles": []string{"contact"}}, 404, "not_found")
	e.fails(other, "DELETE", "/api/v1/clients/"+company.ID+"/contacts/"+p.Data.ID, nil, 404, "not_found")
	theirs := e.create(other, map[string]any{"name": "Theirs AG", "is_company": true})
	// Another client's person is not this client's, even in the same call shape.
	e.fails(other, "PATCH", "/api/v1/clients/"+theirs.ID+"/contacts/"+p.Data.ID, map[string]any{"name": "Hijack"}, 404, "not_found")
}
