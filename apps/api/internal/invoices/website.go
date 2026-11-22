package invoices

import (
	"net/url"
	"strings"
	"unicode/utf8"
)

const websiteMax = 200

// normaliseWebsite accepts an http(s) URL or a bare domain ("firma.ch" becomes "https://firma.ch").
func normaliseWebsite(v string) (string, string) {
	const msg = "Enter a website such as https://firma.ch."
	if !strings.Contains(v, "://") {
		v = "https://" + v
	}
	u, err := url.Parse(v)
	host := ""
	if err == nil {
		host = u.Hostname()
	}
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || !strings.Contains(host, ".") ||
		strings.ContainsAny(v, " <>\"'") || strings.HasPrefix(host, ".") || strings.HasSuffix(host, ".") {
		return "", msg
	}
	if utf8.RuneCountInString(v) > websiteMax {
		return "", "Use at most 200 characters."
	}
	return v, ""
}
