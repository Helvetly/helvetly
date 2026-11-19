package customdomains

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"slices"
	"strings"
	"time"
)

// Checker looks at a domain from the outside: its DNS, and whether the origin serves it over HTTPS.
type Checker interface {
	// PointsAt reports whether host leads to target: a CNAME (followed to its end) or the same addresses, for DNS
	// providers that flatten the CNAME.
	PointsAt(ctx context.Context, host, target string) (bool, error)
	// HasTXT reports whether name has a TXT record with value.
	HasTXT(ctx context.Context, name, value string) (bool, error)
	// Serves is nil when https://host/api/health answers 200 with a valid certificate (the origin's Caddy gets it on
	// the first request), else what went wrong.
	Serves(ctx context.Context, host string) error
}

// Resolver is the part of net.Resolver the checker uses.
type Resolver interface {
	LookupCNAME(ctx context.Context, host string) (string, error)
	LookupHost(ctx context.Context, host string) ([]string, error)
	LookupTXT(ctx context.Context, name string) ([]string, error)
}

type netChecker struct {
	dns  Resolver
	http *http.Client
}

// NewChecker asks the system resolver and makes real HTTPS requests.
func NewChecker() Checker {
	return netChecker{dns: net.DefaultResolver, http: &http.Client{Timeout: 15 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, Proxy: nil},
		// A redirect is the origin's answer too: only the first response counts.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// notFound: the name does not exist or has no record of the kind; a check finds "no", not an error.
func notFound(err error) bool {
	var dnsErr *net.DNSError
	return errors.As(err, &dnsErr) && dnsErr.IsNotFound
}

func fqdn(name string) string { return strings.ToLower(strings.TrimSuffix(name, ".")) }

func (c netChecker) PointsAt(ctx context.Context, host, target string) (bool, error) {
	cname, err := c.dns.LookupCNAME(ctx, host)
	switch {
	case notFound(err):
		return false, nil
	case err != nil:
		return false, err
	case fqdn(cname) == fqdn(target):
		return true, nil
	}
	got, err := c.dns.LookupHost(ctx, host)
	if notFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	want, err := c.dns.LookupHost(ctx, target)
	if err != nil {
		return false, err
	}
	return len(got) > 0 && !slices.ContainsFunc(got, func(a string) bool { return !slices.Contains(want, a) }), nil
}

func (c netChecker) HasTXT(ctx context.Context, name, value string) (bool, error) {
	records, err := c.dns.LookupTXT(ctx, name)
	if notFound(err) {
		return false, nil
	}
	return slices.Contains(records, value), err
}

func (c netChecker) Serves(ctx context.Context, host string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://"+host+"/api/health", nil)
	if err != nil {
		return err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("https://%s/api/health answered %d", host, res.StatusCode)
	}
	return nil
}

// Trusting says yes to everything: the end-to-end tests' stand-in, which have no public DNS or certificates.
type Trusting struct{}

func (Trusting) PointsAt(context.Context, string, string) (bool, error) { return true, nil }
func (Trusting) HasTXT(context.Context, string, string) (bool, error)   { return true, nil }
func (Trusting) Serves(context.Context, string) error                   { return nil }
