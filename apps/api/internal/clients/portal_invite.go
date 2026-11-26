package clients

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	mailer "helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// Mailer is what the portal invitation needs of internal/mail.
type Mailer interface {
	Send(ctx context.Context, m mailer.Message) error
}

// PortalURLs is where a workspace's clients sign in (internal/portalscope).
type PortalURLs interface {
	CanonicalURL(ctx context.Context, ws store.Workspace) (string, error)
}

// SetMailer turns portal invitations on; without one, turning the portal on sends nothing.
func (s *Service) SetMailer(m Mailer, urls PortalURLs) { s.mail, s.portalURLs = m, urls }

// PortalLogin is the address a client signs in to the portal with: its email, else its billing email ("" for none).
func PortalLogin(c store.Client) string {
	for _, a := range []*string{c.Email, c.BillingEmail} {
		if a != nil && *a != "" {
			return strings.ToLower(*a)
		}
	}
	return ""
}

// invitePortal mails the client the portal link after the change is saved and records when. A failure is logged,
// never returned.
func (s *Service) invitePortal(ctx context.Context, sess store.Session, c store.Client) {
	if s.mail == nil || PortalLogin(c) == "" {
		return
	}
	if off, err := s.db.Q.PortalOff(ctx, sess.Workspace.ID); err != nil || off {
		return // a workspace with its whole portal off sends no invitations
	}
	if err := s.sendPortalInvite(ctx, sess, c); err != nil {
		s.log.WarnContext(ctx, "portal invitation not sent", "client", c.ID, "error", err)
	}
}

var (
	errPortalOff     = auth.Error(http.StatusConflict, "portal_off", "Turn the client portal on first.", nil)
	errPortalClosed  = auth.Error(http.StatusConflict, "portal_closed", "The client portal is off for the whole workspace. Turn it on in Settings first.", nil)
	errNoPortalLogin = auth.Error(http.StatusConflict, "no_portal_address", "Add an email to let this client sign in.", nil)
	errNoMailer      = auth.Error(http.StatusServiceUnavailable, "mail_unavailable", "Email is not set up, so the invitation cannot be sent.", nil)
	errInviteFailed  = auth.Error(http.StatusBadGateway, "mail_failed", "The invitation could not be sent. Try again in a moment.", nil)
)

// resendPortalInvite sends the portal invitation again on request (POST /clients/{id}/portal-invitation).
func (s *Service) resendPortalInvite(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	c, err := s.db.Q.Client(r.Context(), sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	switch {
	case !c.PortalEnabled:
		return errPortalOff
	}
	off, err := s.db.Q.PortalOff(r.Context(), sess.Workspace.ID)
	switch {
	case err != nil:
		return err
	case off:
		return errPortalClosed
	case PortalLogin(c) == "":
		return errNoPortalLogin
	case s.mail == nil:
		return errNoMailer
	}
	if err := s.sendPortalInvite(r.Context(), sess, c); err != nil {
		s.log.WarnContext(r.Context(), "portal invitation not sent", "client", c.ID, "error", err)
		return errInviteFailed
	}
	return s.get(w, r, sess)
}

// sendPortalInvite mails the invitation to the client's portal address and records when.
func (s *Service) sendPortalInvite(ctx context.Context, sess store.Session, c store.Client) error {
	to := PortalLogin(c)
	link, err := s.portalURLs.CanonicalURL(ctx, sess.Workspace)
	if err != nil {
		return fmt.Errorf("portal address: %w", err)
	}
	if err := s.mail.Send(ctx, portalInvite(sess.Workspace, c, to, link)); err != nil {
		return fmt.Errorf("send portal invitation: %w", err)
	}
	if err := s.db.Q.MarkPortalInvited(ctx, c.ID, s.now()); err != nil {
		return fmt.Errorf("record portal invitation: %w", err)
	}
	return nil
}

// portalInvite is the client's invitation to the workspace's portal at link.
func portalInvite(ws store.Workspace, c store.Client, to, link string) mailer.Message {
	l := mailer.NewLetter("en").Greeting(c.GreetingName()).
		Lead("Use the portal to find your invoices, engagements and shared documents.").
		Action("Open the client portal", link).
		FinePrint("Enter this email address on the portal and we’ll send you a one-time sign-in code.")
	return mailer.Message{Workspace: ws.ID, Language: "en", To: []string{to}, Subject: ws.Name + " invited you to their client portal",
		Text: l.Text(), HTML: mailer.Title("Your client portal at "+ws.Name) + l.HTML()}
}
