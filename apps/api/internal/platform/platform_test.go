package platform

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestHandler(t *testing.T) {
	h := handler(false, fstest.MapFS{
		"index.html":          {Data: []byte("home")},
		"settings/index.html": {Data: []byte("settings")},
		"404.html":            {Data: []byte("missing")},
		"_next/static/app.js": {Data: []byte("js")},
	})

	tests := []struct {
		path, body, cache string
		status            int
	}{
		{"/", "home", "no-cache", http.StatusOK},
		{"/settings/", "settings", "no-cache", http.StatusOK},
		{"/nope", "missing", "no-cache", http.StatusNotFound},
		{"/_next/static/app.js", "js", "public, max-age=31536000, immutable", http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest("GET", tt.path, nil))
			if rec.Code != tt.status || rec.Body.String() != tt.body {
				t.Fatalf("got %d %q, want %d %q", rec.Code, rec.Body.String(), tt.status, tt.body)
			}
			if got := rec.Header().Get("Cache-Control"); got != tt.cache {
				t.Fatalf("Cache-Control = %q, want %q", got, tt.cache)
			}
		})
	}
}

// TestSecurityHeaders: every page and asset refuses framing (clickjacking of /sign and the app), MIME sniffing and
// full-URL referrers; HSTS only when the origin is https.
func TestSecurityHeaders(t *testing.T) {
	files := fstest.MapFS{"index.html": {Data: []byte("home")}, "404.html": {Data: []byte("missing")}}
	for _, secure := range []bool{false, true} {
		for _, path := range []string{"/", "/nope"} {
			rec := httptest.NewRecorder()
			handler(secure, files).ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
			h := rec.Header()
			if h.Get("X-Frame-Options") != "DENY" || !strings.Contains(h.Get("Content-Security-Policy"), "frame-ancestors 'none'") ||
				h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
				t.Fatalf("secure=%v %s: headers %v", secure, path, h)
			}
			if got := h.Get("Strict-Transport-Security") != ""; got != secure {
				t.Fatalf("secure=%v %s: HSTS %q", secure, path, h.Get("Strict-Transport-Security"))
			}
		}
	}
}

func TestByHost(t *testing.T) {
	app := func(name string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(name)) })
	}
	h := byHost("https://portal.example.com", app("platform"), app("portal"))
	for _, tt := range []struct{ host, want string }{
		{"portal.example.com", "portal"},
		{"Portal.Example.com", "portal"},
		{"app.example.com", "platform"},
		{"media.example.com", "platform"}, // any other host, e.g. MEDIA_URL: its /api/media/ never reaches here
		{"portal.example.com:8443", "platform"},
	} {
		t.Run(tt.host, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			r.Host = tt.host
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, r)
			if rec.Body.String() != tt.want {
				t.Fatalf("host %q served %q, want %q", tt.host, rec.Body.String(), tt.want)
			}
		})
	}
}
