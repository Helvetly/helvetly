package invoices

import (
	"context"
	"net/http"
	"slices"
	"testing"
	"time"
)

func TestUnsupportedSellerCountries(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	for _, country := range []string{"HU", "PT", "RO"} {
		e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{"country": country}},
			http.StatusUnprocessableEntity, "validation_failed", "seller.country")
	}
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{"country": "DE"}}, http.StatusOK, nil)

	// a seller stored in such a country before the rule existed cannot issue
	ctx := context.Background()
	set, err := loadSettings(ctx, e.st.Q, b.workspace)
	if err != nil {
		t.Fatal(err)
	}
	set.Seller.Country = "RO"
	if err := e.st.PutInvoiceSettings(ctx, b.workspace, set, time.Now()); err != nil {
		t.Fatal(err)
	}
	draft := e.draft(b, clientID, nil)
	out := e.fails(b, "POST", "/api/v1/invoices/"+draft.ID+"/issue", nil, http.StatusUnprocessableEntity, "cannot_issue")
	if !slices.ContainsFunc(out.Error.Details.Reasons, func(r reason) bool {
		return r.Code == "seller_country_unsupported" && r.Field == "settings.seller.country"
	}) {
		t.Fatalf("reasons %+v, want seller_country_unsupported", out.Error.Details.Reasons)
	}
}
