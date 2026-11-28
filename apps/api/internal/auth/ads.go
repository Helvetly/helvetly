package auth

import (
	"crypto/rand"
	_ "embed"
	"net/http"
)

//go:embed ads.html
var adsPage []byte

func adsConsent(r *http.Request) bool {
	c, err := r.Cookie("helvetly_ads")
	return err == nil && c.Value == "yes"
}

// Only the first committed sign-in receives a random, short-lived conversion ID, separate from all account identifiers.
func (s *Service) markAdsSignup(w http.ResponseWriter, r *http.Request, ns newSession) {
	if !ns.createdAccount || ns.token == "" || s.cfg.PublicURL != "https://app.helvetly.com" || r.Host != "app.helvetly.com" || !adsConsent(r) {
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "__Host-helvetly_signup", Value: rand.Text(), Path: "/", MaxAge: 600, Secure: true, SameSite: http.SameSiteLaxMode})
}

// The measurement frame lives on the API host, isolated from the platform's DOM and host-only session.
func (s *Service) adsMeasurement(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	if s.cfg.PublicURL != "https://app.helvetly.com" || r.Host != "api.helvetly.com" || !adsConsent(r) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex")
	// Required Google Ads destinations, scoped to this empty frame (including the Swiss Google domain).
	const beacons = "https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com https://www.google.ch"
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline' https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com; "+
		"img-src "+beacons+"; connect-src "+beacons+" https://ad.doubleclick.net; frame-src https://www.googletagmanager.com; "+
		"frame-ancestors https://helvetly.com https://www.helvetly.com https://app.helvetly.com; base-uri 'none'; form-action 'none'")
	_, _ = w.Write(adsPage)
}
