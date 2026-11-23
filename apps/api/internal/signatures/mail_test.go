package signatures

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

var update = flag.Bool("update", false, "rewrite the golden emails in testdata")

func mailRequest(language *string) store.SignatureRequest {
	message := "Please sign by Friday."
	return store.SignatureRequest{WorkspaceID: "wsp_1", WorkspaceName: "Muster AG", Title: "Services Agreement", Message: &message,
		Language: language, Timezone: "Europe/Zurich", ExpiresAt: time.Date(2026, 12, 23, 12, 0, 0, 0, time.UTC),
		CreatedBy: &store.Uploader{Name: "Anna Owner"}, SenderEmail: "anna@muster.ch"}
}

// golden compares got with testdata/<name>, or rewrites it with -update.
func golden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if *update {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Errorf("%s changed (go test -run %s -update to accept):\n%s", name, t.Name(), got)
	}
}

func TestInviteMessage(t *testing.T) {
	signer := store.Signer{Name: "Beat Kunde", Email: "beat@example.com"}
	m := inviteMessage(mailRequest(nil), signer, "https://app.example/sign#T", false, emailtemplate.Template{})
	if m.Subject != "Muster AG asks you to sign “Services Agreement”" {
		t.Errorf("subject %q", m.Subject)
	}
	for _, part := range []string{m.HTML, m.Text} {
		for _, want := range []string{"Hello Beat Kunde,", "Muster AG asks you to review and sign “Services Agreement”.",
			"Sent by", "Anna Owner", "23 December 2026", "Review and sign →", "https://app.example/sign#T", "ZertES"} {
			if !strings.Contains(part, want) {
				t.Errorf("%q missing in %s", want, part)
			}
		}
		if strings.Count(part, "Muster AG") != 1 {
			t.Errorf("the business is named more than once: %s", part)
		}
	}
	brand := mail.Brand{Name: "Muster AG", LogoPath: "/api/v1/public/email-logo/wsp_1/f", Address: []string{"Lerchenstrasse 21", "8000 Zürich"}}
	golden(t, "invite.html.golden", mail.Preview(m, brand, "https://app.example"))
	golden(t, "invite.txt.golden", m.Text)

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
	for _, want := range []string{"Gesendet von", "Unterschreiben bis", "23.12.2026", "Prüfen und unterschreiben →"} {
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
	req := mailRequest(nil)
	reason := "Wrong start date"
	declined := declinedMessage(req, store.Signer{Name: "Beat Kunde", Email: "beat@example.com", DeclineReason: &reason})
	if declined.Subject != "Beat Kunde declined to sign “Services Agreement”" || !strings.Contains(declined.HTML, "Declined by") ||
		!strings.Contains(declined.Text, "Reason: Wrong start date") {
		t.Errorf("declined %+v", declined)
	}
	sum := strings.Repeat("ab", 32)
	done := completedMessage(completed{req: req, name: "Services Agreement (signed).pdf", sum: sum}, "beat@example.com", false)
	if !strings.Contains(done.HTML, "Signed copy") || !strings.Contains(done.Text, "Signed copy: Services Agreement (signed).pdf (attached)") ||
		!strings.Contains(done.Text, "Sent by: Anna Owner") || done.Members || !strings.Contains(done.Text, "SHA-256 of the signed PDF: "+sum) {
		t.Errorf("completed %+v", done)
	}
	// The sender's copy: Helvetly's, the hashes short in the details and in full on a fine line.
	own := completedMessage(completed{req: req, name: "Services Agreement (signed).pdf", sum: sum}, "anna@example.com", true)
	if !own.Members || !strings.Contains(own.HTML, "abababab…abababab") || !strings.Contains(own.Text, "Full SHA-256: signed "+sum) ||
		strings.Contains(own.HTML, "ui-monospace") {
		t.Errorf("sender's completed %+v", own)
	}
	if shortHash("abc") != "abc" {
		t.Error("a short value stays whole")
	}
}
