package portalscope

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// fakeStore: slug → workspace; current is each workspace's slug now; domain each workspace's active domain, denied
// the workspaces whose plan lacks custom domains.
type fakeStore struct {
	owner   map[string]string
	current map[string]string
	domain  map[string]string
	denied  map[string]bool
	lookups int
}

func (f *fakeStore) PortalScopeByDomain(_ context.Context, host string) (store.PortalScope, error) {
	f.lookups++
	for ws, d := range f.domain {
		if d == host {
			return store.PortalScope{WorkspaceID: ws, Name: "Name of " + ws, Slug: f.current[ws], Domain: host}, nil
		}
	}
	return store.PortalScope{}, store.ErrNotFound
}

func (f *fakeStore) ActivePortalDomain(_ context.Context, ws string) (string, error) {
	if d, ok := f.domain[ws]; ok {
		return d, nil
	}
	return "", store.ErrNotFound
}

func (f *fakeStore) FeatureAllowed(_ context.Context, ws, _ string) (bool, error) {
	return !f.denied[ws], nil
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
		domain:  map[string]string{},
		denied:  map[string]bool{},
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
		{"retired slug page redirects", "GET", "portal.example.com", "/w/acme-old/invoices/?x=1", 302, "/w/acme/invoices/?x=1", seen{}},
		{"retired slug api still answers", "GET", "portal.example.com", "/w/acme-old/api/v1/public/portal/session", 418, "", seen{"/api/v1/public/portal/session", "wsp_a", true}},
		{"upper case redirects", "GET", "portal.example.com", "/w/ACME/", 302, "/w/acme/", seen{}},
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
			// Only the trailing-slash redirect may be cached: a retired slug can come back.
			if noStore := rec.Header().Get("Cache-Control") == "no-store"; tc.status == 302 != noStore {
				t.Fatalf("Cache-Control %q on %d", rec.Header().Get("Cache-Control"), rec.Code)
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
		"ÄPFEL Über ÉCOLE":              "aepfel-ueber-ecole", // as the migration's backfill spells it (00027)
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

// TestRetiredSlugTakenBack: acme → acme-ag → acme again. The redirects of both moves are not cacheable, so a browser
// that followed the first never loops on the way back.
func TestRetiredSlugTakenBack(t *testing.T) {
	f := newFake()
	h := New("https://portal.example.com", f).Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "https://portal.example.com"+path, nil))
		return rec
	}
	f.owner["acme-ag"], f.current["wsp_a"] = "wsp_a", "acme-ag"
	if rec := get("/w/acme/"); rec.Code != 302 || rec.Header().Get("Location") != "/w/acme-ag/" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("to acme-ag: %d %v", rec.Code, rec.Header())
	}
	f.current["wsp_a"] = "acme"
	if rec := get("/w/acme/"); rec.Code != 200 {
		t.Fatalf("acme again: %d %v", rec.Code, rec.Header())
	}
	if rec := get("/w/acme-ag/"); rec.Code != 302 || rec.Header().Get("Location") != "/w/acme/" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("back from acme-ag: %d %v", rec.Code, rec.Header())
	}
}

// TestLookupsAreRateLimited: past the per-address limit a slug is not even looked up.
func TestLookupsAreRateLimited(t *testing.T) {
	f := &countingStore{fakeStore: newFake()}
	h := New("https://portal.example.com", f).Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	var last int
	for range lookupsPerMinute + 1 {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "https://portal.example.com/w/probe-x/api/v1/public/portal/scope", nil))
		last = rec.Code
	}
	if last != http.StatusTooManyRequests || f.lookups != lookupsPerMinute {
		t.Fatalf("last %d after %d lookups", last, f.lookups)
	}
}

type countingStore struct {
	*fakeStore
	lookups int
}

func (c *countingStore) PortalScopeBySlug(ctx context.Context, slug string) (store.PortalScope, error) {
	c.lookups++
	return c.fakeStore.PortalScopeBySlug(ctx, slug)
}

func TestDomains(t *testing.T) {
	f := newFake()
	f.domain["wsp_a"] = "portal.acme.ch"
	f.domain["wsp_b"] = "portal.beta.ch"
	r := New("https://portal.example.com", f)
	r.EnableDomains("https://app.example.com", "", "https://media.example.com")
	type seen struct {
		path, workspace string
		onDomain        bool
	}
	var got *seen
	h := r.Handler(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		s, _ := FromContext(req.Context())
		got = &seen{req.URL.Path, s.WorkspaceID, OnDomain(req)}
		w.WriteHeader(http.StatusTeapot)
	}))
	for _, tt := range []struct {
		name, host, path string
		status           int
		location         string
		want             *seen
	}{
		{"domain page at the root", "portal.acme.ch", "/invoices/", http.StatusTeapot, "", &seen{"/invoices/", "wsp_a", true}},
		{"domain host with a port", "Portal.Acme.ch:443", "/", http.StatusTeapot, "", &seen{"/", "wsp_a", true}},
		{"domain portal api", "portal.beta.ch", "/api/v1/public/portal/session", http.StatusTeapot, "", &seen{"/api/v1/public/portal/session", "wsp_b", true}},
		{"domain refuses the staff api", "portal.acme.ch", "/api/v1/invoices", http.StatusNotFound, "", nil},
		{"domain refuses another scope's prefix", "portal.acme.ch", "/w/beta/api/v1/public/portal/session", http.StatusNotFound, "", nil},
		{"unknown host page is not the platform", "evil.example.org", "/", http.StatusNotFound, "", nil},
		{"unknown host api goes on unscoped", "10.0.0.5:3333", "/api/health", http.StatusTeapot, "", &seen{"/api/health", "", false}},
		{"unknown host refuses the staff api", "evil.example.org", "/api/v1/invoices", http.StatusNotFound, "", nil},
		{"unknown host refuses mcp", "evil.example.org", "/api/mcp", http.StatusNotFound, "", nil},
		{"unknown host refuses the portal api", "evil.example.org", "/api/v1/public/portal/session", http.StatusNotFound, "", nil},
		{"unknown host refuses slug api", "evil.example.org", "/w/beta/api/v1/public/portal/session", http.StatusNotFound, "", nil},
		{"unknown host refuses the old certificate question", "evil.example.org", "/api/v1/public/portal/domain-check", http.StatusNotFound, "", nil},
		{"loopback host keeps slug api", "127.0.0.1:3338", "/w/beta/api/v1/public/portal/session", http.StatusTeapot, "", &seen{"/api/v1/public/portal/session", "wsp_b", false}},
		{"platform host stays the platform", "app.example.com", "/settings/", http.StatusTeapot, "", &seen{"/settings/", "", false}},
		{"media host is ours", "media.example.com", "/api/media/x", http.StatusTeapot, "", &seen{"/api/media/x", "", false}},
		{"slug page moves to the domain", "portal.example.com", "/w/acme/invoices/?x=1", http.StatusFound, "https://portal.acme.ch/invoices/?x=1", nil},
		{"retired slug page moves to the domain", "portal.example.com", "/w/acme-old/", http.StatusFound, "https://portal.acme.ch/", nil},
		{"slug api keeps working", "portal.example.com", "/w/acme/api/v1/public/portal/session", http.StatusTeapot, "", &seen{"/api/v1/public/portal/session", "wsp_a", false}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got = nil
			req := httptest.NewRequest("GET", tt.path, nil)
			req.Host = tt.host
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.status || rec.Header().Get("Location") != tt.location {
				t.Fatalf("%s %s: %d %q, want %d %q", tt.host, tt.path, rec.Code, rec.Header().Get("Location"), tt.status, tt.location)
			}
			if (got == nil) != (tt.want == nil) || got != nil && *got != *tt.want {
				t.Fatalf("next saw %+v, want %+v", got, tt.want)
			}
		})
	}

	ctx := context.Background()
	if u, _ := r.CanonicalURL(ctx, store.Workspace{ID: "wsp_a"}); u != "https://portal.acme.ch/" {
		t.Fatalf("canonical with a domain: %q", u)
	}
	// Cached: a second request for the host asks the store no more, until Forget.
	before := f.lookups
	h.ServeHTTP(httptest.NewRecorder(), withHost("portal.acme.ch"))
	if f.lookups != before {
		t.Fatalf("lookups %d → %d: not cached", before, f.lookups)
	}

	// The domain breaks (or the plan loses it): after Forget, the slug serves again and the host is 404.
	delete(f.domain, "wsp_a")
	f.denied["wsp_b"] = true
	r.Forget()
	for host, path := range map[string]string{"portal.acme.ch": "/", "portal.beta.ch": "/"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, withHost(host))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s%s after the domain went: %d", host, path, rec.Code)
		}
	}
	for _, slug := range []string{"acme", "beta"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/w/"+slug+"/", nil)
		req.Host = "portal.example.com"
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusTeapot {
			t.Fatalf("/w/%s/ after its domain went: %d %q", slug, rec.Code, rec.Header().Get("Location"))
		}
	}
	if u, _ := r.CanonicalURL(ctx, store.Workspace{ID: "wsp_b"}); u != "https://portal.example.com/w/beta/" {
		t.Fatalf("canonical without the feature: %q", u)
	}
}

func TestDomainsOff(t *testing.T) {
	f := newFake()
	f.domain["wsp_a"] = "portal.acme.ch"
	r := New("https://portal.example.com", f)
	h := r.Handler(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { w.WriteHeader(http.StatusTeapot) }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, withHost("portal.acme.ch"))
	if rec.Code != http.StatusTeapot || OnDomain(httptest.NewRequest("GET", "/", nil)) {
		t.Fatalf("custom domains off: %d", rec.Code)
	}
	if u, _ := r.CanonicalURL(context.Background(), store.Workspace{ID: "wsp_a"}); u != "https://portal.example.com/w/acme/" {
		t.Fatalf("canonical with domains off: %q", u)
	}
}

func withHost(host string) *http.Request {
	req := httptest.NewRequest("GET", "/", nil)
	req.Host = host
	return req
}

// TestUnknownHostLookups: hosts the cache does not know cost a lookup each, capped per client address, and the cache
// never grows past maxCached.
func TestUnknownHostLookups(t *testing.T) {
	f := newFake()
	r := New("https://portal.example.com", f)
	r.EnableDomains("https://app.example.com")
	h := r.Handler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) }))
	limited := 0
	for i := range hostLookupsPerMinute + 5 {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, withHost(fmt.Sprintf("x%d.example.org", i)))
		if rec.Code == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited != 5 || f.lookups != hostLookupsPerMinute {
		t.Fatalf("%d refused, %d lookups", limited, f.lookups)
	}
	// Known hosts are still answered from the cache.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, withHost("x1.example.org"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cached unknown host: %d", rec.Code)
	}
	for i := range maxCached + 10 {
		_, _, _ = r.lookup(context.Background(), r.byHost, fmt.Sprintf("y%d.example.org", i), nil,
			func() (store.PortalScope, error) { return store.PortalScope{}, store.ErrNotFound })
	}
	if n := len(r.byHost); n > maxCached {
		t.Fatalf("cache holds %d hosts", n)
	}
}
