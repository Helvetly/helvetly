package portalscope

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// fakeStore: slug → workspace; current is each workspace's slug now.
type fakeStore struct {
	owner   map[string]string
	current map[string]string
}

func (f *fakeStore) PortalScopeBySlug(_ context.Context, slug string) (store.PortalScope, error) {
	ws, ok := f.owner[slug]
	if !ok {
		return store.PortalScope{}, store.ErrNotFound
	}
	return store.PortalScope{WorkspaceID: ws, Name: "Name of " + ws, Slug: f.current[ws]}, nil
}

func (f *fakeStore) CurrentPortalSlug(_ context.Context, ws string) (string, error) {
	if s, ok := f.current[ws]; ok {
		return s, nil
	}
	return "", store.ErrNotFound
}

func (f *fakeStore) AddFirstPortalSlug(_ context.Context, ws, slug string, _ time.Time) (bool, error) {
	if _, taken := f.owner[slug]; taken {
		return false, nil
	}
	f.owner[slug], f.current[ws] = ws, slug
	return true, nil
}

func newFake() *fakeStore {
	return &fakeStore{
		owner:   map[string]string{"acme": "wsp_a", "acme-old": "wsp_a", "beta": "wsp_b"},
		current: map[string]string{"wsp_a": "acme", "wsp_b": "beta"},
	}
}

func TestHandler(t *testing.T) {
	r := New("https://portal.example.com", newFake())
	type seen struct {
		path, workspace string
		scoped          bool
	}
	var got seen
	h := r.Handler(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		s, ok := FromContext(req.Context())
		got = seen{req.URL.Path, s.WorkspaceID, ok}
		w.WriteHeader(http.StatusTeapot)
	}))
	for _, tc := range []struct {
		name, method, host, path string
		status                   int
		location                 string
		next                     seen
	}{
		{"unscoped page", "GET", "portal.example.com", "/login/", 418, "", seen{"/login/", "", false}},
		{"unscoped api", "POST", "portal.example.com", "/api/v1/public/portal/auth/start", 418, "", seen{"/api/v1/public/portal/auth/start", "", false}},
		{"pages on another host are never scoped", "GET", "app.example.com", "/w/acme/login/", 418, "", seen{"/w/acme/login/", "", false}},
		{"api on another host (the dev proxy)", "GET", "localhost:3333", "/w/acme/api/v1/public/portal/scope", 418, "", seen{"/api/v1/public/portal/scope", "wsp_a", true}},
		{"scoped page", "GET", "portal.example.com", "/w/acme/invoices/", 418, "", seen{"/invoices/", "wsp_a", true}},
		{"scoped api", "POST", "PORTAL.example.com", "/w/beta/api/v1/public/portal/auth/start", 418, "", seen{"/api/v1/public/portal/auth/start", "wsp_b", true}},
		{"retired slug page redirects", "GET", "portal.example.com", "/w/acme-old/invoices/?x=1", 301, "/w/acme/invoices/?x=1", seen{}},
		{"retired slug api still answers", "GET", "portal.example.com", "/w/acme-old/api/v1/public/portal/session", 418, "", seen{"/api/v1/public/portal/session", "wsp_a", true}},
		{"upper case redirects", "GET", "portal.example.com", "/w/ACME/", 301, "/w/acme/", seen{}},
		{"no trailing slash", "GET", "portal.example.com", "/w/acme", 301, "/w/acme/", seen{}},
		{"unknown slug page: the 404 page", "GET", "portal.example.com", "/w/nobody/login/", 418, "", seen{"/w/nobody/login/", "", false}},
		{"unknown slug api", "GET", "portal.example.com", "/w/nobody/api/v1/public/portal/scope", 404, "", seen{}},
		{"bare /w/", "GET", "portal.example.com", "/w/", 418, "", seen{"/w/", "", false}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got = seen{}
			req := httptest.NewRequest(tc.method, "http://"+tc.host+tc.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.status || rec.Header().Get("Location") != tc.location || got != tc.next {
				t.Fatalf("%d %q %+v, want %d %q %+v", rec.Code, rec.Header().Get("Location"), got, tc.status, tc.location, tc.next)
			}
			if tc.status == 404 && !strings.Contains(rec.Body.String(), `"not_found"`) {
				t.Fatalf("body %q", rec.Body.String())
			}
		})
	}
}

func TestProblem(t *testing.T) {
	for slug, want := range map[string]string{
		"acme": "", "mueller-soehne": "", "a1b": "", strings.Repeat("a", 32): "",
		"ab": "invalid", strings.Repeat("a", 33): "invalid", "-acme": "invalid", "acme-": "invalid", "Acme": "invalid",
		"ac me": "invalid", "acme_1": "invalid", "": "invalid", "../x": "invalid",
		"api": "reserved", "login": "reserved", "assets": "reserved", "www": "reserved", "helvetly": "reserved",
	} {
		if got := Problem(slug); got != want {
			t.Errorf("Problem(%q) = %q, want %q", slug, got, want)
		}
	}
}

func TestFromName(t *testing.T) {
	for name, want := range map[string]string{
		"Müller & Söhne AG":             "mueller-soehne-ag",
		"Café Zürich":                   "cafe-zuerich",
		"Ö":                             "portal-oe",
		"!!":                            "portal",
		strings.Repeat("abcdefghij", 5): "abcdefghijabcdefghijabcdefgh",
	} {
		if got := FromName(name); got != want || Problem(got) != "" && got != "portal" {
			t.Errorf("FromName(%q) = %q, want %q", name, got, want)
		}
	}
}

// TestSlugGivesOneFromTheName: a workspace without a slug gets its name's, the next free one when taken, never a
// reserved word; one with a slug keeps it.
func TestSlugGivesOneFromTheName(t *testing.T) {
	f := newFake()
	r := New("https://portal.example.com", f)
	ctx := context.Background()
	for _, tc := range []struct{ ws, name, want string }{
		{"wsp_a", "Whatever", "acme"},
		{"wsp_c", "Acme", "acme-2"},
		{"wsp_d", "Studio", "studio"},
		{"wsp_e", "Portal", "portal-2"},
	} {
		if got, err := r.Slug(ctx, store.Workspace{ID: tc.ws, Name: tc.name}); err != nil || got != tc.want {
			t.Errorf("%s: %q %v, want %q", tc.ws, got, err, tc.want)
		}
	}
	if u, _ := r.CanonicalURL(ctx, store.Workspace{ID: "wsp_d"}); u != "https://portal.example.com/w/studio/" {
		t.Errorf("CanonicalURL = %q", u)
	}
}
