package customdomains

import (
	"context"
	"errors"
	"net"
	"slices"
)

// Checker looks up a domain's ownership TXT record in the public DNS.
type Checker interface {
	// HasTXT reports whether name has a TXT record with value.
	HasTXT(ctx context.Context, name, value string) (bool, error)
}

// Resolver is the part of net.Resolver the checker uses.
type Resolver interface {
	LookupTXT(ctx context.Context, name string) ([]string, error)
}

type netChecker struct{ dns Resolver }

// NewChecker asks the system resolver.
func NewChecker() Checker { return netChecker{dns: net.DefaultResolver} }

// notFound: the name does not exist or has no record of the kind; a check finds "no", not an error.
func notFound(err error) bool {
	var dnsErr *net.DNSError
	return errors.As(err, &dnsErr) && dnsErr.IsNotFound
}

func (c netChecker) HasTXT(ctx context.Context, name, value string) (bool, error) {
	records, err := c.dns.LookupTXT(ctx, name)
	if notFound(err) {
		return false, nil
	}
	return slices.Contains(records, value), err
}

// Trusting finds every record: the end-to-end tests' stand-in, which have no public DNS.
type Trusting struct{}

func (Trusting) HasTXT(context.Context, string, string) (bool, error) { return true, nil }
