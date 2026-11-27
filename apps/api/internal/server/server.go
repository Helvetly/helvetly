// Package server wires HTTP routes: the JSON API under /api and the platform frontend
// for everything else.
package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
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

// Robots applies the index policy before authentication and other guards can write a response.
// Only a separately configured API origin blocks crawling. App and portal robots.txt come from their builds.
func Robots(apiURL string, next http.Handler) http.Handler {
	api, _ := url.Parse(apiURL) // config validates the origin
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		if api != nil && api.Host != "" && strings.EqualFold(r.Host, api.Host) && r.URL.Path == "/robots.txt" &&
			(r.Method == http.MethodGet || r.Method == http.MethodHead) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			_, _ = io.WriteString(w, "User-agent: *\nDisallow: /\n")
			return
		}
		next.ServeHTTP(w, r)
	})
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
