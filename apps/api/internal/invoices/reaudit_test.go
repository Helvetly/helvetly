package invoices

import (
	"context"
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func TestSelfBillingCannotUseFutureAcceptance(t *testing.T) {
	e := newEnv(t)
	b, _ := e.ready()
	supplier := e.client(b, map[string]any{"vat_number": "CHE-109.322.551 MWST"})
	future := time.Now().AddDate(0, 0, 1)
	if err := e.st.CreateAgreement(context.Background(), store.SelfBillingAgreement{
		ID: auth.NewID("sba"), WorkspaceID: b.workspace, ClientID: supplier, StartsOn: "2000-01-01",
		AcceptedAt: &future, CreatedAt: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	draft := e.draft(b, supplier, map[string]any{"kind": "self_billed"})
	e.fails(b, "POST", path(draft.ID, "issue"), nil, http.StatusConflict, "self_billing_agreement_missing")
	e.agreement(b, supplier)
	e.invoice(b, "POST", path(draft.ID, "issue"), nil, http.StatusOK)
}

func TestIssuedSellerContactIsFrozen(t *testing.T) {
	e := newEnv(t)
	b, client := e.ready()
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{
		"phone": "+41 44 123 45 67", "email": "original@example.com",
	}}, http.StatusOK, nil)
	inv := e.issued(b, client, nil)
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{
		"phone": "+41 44 999 99 99", "email": "changed@example.com",
	}}, http.StatusOK, nil)
	var out struct {
		Data struct {
			Seller struct{ Phone, Email string }
		}
	}
	e.do(b, "GET", "/api/v1/invoices/"+inv.ID, nil, http.StatusOK, &out)
	if out.Data.Seller.Phone != "+41 44 123 45 67" || out.Data.Seller.Email != "original@example.com" {
		t.Fatalf("issued seller contact changed or was not recorded: %+v", out.Data.Seller)
	}
}
