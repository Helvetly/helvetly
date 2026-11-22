package invoices

import (
	"net/http"
	"strings"
	"testing"
)

func TestNormaliseWebsite(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"firma.ch", "https://firma.ch"},
		{"www.firma.ch/de", "https://www.firma.ch/de"},
		{"https://firma.ch", "https://firma.ch"},
		{"http://firma.ch/", "http://firma.ch/"},
		{"ftp://firma.ch", ""},
		{"javascript:alert(1)", ""},
		{"https://user:pw@firma.ch", ""},
		{"localhost", ""},
		{"firma .ch", ""},
		{"https://.ch", ""},
		{"https://firma.ch/" + strings.Repeat("a", 200), ""},
	} {
		got, msg := normaliseWebsite(tc.in)
		if (msg == "") != (tc.want != "") || got != tc.want {
			t.Errorf("normaliseWebsite(%q) = %q, %q; want %q", tc.in, got, msg, tc.want)
		}
	}
}

func TestSellerWebsiteIsSavedNormalisedAndCleared(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	put := func(v any) {
		e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{"website": v}}, http.StatusOK, nil)
	}
	got := func() *string {
		var out struct {
			Data Settings `json:"data"`
		}
		e.do(b, "GET", "/api/v1/invoice-settings", nil, http.StatusOK, &out)
		return out.Data.Seller.Website
	}
	if got() != nil {
		t.Fatal("a new workspace has no website")
	}
	put("firma.ch")
	if w := got(); w == nil || *w != "https://firma.ch" {
		t.Fatalf("a bare domain: %v", w)
	}
	put(nil)
	if got() != nil {
		t.Fatal("null clears the website")
	}
	e.fails(b, "PUT", "/api/v1/invoice-settings", map[string]any{"seller": map[string]any{"website": "ftp://firma.ch"}},
		http.StatusUnprocessableEntity, "validation_failed", "seller.website")
}
