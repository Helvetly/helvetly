// Package server wires HTTP routes: the JSON API under /api and the platform frontend
// for everything else.
package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

// New routes /api to the API (liveness, and the routes `register` adds) and everything else to the frontend.
func New(frontend http.Handler, register func(*http.ServeMux)) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	register(mux)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "not_found", "message": "Not found."}})
	})
	mux.Handle("/", frontend)
	return mux
}

// Ready is the readiness probe (GET /api/ready): 200 while ping (the database) succeeds, else 503 without the error
// text, so a load balancer stops routing to an instance that can only fail. /api/health stays the liveness probe.
func Ready(ping func(context.Context) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := ping(ctx); err != nil {
			slog.Warn("not ready", "error", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body) // headers are sent; a write error means the client left
}
