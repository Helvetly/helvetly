package auth

import (
	"context"
	"net/http/httptest"
	"testing"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/mail/mailtest"
)

func TestSignInCodeEmails(t *testing.T) {
	mailtest.Golden(t, "sign-in-code", signInCodeMessage("ana@acme.ch", "600639"))
	mailtest.Golden(t, "portal-sign-in-code", portalCodeMessage("client@kunde.ch", "600639", "wsp_1", mailtest.Brand))
}

// A code for a workspace's portal comes from that business and is never counted against its email allowance.
func TestPortalCodeIsTheBusinessesAndUncounted(t *testing.T) {
	e := newEnv(t)
	e.svc.PortalBrand = func(_ context.Context, workspaceID string) (mail.Brand, error) {
		return mail.Brand{Name: "Muster GmbH", Language: "fr"}, nil
	}
	r := httptest.NewRequest("POST", "/", nil)
	if err := e.svc.SendEmailCode(r, "client@kunde.ch", "wsp_1", true); err != nil {
		t.Fatal(err)
	}
	code := e.devCode("client@kunde.ch")
	got := e.mail.sent[len(e.mail.sent)-1]
	if got.Workspace != "wsp_1" || !got.Uncounted || got.Language != "fr" || got.Subject != code+" est votre code de connexion au portail client de Muster GmbH" {
		t.Fatalf("portal code: %+v", got)
	}
}
