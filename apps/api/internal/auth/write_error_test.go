package auth

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A public route can carry a bearer token in its path (/public/sign/{token}); a 500 must not log it.
func TestWriteErrorLogsTheRoutePatternNotThePath(t *testing.T) {
	var logs bytes.Buffer
	s := &Service{log: slog.New(slog.NewTextHandler(&logs, nil))}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/public/sign/{token}", func(w http.ResponseWriter, r *http.Request) {
		s.WriteError(w, r, errors.New("storage unavailable"))
	})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/public/sign/secret-signing-token", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", rec.Code)
	}
	if strings.Contains(logs.String(), "secret-signing-token") || !strings.Contains(logs.String(), "{token}") {
		t.Fatalf("log: %s", logs.String())
	}
}
