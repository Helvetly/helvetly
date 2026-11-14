package main

import (
	"fmt"
	"net"
	"net/http"
	"time"
)

// healthcheck asks the server in this container for /api/ready (default) or /api/health and fails unless it answers
// 200. The container image has no shell or curl, so the binary is its own probe (`helvetly healthcheck [health|ready]`).
func healthcheck(addr string, args []string) error {
	path := "/api/ready"
	if len(args) > 0 {
		switch args[0] {
		case "ready":
		case "health":
			path = "/api/health"
		default:
			return fmt.Errorf("usage: helvetly healthcheck [health|ready], got %q", args[0])
		}
	}
	if addr == "" {
		addr = ":3333"
	}
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("healthcheck: HTTP_ADDR %q: %w", addr, err)
	}
	client := http.Client{Timeout: 4 * time.Second}
	res, err := client.Get("http://" + net.JoinHostPort("127.0.0.1", port) + path)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck: %s answered %d", path, res.StatusCode)
	}
	return nil
}
