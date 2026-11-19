package customdomains

import (
	"net/netip"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"golang.org/x/net/idna"
	"golang.org/x/net/publicsuffix"
)

// Reasons Normalise refuses a hostname, also the API's error codes (domain_<reason>).
const (
	Invalid  = "invalid"  // not a hostname
	Apex     = "apex"     // a registrable domain itself (firma.ch): DNS allows no CNAME there
	Reserved = "reserved" // ours, local or an IP
)

var label = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// localSuffixes never resolve on the public internet.
var localSuffixes = []string{".localhost", ".local", ".internal", ".test", ".example", ".invalid", ".lan", ".home.arpa"}

// Normalise is the hostname a workspace typed, in lowercase punycode (a pasted https://…/ is forgiven), or why it
// cannot be one: Invalid, Apex or Reserved. own are the installation's hosts (the app's, the portal's, the CNAME
// target): they, and every host under their registrable domains (helvetly.com), are Reserved.
func Normalise(raw string, own []string) (string, string) {
	host := strings.TrimSpace(raw)
	if u, err := url.Parse(host); err == nil && u.Host != "" {
		host = u.Host
	}
	host = strings.TrimSuffix(strings.TrimSuffix(host, "/"), ".")
	if host == "" || strings.ContainsAny(host, "/:@ ") && !strings.HasPrefix(host, "[") {
		return "", Invalid
	}
	if _, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		return "", Reserved
	}
	ascii, err := idna.Lookup.ToASCII(host)
	if err != nil {
		return "", Invalid
	}
	ascii = strings.ToLower(ascii)
	if ascii == "localhost" || slices.ContainsFunc(localSuffixes, func(s string) bool { return strings.HasSuffix(ascii, s) }) {
		return "", Reserved
	}
	labels := strings.Split(ascii, ".")
	if len(ascii) > 253 || len(labels) < 2 || slices.ContainsFunc(labels, func(l string) bool { return !label.MatchString(l) }) ||
		strings.Trim(labels[len(labels)-1], "0123456789") == "" {
		return "", Invalid
	}
	for _, o := range append([]string{"helvetly.com"}, own...) {
		o = strings.ToLower(o)
		if o == "" {
			continue
		}
		if root, err := publicsuffix.EffectiveTLDPlusOne(o); err == nil {
			o = root
		}
		if ascii == o || strings.HasSuffix(ascii, "."+o) {
			return "", Reserved
		}
	}
	if root, err := publicsuffix.EffectiveTLDPlusOne(ascii); err != nil || root == ascii {
		return "", Apex
	}
	return ascii, ""
}
