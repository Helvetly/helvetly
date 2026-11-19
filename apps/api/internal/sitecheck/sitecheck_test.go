package sitecheck

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"slices"
	"strings"
	"testing"
)

func TestCandidates(t *testing.T) {
	for _, c := range []struct {
		in   string
		want []string
	}{
		{"example.ch", []string{"https://example.ch", "http://example.ch"}},
		{"  www.Example.CH/ ", []string{"https://www.example.ch", "http://www.example.ch"}},
		{"http://example.ch", []string{"https://example.ch", "http://example.ch"}},
		{"https://www.example.ch/", []string{"https://www.example.ch"}},
		{"HTTPS://example.ch/team?x=1#top", []string{"https://example.ch/team?x=1"}},
		{"example.ch/about/", []string{"https://example.ch/about/", "http://example.ch/about/"}},
	} {
		got, err := Candidates(c.in)
		if err != nil || !slices.Equal(got, c.want) {
			t.Errorf("Candidates(%q) = %v, %v; want %v", c.in, got, err, c.want)
		}
	}
	for _, in := range []string{"", "example", "ftp://example.ch", "https://user:pw@example.ch", "exa mple.ch",
		"javascript:alert(1)", "mailto:a@example.ch", "https://" + strings.Repeat("a", 250) + ".ch"} {
		if got, err := Candidates(in); err == nil {
			t.Errorf("Candidates(%q) = %v, want an error", in, got)
		}
	}
}

func TestPublic(t *testing.T) {
	for _, c := range []struct {
		addr string
		want bool
	}{
		{"8.8.8.8:443", true},
		{"8.8.8.8:80", true},
		{"[2001:4860:4860::8888]:443", true},
		{"8.8.8.8:8080", false},
		{"8.8.8.8:22", false},
		{"127.0.0.1:443", false},
		{"10.1.2.3:80", false},
		{"172.16.0.1:443", false},
		{"192.168.1.1:443", false},
		{"169.254.169.254:80", false},
		{"100.64.0.1:443", false},
		{"0.0.0.0:80", false},
		{"[::1]:443", false},
		{"[fd00:ec2::254]:80", false},
		{"[fe80::1]:443", false},
		{"[::ffff:127.0.0.1]:443", false},
		{"[64:ff9b::a9fe:a9fe]:80", false},
		{"224.0.0.1:80", false},
	} {
		if got := public(netip.MustParseAddrPort(c.addr)); got != c.want {
			t.Errorf("public(%s) = %v, want %v", c.addr, got, c.want)
		}
	}
}

// loopbackOnly lets the tests reach their own httptest servers in place of public ones.
func loopbackOnly(ports ...uint16) func(netip.AddrPort) bool {
	return func(ap netip.AddrPort) bool { return ap.Addr().IsLoopback() && slices.Contains(ports, ap.Port()) }
}

func port(t *testing.T, s *httptest.Server) uint16 {
	t.Helper()
	return netip.MustParseAddrPort(strings.TrimPrefix(s.URL, "http://")).Port()
}

func TestResolve(t *testing.T) {
	inside := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer inside.Close()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/", "/home":
			w.WriteHeader(http.StatusOK)
		case "/moved":
			http.Redirect(w, r, "/home", http.StatusMovedPermanently)
		case "/get-only":
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusMethodNotAllowed)
			}
		case "/inside":
			http.Redirect(w, r, inside.URL+"/", http.StatusFound)
		case "/loop":
			http.Redirect(w, r, "/loop", http.StatusFound)
		case "/file":
			http.Redirect(w, r, "file:///etc/passwd", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer site.Close()
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	checker := newChecker(loopbackOnly(port(t, site), port(t, closed)))
	host := strings.TrimPrefix(site.URL, "http://")

	for _, c := range []struct{ in, want, err string }{
		{in: host, want: site.URL},
		{in: site.URL + "/", want: site.URL},
		{in: host + "/moved", want: site.URL + "/home"},
		{in: host + "/get-only", want: site.URL + "/get-only"},
		{in: host + "/missing", err: "answered with an error (404)"},
		{in: host + "/inside", err: "isn't a public website"},
		{in: host + "/loop", err: "redirects too many times"},
		{in: host + "/file", err: "isn't a public website"},
		{in: "https://" + host, err: "couldn't reach 127.0.0.1"}, // https asked for, and not offered: no http fallback
		{in: closed.URL, err: "couldn't reach 127.0.0.1"},
		{in: inside.URL, err: "isn't a public website"},
		{in: "not a site", err: "Enter a web address"},
	} {
		got, err := checker.Resolve(context.Background(), c.in)
		var refused *Error
		switch {
		case c.err == "" && (err != nil || got != c.want):
			t.Errorf("Resolve(%q) = %q, %v; want %q", c.in, got, err, c.want)
		case c.err != "" && (err == nil || !errors.As(err, &refused) || !strings.Contains(err.Error(), c.err)):
			t.Errorf("Resolve(%q) = %q, %v; want an *Error with %q", c.in, got, err, c.err)
		}
	}
}

func TestNewRefusesLoopback(t *testing.T) {
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer site.Close()
	if got, err := New().Resolve(context.Background(), site.URL); err == nil || !strings.Contains(err.Error(), "isn't a public") {
		t.Errorf("Resolve(%s) = %q, %v; want refused", site.URL, got, err)
	}
}
