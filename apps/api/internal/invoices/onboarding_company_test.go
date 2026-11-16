package invoices

import (
	"context"
	"net/http"
	"testing"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// The welcome's company step is mandatory on the server: it marks the workspace done only when the stored name,
// address and country (and the VAT number of a VAT-registered seller) are there. The apartment and the bank account stay optional.
func TestCompleteOnboardingNeedsTheCompanyDetails(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	ctx := context.Background()
	marked := 0
	finish := func() error {
		return e.svc.CompleteOnboarding(ctx, b.workspace, func(store.Q) error { marked++; return nil })
	}
	put := func(seller map[string]any, rest map[string]any) {
		t.Helper()
		body := map[string]any{"seller": seller}
		for k, v := range rest {
			body[k] = v
		}
		e.do(b, "PUT", "/api/v1/invoice-settings", body, http.StatusOK, nil)
	}

	if status, code, _, ok := auth.Describe(finish()); !ok || status != http.StatusUnprocessableEntity || code != "validation_failed" || marked != 0 {
		t.Fatalf("no details: %d %s, marked %d", status, code, marked)
	}
	// Partial saves stay allowed, and stay incomplete.
	put(map[string]any{"name": "Muster AG", "street": "Bahnhofstrasse", "street_number": "1", "zip": "8001"}, nil)
	if err := finish(); err == nil || marked != 0 {
		t.Fatalf("no city: %v, marked %d", err, marked)
	}
	put(map[string]any{"city": "Zürich", "country": "CH", "apt": "  "}, map[string]any{"vat_registered": true, "default_vat_mode": "exclusive"})
	if err := finish(); err == nil || marked != 0 {
		t.Fatalf("VAT-registered without a number: %v, marked %d", err, marked)
	}
	put(map[string]any{"vat_number": "CHE-116.281.710 MWST"}, nil)
	if err := finish(); err != nil || marked != 1 { // no IBAN, no apartment
		t.Fatalf("complete details: %v, marked %d", err, marked)
	}
	put(map[string]any{}, map[string]any{"vat_registered": false, "default_vat_mode": "none"})
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{"vat_number": nil}}, http.StatusOK, nil)
	if err := finish(); err != nil || marked != 2 {
		t.Fatalf("not VAT-registered, no number: %v, marked %d", err, marked)
	}
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{"apt": string(make([]byte, 51))}},
		http.StatusUnprocessableEntity, "validation_failed", "seller.apt")
}
