package invitations

import (
	"strings"
	"testing"
	"time"
)

var inviteExpiry = time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)

func TestInviteMessageSubject(t *testing.T) {
	m := inviteMessage("b@x.ch", "Ana", "Acme", "admin", "https://h/invite?token=T", inviteExpiry)
	want := "Ana invited you to Acme on Helvetly"
	if m.Subject != want {
		t.Fatalf("subject = %q, want %q", m.Subject, want)
	}
	if len(m.To) != 1 || m.To[0] != "b@x.ch" {
		t.Fatalf("to = %v, want [b@x.ch]", m.To)
	}
}

func TestInviteMessageEscapesHTML(t *testing.T) {
	m := inviteMessage("b@x.ch", "Ana", "<b>&", "member", "https://h/invite?token=T", inviteExpiry)
	if !strings.Contains(m.HTML, "&lt;b&gt;&amp;") {
		t.Fatalf("HTML does not escape the workspace name: %s", m.HTML)
	}
	if !strings.Contains(m.Text, "<b>&") {
		t.Fatalf("Text should keep the workspace name raw: %s", m.Text)
	}
}

func TestInviteMessageLink(t *testing.T) {
	m := inviteMessage("b@x.ch", "Ana", "Acme", "member", "https://h/invite?token=T", inviteExpiry)
	if !strings.Contains(m.HTML, `href="https://h/invite?token=T"`) {
		t.Fatalf("HTML has no accept link: %s", m.HTML)
	}
	if !strings.Contains(m.Text, "https://h/invite?token=T") {
		t.Fatalf("Text has no url: %s", m.Text)
	}
}

func TestInviteMessageExpiry(t *testing.T) {
	m := inviteMessage("b@x.ch", "Ana", "Acme", "member", "https://h/invite?token=T", inviteExpiry)
	if !strings.Contains(m.Text, "13 November 2026") {
		t.Fatalf("Text has no expiry date: %s", m.Text)
	}
	ny, _ := time.LoadLocation("America/New_York")
	if m := inviteMessage("b@x.ch", "Ana", "Acme", "member", "u", time.Date(2026, 11, 13, 3, 0, 0, 0, time.UTC).In(ny)); !strings.Contains(m.Text, "12 November 2026") {
		t.Fatalf("expiry not on the workspace's date: %s", m.Text)
	}
}

func TestInviteMessageRoleWording(t *testing.T) {
	cases := map[string]string{
		"owner":  "as an owner",
		"admin":  "as an admin",
		"member": "as a member",
	}
	for role, want := range cases {
		m := inviteMessage("b@x.ch", "Ana", "Acme", role, "https://h/invite?token=T", inviteExpiry)
		if !strings.Contains(m.Text, want) {
			t.Errorf("role %s: Text %q does not contain %q", role, m.Text, want)
		}
	}
}
