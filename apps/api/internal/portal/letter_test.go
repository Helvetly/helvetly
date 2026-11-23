package portal

import (
	"testing"

	"helvetly.com/api/internal/mail/mailtest"
)

// The shared portal's email of an address's portal links: Helvetly's own, every supplier its own link.
func TestLinksEmailGolden(t *testing.T) {
	mailtest.Golden(t, "portal-links", linksEmail("lea@kunde.example", [][2]string{{"Dein Deutsch Coach", "https://portal.helvetly.example/w/deutsch/"},
		{"Muster Treuhand AG", "https://kunden.muster.example/"}}))
}
