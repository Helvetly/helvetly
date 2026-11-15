package auth

import (
	"net/http"
	"net/netip"

	"helvetly.com/api/internal/config"
)

// CountryHeader is the visitor's country (ISO 3166-1 alpha-2) as Cloudflare sets it. ForwardedFor keeps it only on
// a request that reached the trusted proxies from Cloudflare's edge, so a handler can believe what is left.
const CountryHeader = "CF-IPCountry"

func fromCloudflare(ip netip.Addr) bool {
	for _, p := range config.CloudflareIPs {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// Country is the request's trusted visitor country, upper-case; "" when Cloudflare did not send one (or sent XX,
// unknown, or T1, Tor).
func Country(r *http.Request) string {
	c := r.Header.Get(CountryHeader)
	if len(c) != 2 || c == "XX" || c == "T1" {
		return ""
	}
	return c
}
