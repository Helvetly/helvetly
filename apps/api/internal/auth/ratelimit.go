package auth

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"
)

// rateLimiter allows `max` hits per key in a sliding `window`.
// shortcut: in-memory per process, move to Postgres/Redis when running more than one instance.
// Second-factor guessing is also capped durably per account (two_factor.go).
type rateLimiter struct {
	mu      sync.Mutex
	max     int
	window  time.Duration
	maxKeys int
	hits    map[string][]time.Time
}

func newRateLimiter(max int, window time.Duration) *rateLimiter {
	return &rateLimiter{max: max, window: window, maxKeys: 100_000, hits: map[string][]time.Time{}}
}

func (l *rateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	recent := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if now.Sub(t) < l.window {
			recent = append(recent, t)
		}
	}
	if len(recent) >= l.max {
		l.hits[key] = recent
		return false
	}
	if _, known := l.hits[key]; !known && len(l.hits) >= l.maxKeys {
		l.evict(now)
	}
	l.hits[key] = append(recent, now)
	return true
}

// evict drops keys with no hit in the window; if all are live, it starts over rather than grow unbounded.
func (l *rateLimiter) evict(now time.Time) {
	for k, ts := range l.hits {
		if len(ts) == 0 || now.Sub(ts[len(ts)-1]) >= l.window {
			delete(l.hits, k)
		}
	}
	if len(l.hits) >= l.maxKeys {
		clear(l.hits)
	}
}

// clientIP: the rate-limit key of the connection's peer, an IPv4 address or an IPv6 /64 (one host's range).
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	if ip = ip.Unmap(); ip.Is6() {
		p, _ := ip.Prefix(64)
		return p.String()
	}
	return ip.String()
}

// ForwardedFor sets r.RemoteAddr to the client a trusted reverse proxy reports: the right-most
// X-Forwarded-For hop that is not itself a trusted proxy (left-most hops are client-supplied and forgeable).
// From any other peer, or with no trusted proxies, the header is ignored.
//
// CF-IPCountry (CountryHeader) is kept only when the hop that handed the client on was Cloudflare's edge (the peer
// itself, or the next hop to the right of the client); from anywhere else the client could have set it, so it goes.
func ForwardedFor(trusted []netip.Prefix, next http.Handler) http.Handler {
	isTrusted := func(ip netip.Addr) bool {
		for _, p := range trusted {
			if p.Contains(ip) {
				return true
			}
		}
		return false
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		peer, perr := netip.ParseAddr(host)
		edge := err == nil && perr == nil && fromCloudflare(peer.Unmap()) // nothing in between: a direct Cloudflare peer
		if len(trusted) > 0 && err == nil && perr == nil && isTrusted(peer.Unmap()) {
			edge = false
			handedOn := peer.Unmap()
			hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
			for i := len(hops) - 1; i >= 0; i-- {
				ip, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
				if err != nil {
					break
				}
				if ip = ip.Unmap(); !isTrusted(ip) {
					r = r.WithContext(r.Context())
					r.RemoteAddr = net.JoinHostPort(ip.String(), "0")
					edge = fromCloudflare(handedOn)
					break
				}
				handedOn = ip
			}
		}
		if !edge && r.Header.Get(CountryHeader) != "" {
			r = r.Clone(r.Context())
			r.Header.Del(CountryHeader)
		}
		next.ServeHTTP(w, r)
	})
}

// RateLimiter is the same sliding-window limit for public routes outside this package.
type RateLimiter struct{ l *rateLimiter }

func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	return &RateLimiter{newRateLimiter(max, window)}
}

// Allow counts a hit from the request's client address; false when it is over the limit.
func (l *RateLimiter) Allow(r *http.Request) bool { return l.l.allow(clientIP(r)) }

// AllowKey counts a hit for key (a person, say) instead of the client address; false when it is over the limit.
func (l *RateLimiter) AllowKey(key string) bool { return l.l.allow(key) }
