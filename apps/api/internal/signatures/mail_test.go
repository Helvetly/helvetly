package signatures

import (
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/mail/mailtest"
	"helvetly.com/api/internal/store"
)

func mailRequest(language *string) store.SignatureRequest {
	message := "Please sign by Friday."
	return store.SignatureRequest{WorkspaceID: "wsp_1", WorkspaceName: "Muster AG", Title: "Services Agreement", Message: &message,
		Language: language, Timezone: "Europe/Zurich", ExpiresAt: time.Date(2026, 12, 23, 12, 0, 0, 0, time.UTC),
		CreatedBy: &store.Uploader{Name: "Anna Owner"}, SenderEmail: "anna@muster.ch"}
}

func TestInviteMessage(t *testing.T) {
	signer := store.Signer{Name: "Beat Kunde", Email: "beat@example.com"}
	m := inviteMessage(mailRequest(nil), signer, "https://app.example/sign#T", false, emailtemplate.Template{})
	if m.Subject != "Muster AG asks you to sign “Services Agreement”" {
		t.Errorf("subject %q", m.Subject)
	}
	for _, part := range []string{m.HTML, m.Text} {
		for _, want := range []string{"Hello Beat Kunde,", "Muster AG asks you to review and sign “Services Agreement”.",
			"Sent by", "Anna Owner", "23 December 2026", "Review and sign", "https://app.example/sign#T", "ZertES"} {
			if !strings.Contains(part, want) {
				t.Errorf("%q missing in %s", want, part)
			}
		}
		if strings.Count(part, "Muster AG") != 1 {
			t.Errorf("the business is named more than once: %s", part)
		}
	}
	mailtest.Golden(t, "invite", m)

	reminder := inviteMessage(mailRequest(nil), signer, "https://app.example/sign#T", true, emailtemplate.Template{})
	if reminder.Subject != "Reminder: Muster AG asks you to sign “Services Agreement”" {
		t.Errorf("reminder subject %q", reminder.Subject)
	}
}

func TestInviteMessageInALanguage(t *testing.T) {
	de := "de"
	m := inviteMessage(mailRequest(&de), store.Signer{Email: "beat@example.com"}, "https://app.example/sign#T", true,
		emailtemplate.Default("signature_reminder", "de"))
	if m.Subject != "Erinnerung: Muster AG bittet Sie, «Services Agreement» zu unterschreiben" {
		t.Errorf("subject %q", m.Subject)
	}
	for _, want := range []string{"Gesendet von", "Unterschreiben bis", "23.12.2026", "Prüfen und unterschreiben"} {
		if !strings.Contains(m.HTML, want) || !strings.Contains(m.Text, want) {
			t.Errorf("%q missing in %s\n%s", want, m.HTML, m.Text)
		}
	}
}

// A long company name is cut in the subject and sentence; a request whose member is gone names the business once.
func TestInviteMessageNamesStayShort(t *testing.T) {
	req := mailRequest(nil)
	req.WorkspaceName, req.CreatedBy = strings.Repeat("John Doe", 12), nil
	m := inviteMessage(req, store.Signer{Name: "Beat", Email: "beat@example.com"}, "https://app.example/sign#T", false, emailtemplate.Template{})
	if strings.Contains(m.Subject, strings.Repeat("John Doe", 9)) || !strings.Contains(m.Subject, "…") {
		t.Errorf("subject %q", m.Subject)
	}
	if strings.Contains(m.Text, "Sent by") || strings.Count(m.Text, "Joh…") != 1 {
		t.Errorf("text %s", m.Text)
	}
}

func TestCompletedAndDeclinedMessages(t *testing.T) {
	req, de := mailRequest(nil), "de"
	reason := "Wrong start date"
	declined := declinedMessage(req, store.Signer{Name: "Beat Kunde", Email: "beat@example.com", DeclineReason: &reason})
	if declined.Subject != "Beat Kunde declined to sign “Services Agreement”" || !strings.Contains(declined.HTML, "Declined by") ||
		!strings.Contains(declined.Text, "Reason: Wrong start date") {
		t.Errorf("declined %+v", declined)
	}
	req.OriginalSHA256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
	signed := completed{req: req, name: "Services Agreement (signed).pdf", sum: "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b"}
	done := completedMessage(signed, "beat@example.com", false)

	if !strings.Contains(done.Text, "Sent by: Anna Owner") || done.Members || strings.Contains(done.Text, "Signed SHA-256:") {
		t.Errorf("completed %+v", done)
	}
	own := completedMessage(signed, "anna@example.com", true)
	if !own.Members || !strings.Contains(own.HTML, "3a7bd3e2…42dd4f1b") ||
		!strings.Contains(own.Text, "Original SHA-256: "+shortHash(req.OriginalSHA256)) ||
		!strings.Contains(own.Text, "SHA-256 of the signed PDF: "+groups(signed.sum)) ||
		!strings.Contains(own.Text, "SHA-256 of the original: "+groups(req.OriginalSHA256)) {
		t.Errorf("sender completed %+v", own)
	}
	if shortHash("abc") != "abc" {
		t.Error("a short value stays whole")
	}
	mailtest.Golden(t, "invite-reminder-de", inviteMessage(mailRequest(&de), store.Signer{Email: "beat@example.com"}, "https://app.example/sign#T", true,
		emailtemplate.Default("signature_reminder", "de")))
	mailtest.Golden(t, "completed", done)
}
