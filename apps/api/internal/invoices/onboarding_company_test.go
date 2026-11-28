package invoices

import (
	"context"
	"net/http"
	"testing"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func TestOnboardingCompanySavePreservesOtherSettings(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	const path = "/api/v1/invoice-settings"
	e.do(b, "PUT", path, map[string]any{
		"payment_confirmation": false, "seller": map[string]any{"email": "office@example.test"},
	}, http.StatusOK, nil)

	e.do(b, "PUT", path, map[string]any{
		"seller": map[string]any{
			"name": "Muster", "street": "Bahnhofstrasse", "street_number": "12", "apt": nil,
			"zip": "8001", "city": "Zürich", "country": "CH", "legal_form": "sole", "vat_number": nil,
		},
		"vat_registered": false, "default_vat_mode": "none", "iban": nil,
		"language": "en", "currency": "CHF", "default_terms_days": 30, "number_format": "{YYYY}-{NNN}",
	}, http.StatusOK, nil)

	var got struct{ Data Settings }
	e.do(b, "GET", path, nil, http.StatusOK, &got)
	if got.Data.PaymentConfirmation || got.Data.Seller.Email == nil || *got.Data.Seller.Email != "office@example.test" {
		t.Fatalf("company save changed unrelated settings: %+v", got.Data)
	}
	if err := e.svc.CompleteOnboarding(context.Background(), b.workspace, func(store.Q) error { return nil }); err != nil {
		t.Fatal(err)
	}
}

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
	if err := finish(); err == nil || marked != 0 {
		t.Fatalf("a Swiss company without its legal form: %v, marked %d", err, marked)
	}
	put(map[string]any{"legal_form": "ag"}, nil)
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

// The legal form is a code of the seller's country's list: another country's code is refused, a new country drops the
// old one's form, and a country without a list needs none to finish the welcome.
func TestSellerLegalForm(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	legalForm := func() *string {
		t.Helper()
		var got struct{ Data Settings }
		e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &got)
		return got.Data.Seller.LegalForm
	}
	put := func(seller map[string]any) {
		t.Helper()
		e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": seller}, http.StatusOK, nil)
	}

	put(map[string]any{"country": "CH", "legal_form": "gmbh"})
	if f := legalForm(); f == nil || *f != "gmbh" {
		t.Fatalf("saved form: %v", f)
	}
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{"legal_form": "spzoo"}},
		http.StatusUnprocessableEntity, "validation_failed", "seller.legal_form")
	put(map[string]any{"country": "PL", "legal_form": "spzoo"})
	if f := legalForm(); f == nil || *f != "spzoo" {
		t.Fatalf("a new country with its form: %v", f)
	}
	put(map[string]any{"country": "CH"})
	if f := legalForm(); f != nil {
		t.Fatalf("a new country keeps the old one's form: %v", *f)
	}
	put(map[string]any{"legal_form": "sole"})
	put(map[string]any{"legal_form": nil})
	if f := legalForm(); f != nil {
		t.Fatalf("cleared form: %v", *f)
	}

	var forms struct {
		Data map[string][]struct{ Code, Group string }
	}
	e.do(b, "GET", "/api/v1/invoice-settings/legal-forms", nil, http.StatusOK, &forms)
	if len(forms.Data["CH"]) == 0 || forms.Data["CH"][0].Group == "" {
		t.Fatalf("legal forms list: %+v", forms.Data["CH"])
	}

	marked := 0
	put(map[string]any{"name": "Acme Inc", "street": "Main Street", "street_number": "1", "zip": "10001", "city": "New York", "country": "US"})
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"vat_registered": false, "default_vat_mode": "none"}, http.StatusOK, nil)
	if err := e.svc.CompleteOnboarding(context.Background(), b.workspace, func(store.Q) error { marked++; return nil }); err != nil || marked != 1 {
		t.Fatalf("a country without a list: %v, marked %d", err, marked)
	}
}
