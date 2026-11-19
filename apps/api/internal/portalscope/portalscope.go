// Package portalscope decides which workspace's client portal a request is for, in one place. Phase 1: the path
// prefix /w/<slug>/ on PORTAL_URL's host, for pages and API calls alike (the portal calls /w/<slug>/api/…, so its
// downloads and images carry the scope too). A request without the prefix is unscoped: the shared /login.
//
// Phase 2, custom domains (internal/customdomains): with EnableDomains, Handler first resolves a Host that is a
// workspace's active domain (portal.firma.ch) to its workspace, pages at the root and the portal's API at /api, and
// CanonicalURL answers with the domain while it is active and the plan includes it.
package portalscope

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
)

// Store is what the resolver reads and writes of internal/store.
type Store interface {
	PortalScopeBySlug(ctx context.Context, slug string) (store.PortalScope, error)
	CurrentPortalSlug(ctx context.Context, workspaceID string) (string, error)
	AddFirstPortalSlug(ctx context.Context, workspaceID, slug string, now time.Time) (bool, error)
	PortalScopeByDomain(ctx context.Context, host string) (store.PortalScope, error)
	ActivePortalDomain(ctx context.Context, workspaceID string) (string, error)
	FeatureAllowed(ctx context.Context, workspaceID, feature string) (bool, error)
}

type Resolver struct {
	base string // PORTAL_URL, an origin
	host string
	db   Store
	// limit caps the slug lookups per client address: every /w/<x>/… request is one, so probing for slugs is bounded.
	limit *auth.RateLimiter

	// domains: custom domains are on (EnableDomains); own are the installation's hostnames, never a custom domain.
	domains bool
	own     []string
	mu      sync.Mutex
	byHost  map[string]cached // host → its workspace, or none
	byWS    map[string]cached // workspace → its active domain, or none
	// hostLimit caps the lookups of uncached hosts per client address.
	hostLimit *auth.RateLimiter
}

// cached is one lookup, good until expires: other instances' changes show within cacheFor.
type cached struct {
	scope   store.PortalScope
	found   bool
	expires time.Time
}

// cacheFor bounds how long another instance's change takes to show here (Forget clears this instance's at once);
// maxCached bounds the memory a flood of made-up hosts can take: a full cache is emptied and fills again.
const (
	cacheFor  = 15 * time.Second
	maxCached = 10_000
	// hostLookupsPerMinute caps, per client address, the database lookups of hosts the cache does not know.
	hostLookupsPerMinute = 300
)

// errHostLimit: a client asked about too many unknown hosts.
var errHostLimit = errors.New("too many host lookups")

// lookupsPerMinute leaves a portal page's own requests (page, prefetches, API calls) well inside it.
const lookupsPerMinute = 600

// New resolves scopes for portalURL's host; a bad portalURL (refused by config) scopes nothing.
func New(portalURL string, db Store) *Resolver {
	u, err := url.Parse(portalURL)
	if err != nil {
		u = &url.URL{}
	}
	return &Resolver{base: strings.TrimRight(portalURL, "/"), host: u.Host, db: db, limit: auth.NewRateLimiter(lookupsPerMinute, time.Minute),
		byHost: map[string]cached{}, byWS: map[string]cached{}, hostLimit: auth.NewRateLimiter(hostLookupsPerMinute, time.Minute)}
}

// EnableDomains turns custom domains on. own are the installation's other origins or hosts (PUBLIC_URL, MEDIA_URL,
// …): requests for them are never a custom domain, and with domains on a page for a host that is neither ours nor an
// active domain is 404 instead of the platform.
func (r *Resolver) EnableDomains(own ...string) {
	r.domains = true
	r.own = []string{hostname(r.host)}
	for _, o := range own {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			o = u.Host
		}
		if o != "" {
			r.own = append(r.own, hostname(o))
		}
	}
}

// Forget drops the cached domains, after a domain is added, changes status or is removed.
func (r *Resolver) Forget() {
	r.mu.Lock()
	defer r.mu.Unlock()
	clear(r.byHost)
	clear(r.byWS)
}

// hostname is host without its port, lowercase.
func hostname(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return strings.ToLower(strings.TrimSuffix(host, "."))
}

// lookup caches find's answer for key in m; an error is not cached. allow, when set, admits a lookup the cache
// cannot answer (errHostLimit when it refuses).
func (r *Resolver) lookup(ctx context.Context, m map[string]cached, key string, allow func() bool, find func() (store.PortalScope, error)) (store.PortalScope, bool, error) {
	now := time.Now()
	r.mu.Lock()
	c, ok := m[key]
	r.mu.Unlock()
	if ok && now.Before(c.expires) {
		return c.scope, c.found, nil
	}
	if allow != nil && !allow() {
		return store.PortalScope{}, false, errHostLimit
	}
	scope, err := find()
	found := err == nil
	if found {
		allowed, ferr := r.db.FeatureAllowed(ctx, scope.WorkspaceID, store.FeatureCustomPortalDomain)
		if ferr != nil {
			return scope, false, ferr
		}
		found = allowed // a plan without the feature: the domain stops resolving at once
	} else if !errors.Is(err, store.ErrNotFound) {
		return scope, false, err
	}
	r.mu.Lock()
	if len(m) >= maxCached {
		clear(m)
	}
	m[key] = cached{scope: scope, found: found, expires: now.Add(cacheFor)}
	r.mu.Unlock()
	return scope, found, nil
}

// domainScope is the workspace whose active domain req's host is.
func (r *Resolver) domainScope(req *http.Request) (store.PortalScope, bool, error) {
	host := hostname(req.Host)
	return r.lookup(req.Context(), r.byHost, host, func() bool { return r.hostLimit.Allow(req) },
		func() (store.PortalScope, error) { return r.db.PortalScopeByDomain(req.Context(), host) })
}

// ActiveDomain is the workspace's active domain, "" when it has none (or custom domains are off).
func (r *Resolver) ActiveDomain(ctx context.Context, workspaceID string) (string, error) {
	if !r.domains {
		return "", nil
	}
	scope, found, err := r.lookup(ctx, r.byWS, workspaceID, nil, func() (store.PortalScope, error) {
		host, err := r.db.ActivePortalDomain(ctx, workspaceID)
		return store.PortalScope{WorkspaceID: workspaceID, Domain: host}, err
	})
	if !found || err != nil {
		return "", err
	}
	return scope.Domain, nil
}

// domainURL is the portal's address on a custom domain: PORTAL_URL's scheme, the domain's root.
func (r *Resolver) domainURL(domain string) string {
	scheme, _, _ := strings.Cut(r.base, "://")
	return scheme + "://" + domain + "/"
}

// portalAPI are the API paths a custom domain serves: the portal's, and the health checks.
func portalAPI(path string) bool {
	return strings.HasPrefix(path, "/api/v1/public/portal/") || path == "/api/health" || path == "/api/ready"
}

func writeNotFound(w http.ResponseWriter, api bool) {
	if !api {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("Not found.\n"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(`{"error":{"code":"not_found","message":"Not found."}}` + "\n"))
}

// OnDomain reports whether Handler resolved the request by its custom domain (the portal is served, never the
// platform).
func OnDomain(req *http.Request) bool {
	s, ok := FromContext(req.Context())
	return ok && s.Domain != ""
}

// PathPrefix is the prefix of the scope's pages and API calls on the address the request came in on: none on a
// custom domain, /w/<slug> under PORTAL_URL.
func PathPrefix(s store.PortalScope) string {
	if s.Domain != "" {
		return ""
	}
	return Prefix(s.Slug)
}

// URLOf is the scope's canonical address: its active domain, else PORTAL_URL/w/<slug>/.
func (r *Resolver) URLOf(ctx context.Context, s store.PortalScope) (string, error) {
	domain, err := r.ActiveDomain(ctx, s.WorkspaceID)
	if domain == "" || err != nil {
		return r.URLFor(s.Slug), err
	}
	return r.domainURL(domain), nil
}

// originAPI are the paths any host may reach: the health checks, and the origin's certificate question.
func originAPI(path string) bool {
	return path == "/api/health" || path == "/api/ready" || path == "/api/v1/public/portal/domain-check"
}

// byDomain serves a request for a host that is not the installation's own: an active domain's portal (its pages and
// the portal's API, nothing else), and for any other host only the health checks and the certificate question, 404
// otherwise. Never the platform, its API or another scope's prefix.
func (r *Resolver) byDomain(w http.ResponseWriter, req *http.Request, next http.Handler) {
	api := strings.HasPrefix(req.URL.Path, "/api/") || strings.HasPrefix(req.URL.Path, "/w/")
	if originAPI(req.URL.Path) {
		next.ServeHTTP(w, req)
		return
	}
	scope, found, err := r.domainScope(req)
	switch {
	case errors.Is(err, errHostLimit):
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
	case err != nil:
		http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
	case !found || api && !portalAPI(req.URL.Path):
		writeNotFound(w, api)
	default:
		next.ServeHTTP(w, req.WithContext(WithScope(req.Context(), scope)))
	}
}

// ours: host is one of the installation's (PORTAL_URL's, the others EnableDomains names) or a loopback address,
// which only a local proxy or health check sends.
func (r *Resolver) ours(host string) bool {
	h := hostname(host)
	if slices.Contains(r.own, h) || h == "localhost" {
		return true
	}
	ip, err := netip.ParseAddr(strings.Trim(h, "[]"))
	return err == nil && ip.IsLoopback()
}

type ctxKey struct{}

// FromContext is the scope Handler put on the request; false for an unscoped one.
func FromContext(ctx context.Context) (store.PortalScope, bool) {
	s, ok := ctx.Value(ctxKey{}).(store.PortalScope)
	return s, ok
}

// WithScope puts a scope on ctx, as Handler does (for tests of the handlers behind it).
func WithScope(ctx context.Context, s store.PortalScope) context.Context {
	return context.WithValue(ctx, ctxKey{}, s)
}

// Prefix is the path a scope's pages and API calls start with.
func Prefix(slug string) string { return "/w/" + slug }

// Handler resolves /w/<slug>/…: an unknown slug answers 404, a page under a retired slug redirects (302, never
// cached: a workspace may take a retired slug back, and a cached redirect would then loop) to the current one, and a known one goes on to next without the prefix, its scope in the context. Pages are scoped on the
// portal's host only (any other serves the platform); API calls on any host, since the portal's development server
// proxies them from its own. Every other request goes on unchanged.
func (r *Resolver) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if r.domains && !r.ours(req.Host) {
			r.byDomain(w, req, next)
			return
		}
		asked, rest, ok := strings.Cut(strings.TrimPrefix(req.URL.Path, "/w/"), "/")
		rest = "/" + rest
		api := strings.HasPrefix(rest, "/api/")
		if !strings.HasPrefix(req.URL.Path, "/w/") || asked == "" || !api && (r.host == "" || !strings.EqualFold(req.Host, r.host)) {
			next.ServeHTTP(w, req)
			return
		}
		if !r.limit.Allow(req) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":{"code":"rate_limited","message":"Too many requests: try again in a minute."}}` + "\n"))
			return
		}
		scope, err := r.db.PortalScopeBySlug(req.Context(), strings.ToLower(asked))
		switch {
		case errors.Is(err, store.ErrNotFound) && api:
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"code":"not_found","message":"Not found."}}` + "\n"))
			return
		case errors.Is(err, store.ErrNotFound):
			next.ServeHTTP(w, req) // no such file: the portal's 404 page
			return
		case err != nil:
			http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
			return
		}
		page := !api && (req.Method == http.MethodGet || req.Method == http.MethodHead)
		if page && ok {
			// The workspace's own domain is its portal's address while it works: 302, since it may break or go.
			domain, err := r.ActiveDomain(req.Context(), scope.WorkspaceID)
			if err != nil {
				http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
				return
			}
			if domain != "" {
				target := url.URL{Path: rest, RawQuery: req.URL.RawQuery}
				w.Header().Set("Cache-Control", "no-store")
				http.Redirect(w, req, strings.TrimSuffix(r.domainURL(domain), "/")+target.String(), http.StatusFound)
				return
			}
		}
		if !api && (asked != scope.Slug && page || !ok) {
			target := url.URL{Path: Prefix(scope.Slug) + rest, RawQuery: req.URL.RawQuery}
			status := http.StatusMovedPermanently // only /w/<slug> → /w/<slug>/, which never changes
			if asked != scope.Slug {
				status = http.StatusFound
				w.Header().Set("Cache-Control", "no-store")
			}
			http.Redirect(w, req, target.String(), status)
			return
		}
		inner := req.Clone(WithScope(req.Context(), scope))
		inner.URL.Path, inner.URL.RawPath = rest, ""
		next.ServeHTTP(w, inner)
	})
}

// CanonicalURL is where the workspace's clients sign in (with a trailing slash): its active domain, else its slug's
// address; a workspace without a slug gets one from its name first.
func (r *Resolver) CanonicalURL(ctx context.Context, ws store.Workspace) (string, error) {
	slug, err := r.Slug(ctx, ws)
	if err != nil {
		return "", err
	}
	return r.URLOf(ctx, store.PortalScope{WorkspaceID: ws.ID, Slug: slug})
}

// URLFor is the portal address of a slug.
func (r *Resolver) URLFor(slug string) string { return r.base + Prefix(slug) + "/" }

// Slug is the workspace's current slug, made from its name when it has none (workspaces made after the migration
// get theirs when first needed, by when the welcome has named them).
func (r *Resolver) Slug(ctx context.Context, ws store.Workspace) (string, error) {
	slug, err := r.db.CurrentPortalSlug(ctx, ws.ID)
	if !errors.Is(err, store.ErrNotFound) {
		return slug, err
	}
	base := FromName(ws.Name)
	for n := 1; n <= 100; n++ {
		candidate := base
		if n > 1 {
			candidate = fmt.Sprintf("%s-%d", base, n)
		}
		if Problem(candidate) != "" {
			continue
		}
		added, err := r.db.AddFirstPortalSlug(ctx, ws.ID, candidate, time.Now().UTC())
		if err != nil {
			return "", err
		}
		if added {
			return candidate, nil
		}
		// Taken, or a concurrent request gave the workspace its slug.
		if slug, err := r.db.CurrentPortalSlug(ctx, ws.ID); !errors.Is(err, store.ErrNotFound) {
			return slug, err
		}
	}
	return "", fmt.Errorf("no free portal slug for %q", base)
}

// The words a slug may not be: paths of the portal and the app, and names that would mislead a client. The
// migration (00027_portal_slugs.sql) holds a copy for its backfill.
var reserved = []string{"api", "w", "login", "logout", "assets", "static", "admin", "app", "www", "portal",
	"help", "support", "status", "docs", "media", "mail", "settings", "helvetly"}

// MinLen and MaxLen bound a slug's length.
const (
	MinLen = 3
	MaxLen = 32
)

var shape = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)

// Problem is why a slug cannot be used: "invalid" (not lowercase letters, digits and inner hyphens of MinLen to
// MaxLen characters), "reserved", or "" when it can.
func Problem(slug string) string {
	switch {
	case len(slug) < MinLen || len(slug) > MaxLen || !shape.MatchString(slug):
		return "invalid"
	case slices.Contains(reserved, slug):
		return "reserved"
	}
	return ""
}

// FromName is the slug a workspace's name suggests, short enough for a "-<n>" suffix.
func FromName(name string) string {
	s := tags.Slug(name)
	if len(s) > MaxLen-4 {
		s = strings.TrimRight(s[:MaxLen-4], "-")
	}
	if len(s) < MinLen {
		s = strings.TrimRight("portal-"+s, "-")
	}
	return s
}
