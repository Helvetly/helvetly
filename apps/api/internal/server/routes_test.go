package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"helvetly.com/api/internal/books"
	"helvetly.com/api/internal/dashboard"
	"helvetly.com/api/internal/einvoice"
	"helvetly.com/api/internal/heidi"
	"helvetly.com/api/internal/instalments"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/store"
)

// signedOut answers 401 like auth.SignedIn without a session, so a registered route is told from the 404 catch-all.
type signedOut struct{}

func (signedOut) CookieSession(context.Context, store.Q, *http.Request) (store.Session, error) {
	return store.Session{}, errors.New("signed out")
}

func (signedOut) SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) }
}
func (signedOut) WriteError(w http.ResponseWriter, _ *http.Request, _ error) {
	w.WriteHeader(http.StatusInternalServerError)
}
func (signedOut) Decode(http.ResponseWriter, *http.Request, any) bool { return false }

func TestNewRoutesRegistered(t *testing.T) {
	inv := invoices.New(nil, signedOut{}, nil, nil, nil)
	h := New(http.NotFoundHandler(), func(mux *http.ServeMux) { // the same services main wires, together, so patterns cannot clash
		inv.Register(mux)
		instalments.New(nil, signedOut{}, inv, nil, nil).Register(mux)
		books.New(nil, signedOut{}).Register(mux)
		einvoice.New(nil, signedOut{}, nil).Register(mux)
		dashboard.New(nil, signedOut{}).Register(mux)
		heidi.New(nil, signedOut{}, nil, nil, heidi.Options{}).Register(mux)
	})
	for _, tt := range []struct{ method, path string }{
		{"GET", "/api/v1/instalment-plans"},
		{"GET", "/api/v1/instalment-plans/p1"},
		{"POST", "/api/v1/instalment-plans/p1/pause"},
		{"POST", "/api/v1/instalment-plans/p1/resume"},
		{"POST", "/api/v1/instalment-plans/p1/cancel"},
		{"POST", "/api/v1/invoices/i1/plan"},
		{"GET", "/api/v1/periods"},
		{"POST", "/api/v1/periods"},
		{"POST", "/api/v1/periods/2026-10/reopen"},
		{"GET", "/api/v1/audit-log"},
		{"GET", "/api/v1/audit-log/export"},
		{"GET", "/api/v1/audit-log/verify"},
		{"GET", "/api/v1/clients/c1/self-billing-agreements"},
		{"POST", "/api/v1/clients/c1/self-billing-agreements"},
		{"DELETE", "/api/v1/clients/c1/self-billing-agreements/a1"},
		{"GET", "/api/v1/invoices/i1/einvoice"},
		{"GET", "/api/v1/reports/key-figures"},
		{"GET", "/api/v1/heidi/suggestions"},
		{"GET", "/api/v1/heidi/usage"},

		{"GET", "/api/v1/heidi/consent"},
		{"GET", "/api/v1/heidi/conversations/c1"},
		{"POST", "/api/v1/heidi/chat"},
		{"POST", "/api/v1/heidi/chat/confirm"},
	} {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", rec.Code)
			}
		})
	}
}
