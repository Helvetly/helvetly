// Package portalscope decides which workspace's client portal a request is for, in one place. Phase 1: the path
// prefix /w/<slug>/ on PORTAL_URL's host, for pages and API calls alike (the portal calls /w/<slug>/api/…, so its
// downloads and images carry the scope too). A request without the prefix is unscoped: the shared /login.
//
// Phase 2 adds verified custom domains: Handler resolves the Host to its workspace before looking at the path, and
// CanonicalURL answers with the domain; callers do not change.
package portalscope

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
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
}

type Resolver struct {
	base string // PORTAL_URL, an origin
	host string
	db   Store
	// limit caps the slug lookups per client address: every /w/<x>/… request is one, so probing for slugs is bounded.
	limit *auth.RateLimiter
}

// lookupsPerMinute leaves a portal page's own requests (page, prefetches, API calls) well inside it.
const lookupsPerMinute = 600

// New resolves scopes for portalURL's host; a bad portalURL (refused by config) scopes nothing.
func New(portalURL string, db Store) *Resolver {
	u, err := url.Parse(portalURL)
	if err != nil {
		u = &url.URL{}
	}
	return &Resolver{base: strings.TrimRight(portalURL, "/"), host: u.Host, db: db, limit: auth.NewRateLimiter(lookupsPerMinute, time.Minute)}
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

// CanonicalURL is where the workspace's clients sign in (with a trailing slash); a workspace without a slug gets one
// from its name first.
func (r *Resolver) CanonicalURL(ctx context.Context, ws store.Workspace) (string, error) {
	slug, err := r.Slug(ctx, ws)
	if err != nil {
		return "", err
	}
	return r.URLFor(slug), nil
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
