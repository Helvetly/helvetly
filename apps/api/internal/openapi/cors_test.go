package openapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCORS(t *testing.T) {
	const docs = "https://docs.helvetly.com"
	// A documented read and write, chosen from the catalogue so the test follows it.
	var read, write Operation
	for _, op := range Operations {
		if op.Method == http.MethodGet && read.Path == "" && !strings.Contains(op.Path, "{") {
			read = op
		}
		if op.Method != http.MethodGet && write.Path == "" && !strings.Contains(op.Path, "{") {
			write = op
		}
	}
	if read.Path == "" || write.Path == "" {
		t.Fatal("the catalogue needs a GET and a write without path parameters")
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	for _, tc := range []struct {
		name, origin, method, path, preflight string
		allowed                               bool
		status                                int
	}{
		{"documented GET from the docs", docs, http.MethodGet, read.Path, "", true, http.StatusTeapot},
		{"documented write from the docs", docs, write.Method, write.Path, "", true, http.StatusTeapot},
		{"foreign origin", "https://evil.example", http.MethodGet, read.Path, "", false, http.StatusTeapot},
		{"origin differing in scheme", "http://docs.helvetly.com", http.MethodGet, read.Path, "", false, http.StatusTeapot},
		{"no origin", "", http.MethodGet, read.Path, "", false, http.StatusTeapot},
		{"undocumented route", docs, http.MethodGet, "/api/v1/session", "", false, http.StatusTeapot},
		{"the MCP endpoint", docs, http.MethodPost, "/api/mcp", "", false, http.StatusTeapot},
		{"the frontend", docs, http.MethodGet, "/", "", false, http.StatusTeapot},
		{"preflight", docs, http.MethodOptions, write.Path, write.Method, true, http.StatusNoContent},
		{"preflight of a foreign origin", "https://evil.example", http.MethodOptions, write.Path, write.Method, false, http.StatusTeapot},
		{"preflight of an undocumented method", docs, http.MethodOptions, read.Path, http.MethodPut, false, http.StatusTeapot},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if tc.preflight != "" {
				r.Header.Set("Access-Control-Request-Method", tc.preflight)
				r.Header.Set("Access-Control-Request-Headers", "authorization, content-type")
			}
			w := httptest.NewRecorder()
			CORS(docs, next).ServeHTTP(w, r)

			h := w.Result().Header
			if w.Code != tc.status {
				t.Errorf("status %d, want %d", w.Code, tc.status)
			}
			if got := h.Get("Access-Control-Allow-Origin"); (got == docs) != tc.allowed || (got != "" && got != docs) {
				t.Errorf("Access-Control-Allow-Origin %q, allowed %v", got, tc.allowed)
			}
			if h.Get("Access-Control-Allow-Credentials") != "" {
				t.Error("credentials must never be allowed")
			}
			if tc.preflight != "" && tc.allowed {
				if m := h.Get("Access-Control-Allow-Methods"); !strings.Contains(m, tc.preflight) || strings.Contains(m, http.MethodOptions) {
					t.Errorf("Access-Control-Allow-Methods %q", m)
				}
				if got := h.Get("Access-Control-Allow-Headers"); got != "Authorization, Content-Type" {
					t.Errorf("Access-Control-Allow-Headers %q", got)
				}
			}
		})
	}

	t.Run("off without an origin", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, read.Path, nil)
		r.Header.Set("Origin", docs)
		w := httptest.NewRecorder()
		CORS("", next).ServeHTTP(w, r)
		if w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Error("no origin configured, yet CORS answered")
		}
	})
}
