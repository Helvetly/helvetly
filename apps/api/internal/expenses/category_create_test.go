package expenses

import "testing"

func TestCreateCategoryWithVATTreatment(t *testing.T) {
	e := newEnv(t)
	owner, other := e.workspace(), e.workspace()
	e.categories(owner) // seeds the catalogue
	before := len(e.categories(other))

	type made struct {
		Data struct {
			category
			VATTreatment *string `json:"vat_treatment"`
		}
	}
	var c made
	e.do(owner, "POST", "/api/v1/expense-categories", map[string]any{"name": "Coworking", "account_code": "6010", "vat_treatment": "reduced"}, 201, &c)
	if c.Data.Name != "Coworking" || c.Data.AccountCode != "6010" || c.Data.VATTreatment == nil || *c.Data.VATTreatment != "reduced" {
		t.Fatalf("created: %+v", c.Data)
	}

	e.fails(owner, "POST", "/api/v1/expense-categories", map[string]any{"name": " coworking ", "account_code": "6000"}, 422, "validation_failed", "name")
	e.fails(owner, "POST", "/api/v1/expense-categories", map[string]any{"name": "Desks", "account_code": "60a0"}, 422, "validation_failed", "account_code")
	e.fails(owner, "POST", "/api/v1/expense-categories", map[string]any{"name": "Desks", "account_code": "6000", "vat_treatment": "zero"}, 422, "validation_failed", "vat_treatment")

	e.do(owner, "PATCH", "/api/v1/expense-categories/"+c.Data.ID, map[string]any{"vat_treatment": "exempt"}, 200, &c)
	if *c.Data.VATTreatment != "exempt" || c.Data.Name != "Coworking" {
		t.Fatalf("updated: %+v", c.Data)
	}

	// Another workspace neither sees it nor is blocked by its name.
	if got := e.categories(other); len(got) != before || got["6010"].ID != "" {
		t.Fatalf("other workspace sees it: %+v", got["6010"])
	}
	e.fails(other, "PATCH", "/api/v1/expense-categories/"+c.Data.ID, map[string]any{"vat_treatment": "none"}, 404, "not_found")
	e.do(other, "POST", "/api/v1/expense-categories", map[string]any{"name": "Coworking", "account_code": "6010"}, 201, nil)
}
