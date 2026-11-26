package portal

import (
	"context"
	"fmt"
	"net/http"
	"net/mail"
	"strings"

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
	var portals [][2]string
	for _, a := range access {
		if seen[a.WorkspaceID] {
			continue
		}
		seen[a.WorkspaceID] = true
		link, err := s.scopes.CanonicalURL(ctx, store.Workspace{ID: a.WorkspaceID, Name: a.WorkspaceName})
		if err != nil {
			return fmt.Errorf("portal address: %w", err)
		}
		portals = append(portals, [2]string{a.WorkspaceName, link})
	}
	if len(portals) == 0 {
		return nil
	}
	return s.mail.Send(ctx, linksEmail(email, portals))
}

// linksEmail gives one portal a button and several portals a list of links.
func linksEmail(to string, portals [][2]string) mailer.Message {
	l := mailer.NewLetter("en")
	title := "Choose a client portal"
	if len(portals) == 1 {
		p := portals[0]
		title = "Open your client portal"
		l.Lead("Enter this email address when you open the portal and we’ll send you a one-time sign-in code.").
			Action(p[0], p[1])
	} else {
		l.Lead("Enter this email address on the portal’s sign-in page to receive a one-time code.")
		links := make([]mailer.Link, 0, len(portals))
		for _, p := range portals {
			links = append(links, mailer.Link{Label: p[0], URL: p[1]})
		}
		l.Section("Your portals", "", "", links...)
	}
	l.FinePrint("If you didn’t request these links, you can ignore this email.")
	return mailer.Message{To: []string{to}, Subject: "Your client portal links", Text: l.Text(), HTML: mailer.Title(title) + l.HTML()}
}
