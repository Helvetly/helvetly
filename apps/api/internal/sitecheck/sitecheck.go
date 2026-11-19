// Package sitecheck turns what a person typed as a website into the URL the site really answers on. It is an
// outbound request on a person's behalf, so every connection, redirects included, may reach only public
// addresses on ports 80 and 443.
package sitecheck

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// Error is a reason a site was refused, worded for the person who typed it.
type Error struct{ Message string }

func (e *Error) Error() string { return e.Message }

var (
	errBlocked   = errors.New("not a public address")
	errInvalid   = &Error{"Enter a web address, such as example.ch."}
	errNotPublic = &Error{"This address isn't a public website."}
)

const maxRedirects = 5

// Candidates normalises typed text ("example.ch", "www.example.ch/", "http://example.ch") into the URLs to try,
// https first. Plain http is tried only when the text did not ask for https.
func Candidates(text string) ([]string, error) {
	text = strings.TrimSpace(text)
	explicitHTTPS := len(text) >= 8 && strings.EqualFold(text[:8], "https://")
	if !strings.Contains(text, "://") {
		text = "https://" + text
	}
	u, err := url.Parse(text)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.Opaque != "" ||
		!strings.Contains(u.Hostname(), ".") || strings.ContainsAny(text, " \t") || len(text) > 255 {
		return nil, errInvalid
	}
	u.Host = strings.ToLower(u.Host)
	u.Fragment = ""
	u.Scheme = "https"
	secure := tidy(u)
	if explicitHTTPS {
		return []string{secure}, nil
	}
	u.Scheme = "http"
	return []string{secure, tidy(u)}, nil
}

// tidy drops a bare trailing slash, so "https://example.ch/" is stored as "https://example.ch".
func tidy(u *url.URL) string {
	if u.Path == "/" && u.RawQuery == "" {
		u.Path = ""
	}
	return u.String()
}

// Checker resolves websites. Its zero value is not usable; call New.
type Checker struct{ client *http.Client }

// New returns a Checker that connects only to public addresses on ports 80 and 443.
func New() *Checker { return newChecker(public) }

func newChecker(allowed func(netip.AddrPort) bool) *Checker {
	dialer := &net.Dialer{
		Timeout: 4 * time.Second,
		// Runs on the resolved address of every connection, redirects included, so DNS cannot point it inside.
		Control: func(_, address string, _ syscall.RawConn) error {
			ap, err := netip.ParseAddrPort(address)
			if err != nil || !allowed(ap) {
				return errBlocked
			}
			return nil
		},
	}
	return &Checker{client: &http.Client{
		Timeout: 8 * time.Second,
		Transport: &http.Transport{
			Proxy:                 nil, // a proxy would make the dial check see the proxy, not the site
			DialContext:           dialer.DialContext,
			TLSHandshakeTimeout:   4 * time.Second,
			ResponseHeaderTimeout: 6 * time.Second,
			DisableKeepAlives:     true,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) > maxRedirects {
				return &Error{"This site redirects too many times."}
			}
			if req.URL.Scheme != "https" && req.URL.Scheme != "http" {
				return errNotPublic
			}
			return nil
		},
	}}
}

// public: a globally routed unicast address on port 80 or 443 (no loopback, private, link-local, which covers
// cloud metadata at 169.254.169.254, shared CGNAT space or unspecified).
func public(ap netip.AddrPort) bool {
	if ap.Port() != 80 && ap.Port() != 443 {
		return false
	}
	ip := ap.Addr().Unmap()
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() &&
		!cgnat.Contains(ip) && !nat64.Contains(ip)
}

var (
	cgnat = netip.MustParsePrefix("100.64.0.0/10")
	nat64 = netip.MustParsePrefix("64:ff9b::/96") // embeds an IPv4 address the checks above never see
)

// Resolve returns the final URL the typed website answers on (2xx after at most a few redirects), or an *Error.
func (c *Checker) Resolve(ctx context.Context, text string) (string, error) {
	candidates, err := Candidates(text)
	if err != nil {
		return "", err
	}
	var last error
	for _, candidate := range candidates {
		final, err := c.answer(ctx, candidate)
		if err == nil {
			return final, nil
		}
		var refused *Error
		if errors.As(err, &refused) {
			return "", err // it answered, or must not be asked: plain http would not change that
		}
		last = err
	}
	if errors.Is(last, errBlocked) {
		return "", errNotPublic
	}
	u, _ := url.Parse(candidates[0])
	return "", &Error{fmt.Sprintf("We couldn't reach %s. Check the address and try again.", u.Hostname())}
}

// answer asks with HEAD, then GET when HEAD is refused (some servers only answer GET), reading no body.
func (c *Checker) answer(ctx context.Context, target string) (string, error) {
	var status int
	for _, method := range []string{http.MethodHead, http.MethodGet} {
		req, err := http.NewRequestWithContext(ctx, method, target, nil)
		if err != nil {
			return "", errInvalid
		}
		req.Header.Set("User-Agent", "Helvetly website check")
		resp, err := c.client.Do(req)
		if err != nil {
			var refused *Error
			if errors.As(err, &refused) {
				return "", refused
			}
			return "", err
		}
		_, _ = io.CopyN(io.Discard, resp.Body, 4<<10)
		_ = resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			resp.Request.URL.Fragment = ""
			return tidy(resp.Request.URL), nil
		}
		status = resp.StatusCode
	}
	return "", &Error{fmt.Sprintf("This site answered with an error (%d). Check the address.", status)}
}
