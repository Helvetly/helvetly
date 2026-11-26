package portal

import (
	"context"
	"strings"
	"sync"
	"testing"

	mailer "helvetly.com/api/internal/mail"
)

type fakeMail struct {
	mu   sync.Mutex
	sent []mailer.Message
}

func (f *fakeMail) Send(_ context.Context, m mailer.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, m)
	return nil
}

// TestEmailLinks: the shared portal emails an address the portal address of each supplier where it is a client with
// the portal open, and answers every address alike.
func TestEmailLinks(t *testing.T) {
	for _, tc := range []struct {
		name, email string
		setup       string
		links       []string // the workspaces' addresses the email lists, none = no email
		missing     []string
	}{
		{"client of two workspaces, two clients in one", "Ana@Acme.ch", "", []string{"Studio: /w/studio/", "Other: /w/other/"}, nil},
		{"another workspace's client only", "bob@beta.ch", "", []string{"Studio: /w/studio/"}, []string{"/w/other/"}},
		{"unknown address", "nobody@x.ch", "", nil, nil},
		{"a contact's address", "cleo@acme.ch", "", nil, nil},
		{"a client with the portal off", "ana@acme.ch", `UPDATE clients SET portal_enabled = false WHERE id = 'cli_9'`, []string{"Studio: /w/studio/"}, []string{"/w/other/"}},
		{"a workspace with its portal off", "ana@acme.ch", `UPDATE workspaces SET portal_off = true WHERE id = 'wsp_a'`, []string{"Other: /w/other/"}, []string{"/w/studio/"}},
		{"its own active domain", "ana@acme.ch", `INSERT INTO workspace_domains (id, workspace_id, hostname, status, next_check_at, created_by, created_at, updated_at, status_since) VALUES
			('dom_b', 'wsp_b', 'portal.other.ch', 'active', now(), 'usr', now(), now(), now())`, []string{"Studio: /w/studio/", "Other: http://portal.other.ch/"}, []string{"/w/other/"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := scopedEnv(t)
			if tc.setup != "" {
				e.exec(tc.setup)
			}
			res, out := e.doAt("", "POST", "/auth/links", map[string]string{"email": tc.email}, nil, "")
			if res.StatusCode != 202 || out != nil || scopedCookie(res) != nil {
				t.Fatalf("answer: %d %v", res.StatusCode, out)
			}
			if tc.links == nil {
				if len(e.mail.sent) != 0 {
					t.Fatalf("sent: %+v", e.mail.sent)
				}
				return
			}
			if len(e.mail.sent) != 1 {
				t.Fatalf("sent %d", len(e.mail.sent))
			}
			m := e.mail.sent[0]
			if len(m.To) != 1 || m.To[0] != strings.ToLower(tc.email) || m.Workspace != "" {
				t.Fatalf("message: %+v", m)
			}
			for _, l := range tc.links {
				name, path, _ := strings.Cut(l, ": ")
				if !strings.HasPrefix(path, "http") {
					path = e.srv.URL + path
				}
				if !strings.Contains(m.Text, name+": "+path+"\n") || !strings.Contains(m.HTML, `href="`+path+`"`) {
					t.Fatalf("%q not in %q", l, m.Text)
				}
			}
			for _, l := range tc.missing {
				if strings.Contains(m.Text, e.srv.URL+l) {
					t.Fatalf("%q in %q", l, m.Text)
				}
			}
			if strings.Count(m.Text, ": http") != len(tc.links) {
				t.Fatalf("one line per workspace: %q", m.Text)
			}
			wantButtons := 0
			if len(tc.links) == 1 {
				wantButtons = 1
			}
			if got := strings.Count(m.HTML, "text-decoration:none"); got != wantButtons {
				t.Fatalf("%d primary buttons, want %d", got, wantButtons)
			}
		})
	}
}

func TestEmailLinksRefuses(t *testing.T) {
	e := scopedEnv(t)
	for _, tc := range []struct{ name, prefix, email string }{
		{"not an address", "", "nope"},
		{"under a scope", "/w/studio", "ana@acme.ch"},
	} {
		if res, _ := e.doAt(tc.prefix, "POST", "/auth/links", map[string]string{"email": tc.email}, nil, ""); res.StatusCode == 202 {
			t.Fatalf("%s: %d", tc.name, res.StatusCode)
		}
	}
	if len(e.mail.sent) != 0 {
		t.Fatalf("sent: %+v", e.mail.sent)
	}
}

// TestEmailLinksLimits: an address gets three emails an hour, with the same answer after; a network gets ten requests.
func TestEmailLinksLimits(t *testing.T) {
	e := scopedEnv(t)
	for i := range 10 {
		email := "ana@acme.ch"
		if i >= 5 {
			email = "nobody@x.ch"
		}
		if res, _ := e.doAt("", "POST", "/auth/links", map[string]string{"email": email}, nil, ""); res.StatusCode != 202 {
			t.Fatalf("request %d: %d", i, res.StatusCode)
		}
	}
	if len(e.mail.sent) != 3 {
		t.Fatalf("sent %d, want 3", len(e.mail.sent))
	}
	if res, _ := e.doAt("", "POST", "/auth/links", map[string]string{"email": "bob@beta.ch"}, nil, ""); res.StatusCode != 429 {
		t.Fatalf("eleventh request: %d", res.StatusCode)
	}
}
