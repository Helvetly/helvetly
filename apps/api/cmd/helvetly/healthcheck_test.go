package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthcheck(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusServiceUnavailable) // /api/ready: the database is down
	}))
	defer srv.Close()
	_, port, _ := net.SplitHostPort(srv.Listener.Addr().String())
	addr := ":" + port

	tests := []struct {
		name    string
		addr    string
		args    []string
		wantErr bool
	}{
		{"ready is the default and fails when not ready", addr, nil, true},
		{"ready by name", addr, []string{"ready"}, true},
		{"health answers 200", addr, []string{"health"}, false},
		{"host part of HTTP_ADDR is ignored", "0.0.0.0:" + port, []string{"health"}, false},
		{"unknown probe", addr, []string{"metrics"}, true},
		{"bad HTTP_ADDR", "3333", []string{"health"}, true},
		{"nothing listening", ":1", []string{"health"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := healthcheck(tt.addr, tt.args); (err != nil) != tt.wantErr {
				t.Fatalf("healthcheck(%q, %v) error = %v, wantErr %v", tt.addr, tt.args, err, tt.wantErr)
			}
		})
	}
}
