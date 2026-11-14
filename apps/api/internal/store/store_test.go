package store

import (
	"testing"
	"time"
)

func TestPoolConfigMaxConns(t *testing.T) {
	for _, tt := range []struct {
		url  string
		want int32
	}{
		{"postgres://u:p@localhost:5433/db?sslmode=disable", defaultMaxConns},
		{"postgres://u:p@localhost:5433/db?sslmode=disable&pool_max_conns=7", 7},
	} {
		cfg, err := poolConfig(tt.url)
		if err != nil {
			t.Fatal(err)
		}
		if cfg.MaxConns != tt.want {
			t.Errorf("%s: MaxConns %d, want %d", tt.url, cfg.MaxConns, tt.want)
		}
	}
	if _, err := poolConfig("postgres://u:p@localhost:5433/db?pool_max_conns=x"); err == nil {
		t.Error("a bad pool_max_conns is accepted")
	}
}

// TestPoolConfigConnectTimeout: an unreachable database host fails startup and redials within defaultConnectTimeout
// instead of the OS TCP timeout (minutes); connect_timeout in the URL still wins.
func TestPoolConfigConnectTimeout(t *testing.T) {
	for _, tt := range []struct {
		url  string
		want time.Duration
	}{
		{"postgres://u:p@localhost:5433/db?sslmode=disable", defaultConnectTimeout},
		{"postgres://u:p@localhost:5433/db?sslmode=disable&connect_timeout=3", 3 * time.Second},
	} {
		cfg, err := poolConfig(tt.url)
		if err != nil {
			t.Fatal(err)
		}
		if cfg.ConnConfig.ConnectTimeout != tt.want {
			t.Errorf("%s: ConnectTimeout %s, want %s", tt.url, cfg.ConnConfig.ConnectTimeout, tt.want)
		}
	}
}
