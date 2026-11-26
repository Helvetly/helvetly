package portal

import (
	"context"
	"fmt"
	"html"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	mailer "helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// Mailer sends the portal-links email (internal/mail). It is no business email: no workspace is charged for it.
type Mailer interface {
	Send(ctx context.Context, m mailer.Message) error
}

// SetMailer turns the portal-links email on; without one the shared portal's form answers as usual and sends nothing.
func (s *Service) SetMailer(m Mailer) { s.mail = m }

// SetEmailLogos uses the platform’s public email images for the workspace picker.
func (s *Service) SetEmailLogos(platformURL string, logo func(context.Context, string) (string, error)) {
	s.platformURL = strings.TrimRight(platformURL, "/")
	s.emailLogo = logo
}

type portalLink struct{ name, url, logo, workspace string }

// emailLinks is the shared portal's only way in: it emails an address the portal address of every supplier where it
// is a client with an open portal. The answer is the same for every address, known or not, and the email goes out
// after it, so neither the answer nor its timing tells whether the address is anyone's client.
func (s *Service) emailLinks(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	if !s.auth.Decode(w, r, &in) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if a, err := mail.ParseAddress(email); err != nil || a.Address != email {
		s.fail(w, r, auth.Error(http.StatusBadRequest, "invalid_email", "Enter a valid email address.", nil))
		return
	}
	if scopeWorkspace(r) != "" {
		s.fail(w, r, auth.ErrNotFound)
		return
	}
	if !s.linksByIP.Allow(r) {
		s.fail(w, r, errTooMany)
		return
	}
	// Over the address's own limit nothing is sent, with the same answer: the limit says nothing about the address.
	if s.linksByEmail.AllowKey(email) && s.mail != nil {
		ctx := context.WithoutCancel(r.Context())
		s.async(func() {
			if err := s.sendLinks(ctx, r, email); err != nil {
				s.log.WarnContext(ctx, "portal links email not sent", "error", err)
			}
		})
	}
	w.WriteHeader(http.StatusAccepted)
}

// sendLinks mails email its suppliers' portal addresses; an address that is nobody's client gets nothing.
func (s *Service) sendLinks(ctx context.Context, r *http.Request, email string) error {
	access, err := s.access(r.WithContext(ctx), email)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	var portals []portalLink
	for _, a := range access {
		if seen[a.WorkspaceID] {
			continue
		}
		seen[a.WorkspaceID] = true
		link, err := s.scopes.CanonicalURL(ctx, store.Workspace{ID: a.WorkspaceID, Name: a.WorkspaceName})
		if err != nil {
			return fmt.Errorf("portal address: %w", err)
		}
		portals = append(portals, portalLink{name: a.WorkspaceName, url: link, workspace: a.WorkspaceID})
	}
	if len(portals) > 1 && s.emailLogo != nil {
		for i, a := range portals {
			path, err := s.emailLogo(ctx, a.workspace)
			if err != nil {
				s.log.WarnContext(ctx, "read portal email logo", "workspace", a.workspace, "error", err)
			}
			if path != "" {
				portals[i].logo = s.platformURL + path
			}
		}
	}
	if len(portals) == 0 {
		return nil
	}
	return s.mail.Send(ctx, linksEmail(email, portals))
}

// linksEmail gives one portal a button and several portals a workspace picker.
func linksEmail(to string, portals []portalLink) mailer.Message {
	l := mailer.NewLetter("en")
	alert := "If you didn’t request these links, you can ignore this email."
	title := "Choose a client portal"
	if len(portals) == 1 {
		title = "Open your client portal"
		l.Lead("Enter this email address when you open the portal and we’ll send you a one-time sign-in code.").
			Action(portals[0].name, portals[0].url)
	} else {
		l.Lead("Choose the business you want to visit, then enter this email address on its sign-in page to receive a one-time code.")
	}
	body, text := l.HTML(), l.Text()
	if len(portals) > 1 {
		var rows, links strings.Builder
		for _, p := range portals {
			rows.WriteString(portalCard(p))
			fmt.Fprintf(&links, "%s: %s\n", p.name, p.url)
		}
		body += rows.String()
		text += "\n" + links.String()
	}
	warning := mailer.NewLetter("en").Alert("Unexpected email?", alert)
	return mailer.Message{To: []string{to}, Subject: "Your client portal links",
		Text: text + "\n" + warning.Text(), HTML: mailer.Title(title) + body + warning.HTML()}
}

// portalCard uses the workspace’s image or a letter tile. The name is the accessible link even if images are blocked.
func portalCard(p portalLink) string {
	escape := html.EscapeString
	initial, _ := utf8.DecodeRuneInString(strings.TrimSpace(p.name))
	mark := `<span style="display:inline-block;width:32px;line-height:32px;background-color:#ccfbf1">` +
		escape(string(unicode.ToUpper(initial))) + "</span>"
	if p.logo != "" {
		mark = `<img src="` + escape(p.logo) + `" alt="" height="32" style="height:32px;max-width:40px;object-fit:contain;vertical-align:middle;border:0">`
	}
	host := ""
	if u, err := url.Parse(p.url); err == nil && u.Hostname() != "" {
		host = `<br><span style="font-size:12px;font-weight:400;color:#71717a">` + escape(u.Hostname()) + `</span>`
	}
	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#fafafa" style="width:100%;margin:0 0 8px;border:1px solid #e7e7ea;background-color:#fafafa"><tr>` +
		`<td width="56" align="center" valign="middle" style="padding:10px 4px;color:#115e59;font-size:16px;font-weight:700"><span aria-hidden="true">` + mark + `</span></td>` +
		`<td valign="middle" style="padding:10px 12px 10px 0;line-height:19px"><a style="color:#0f766e;font-weight:600" href="` + escape(p.url) + `">` +
		escape(p.name) + ` <span aria-hidden="true">→</span></a>` + host + "</td></tr></table>\n"
}
