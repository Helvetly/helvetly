package auth

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestForwardedFor(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("fd00::/8")}
	for _, tc := range []struct {
		name, peer string
		xff        []string
		trusted    []netip.Prefix
		want       string
	}{
		{"no trusted proxies ignores the header", "10.0.0.1:5000", []string{"203.0.113.9"}, nil, "10.0.0.1"},
		{"untrusted peer ignores the header", "198.51.100.7:5000", []string{"203.0.113.9"}, trusted, "198.51.100.7"},
		{"trusted peer gives the client", "10.0.0.1:5000", []string{"203.0.113.9"}, trusted, "203.0.113.9"},
		{"forged left-most hop is skipped", "10.0.0.1:5000", []string{"1.2.3.4, 203.0.113.9"}, trusted, "203.0.113.9"},
		{"proxy chain is walked from the right", "10.0.0.1:5000", []string{"203.0.113.9, 10.1.1.1", "10.2.2.2"}, trusted, "203.0.113.9"},
		{"only proxies keeps the peer", "10.0.0.1:5000", []string{"10.1.1.1"}, trusted, "10.0.0.1"},
		{"malformed hop keeps the peer", "10.0.0.1:5000", []string{"203.0.113.9, junk"}, trusted, "10.0.0.1"},
		{"no header keeps the peer", "10.0.0.1:5000", nil, trusted, "10.0.0.1"},
		{"IPv6 client from an IPv6 proxy", "[fd00::1]:5000", []string{"2001:db8:1:2::5"}, trusted, "2001:db8:1:2::/64"},
		{"mapped IPv4 proxy is trusted", "[::ffff:10.0.0.1]:5000", []string{"203.0.113.9"}, trusted, "203.0.113.9"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var got string
			h := ForwardedFor(tc.trusted, http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = clientIP(r) }))
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = tc.peer
			for _, v := range tc.xff {
				r.Header.Add("X-Forwarded-For", v)
			}
			h.ServeHTTP(httptest.NewRecorder(), r)
			if got != tc.want {
				t.Fatalf("client %q, want %q", got, tc.want)
			}
		})
	}
}
