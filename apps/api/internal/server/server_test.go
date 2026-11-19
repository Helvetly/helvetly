package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoutes(t *testing.T) {
	frontend := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("frontend")) })
	h := New(frontend, func(mux *http.ServeMux) {
		mux.Handle("GET /api/ready", Ready(func(context.Context) error { return nil }))
	})

	tests := []struct {
		method, path string
		status       int
		body         string
	}{
		{"GET", "/api/health", http.StatusOK, `{"status":"ok"}`},
		{"GET", "/api/ready", http.StatusOK, `{"status":"ok"}`},
		{"POST", "/api/health", http.StatusNotFound, `{"error":{"code":"not_found","message":"Not found."}}`}, // the /api/ catch-all wins over 405
		{"GET", "/api/missing", http.StatusNotFound, `{"error":{"code":"not_found","message":"Not found."}}`},
		{"GET", "/settings/", http.StatusOK, "frontend"},
	}
	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))
			if rec.Code != tt.status {
				t.Fatalf("status = %d, want %d", rec.Code, tt.status)
			}
			if got := strings.TrimSpace(rec.Body.String()); tt.body != "" && got != tt.body {
				t.Fatalf("body = %q, want %q", got, tt.body)
			}
			if got := rec.Header().Get("X-Robots-Tag"); got != "noindex, nofollow" {
				t.Fatalf("X-Robots-Tag = %q, want noindex, nofollow", got)
			}
		})
	}
}

// TestReadyWithoutDatabase: readiness fails while the database is unreachable, so a load balancer stops sending
// traffic; liveness stays up, so the process is not restarted for an outage it cannot fix.
func TestReadyWithoutDatabase(t *testing.T) {
	down := Ready(func(context.Context) error { return errors.New("connection refused") })
	h := New(http.NotFoundHandler(), func(mux *http.ServeMux) { mux.Handle("GET /api/ready", down) })
	for path, want := range map[string]int{"/api/ready": http.StatusServiceUnavailable, "/api/health": http.StatusOK} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != want || strings.Contains(rec.Body.String(), "refused") {
			t.Fatalf("%s: %d %s, want %d without the error text", path, rec.Code, rec.Body.String(), want)
		}
	}
}
