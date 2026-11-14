// Package platform serves the statically exported web apps embedded in the binary: apps/portal on
// PORTAL_URL's host and apps/platform on every other one. `pnpm --filter @helvetly/api build` copies
// apps/platform/out into dist and apps/portal/out into portal-dist before `go build`.
package platform

import (
	"embed"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"
)

//go:embed all:dist all:portal-dist
var embedded embed.FS

// Handler serves the portal to requests for portalURL's host and the platform to the rest; secure (an https
// PUBLIC_URL) adds HSTS.
func Handler(portalURL string, secure bool) http.Handler {
	return byHost(portalURL, handler(secure, sub("dist")), handler(secure, sub("portal-dist")))
}

func sub(dir string) fs.FS {
	files, err := fs.Sub(embedded, dir)
	if err != nil {
		panic(err) // unreachable: dir is a compile-time embedded directory
	}
	return files
}

// byHost picks the app by the Host header; a bad portalURL (refused by config) serves only the platform.
func byHost(portalURL string, platform, portal http.Handler) http.Handler {
	u, err := url.Parse(portalURL)
	if err != nil || u.Host == "" {
		return platform
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.EqualFold(r.Host, u.Host) {
			portal.ServeHTTP(w, r)
			return
		}
		platform.ServeHTTP(w, r)
	})
}

func handler(secure bool, files fs.FS) http.Handler {
	fileServer := http.FileServerFS(files)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		// No script-src: the static export's inline bootstrap scripts would need per-build hashes.
		h.Set("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
		h.Set("X-Frame-Options", "DENY") // frame-ancestors for older browsers
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if secure {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "."
		}
		if _, err := fs.Stat(files, name); err != nil {
			h.Set("Cache-Control", "no-cache")
			notFound(w, files)
			return
		}
		if strings.HasPrefix(name, "_next/static/") {
			h.Set("Cache-Control", "public, max-age=31536000, immutable") // content-hashed
		} else {
			h.Set("Cache-Control", "no-cache") // pages name the current build's assets: revalidate after a deploy
		}
		fileServer.ServeHTTP(w, r)
	})
}

func notFound(w http.ResponseWriter, files fs.FS) {
	page, err := fs.ReadFile(files, "404.html")
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write(page)
}
