package portal

import (
	"testing"

	"helvetly.com/api/internal/mail/mailtest"
)

// The shared portal's email of an address's portal links: Helvetly's own, every supplier its own link.
func TestLinksEmailGolden(t *testing.T) {
	mailtest.Golden(t, "portal-links", linksEmail("lea@kunde.example", []portalLink{{name: "Dein Deutsch Coach", url: "https://portal.helvetly.example/w/deutsch/", logo: "https://app.helvetly.example/api/v1/public/email-logo/ws/logo"},
		{name: "Muster Treuhand AG", url: "https://kunden.muster.example/"}}))
}
