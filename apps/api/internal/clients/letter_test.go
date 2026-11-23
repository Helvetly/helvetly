package clients

import (
	"testing"

	"helvetly.com/api/internal/mail/mailtest"
	"helvetly.com/api/internal/store"
)

func TestPortalInviteGolden(t *testing.T) {
	c := store.Client{Name: "Kunde AG", IsCompany: true, Contacts: []store.Contact{{Name: "Lea Frei", IsPrimary: true}}}
	mailtest.Golden(t, "portal-invite", portalInvite(store.Workspace{ID: "ws", Name: "Dein Deutsch Coach"}, c, "lea@kunde.example",
		"https://portal.helvetly.example/w/deutsch/"))
}
