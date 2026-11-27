package clients

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"

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

type bulkPortalResult struct {
	Updated      int `json:"updated"`
	MissingEmail int `json:"missing_email"`
}

func (s *Service) bulkPortal(ctx context.Context, sess store.Session, ids []string, enable bool) (bulkPortalResult, error) {
	var result bulkPortalResult
	var invitations []store.Client
	err := s.db.Tx(ctx, func(q store.Q) error {
		if enable {
			if err := q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureClientPortal); err != nil {
				return err
			}
			off, err := q.LockPortalOff(ctx, sess.Workspace.ID)
			if err != nil {
				return err
			}
			if off {
				return errPortalClosed
			}
		}
		clients, err := q.LockClientsChangingPortal(ctx, sess.Workspace.ID, ids, enable)
		if err != nil {
			return err
		}
		changed := make([]string, 0, len(clients))
		for _, client := range clients {
			if enable {
				if PortalLogin(client) == "" {
					result.MissingEmail++
					continue
				}
				invitations = append(invitations, client)
			}
			changed = append(changed, client.ID)
		}
		result.Updated = len(changed)
		if len(changed) == 0 {
			return nil
		}
		return q.SetClientsPortal(ctx, sess.Workspace.ID, changed, enable, s.now())
	})
	if err != nil {
		return bulkPortalResult{}, err
	}
	// A committed grant needs its invitation even if the browser disconnects. Bound simultaneous mail deliveries.
	ctx = context.WithoutCancel(ctx)
	var workers sync.WaitGroup
	jobs := make(chan store.Client)
	for range min(4, len(invitations)) {
		workers.Go(func() {
			for c := range jobs {
				s.invitePortal(ctx, sess, c)
				// Its participants with their own access on get theirs: their switch follows the client's.
				c.PortalEnabled = true
				for _, p := range c.Contacts {
					s.inviteParticipant(ctx, sess, c, store.Contact{}, p)
				}
			}
		})
	}
	for _, c := range invitations {
		jobs <- c
	}
	close(jobs)
	workers.Wait()
	return result, nil
}

// invitePortal mails the client the portal link after the change is saved and records when, unless the workspace
// turned these invitations off (Settings → Client emails; a resend by hand still goes). A failure is logged, never
// returned.
func (s *Service) invitePortal(ctx context.Context, sess store.Session, c store.Client) {
	if s.mail == nil || PortalLogin(c) == "" {
		return
	}
	if emails, err := s.db.Q.WorkspaceClientEmails(ctx, sess.Workspace.ID); err != nil || !emails.PortalInvitations {
		if err != nil {
			s.log.WarnContext(ctx, "check portal invitation", "client", c.ID, "error", err)
		}
		return
	}
	// A queued invitation may have been revoked or its recipient changed since commit.
	access, err := s.db.Q.PortalAccessByEmail(ctx, PortalLogin(c), sess.Workspace.ID)
	if err != nil {
		s.log.WarnContext(ctx, "check portal invitation", "client", c.ID, "error", err)
		return
	}
	if !slices.ContainsFunc(access, func(a store.PortalAccess) bool { return a.ClientID == c.ID }) {
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

// inviteParticipant mails a participant the portal link once their access starts (or their address changes) and the
// client's portal and the workspace's are open, unless portal invitations are off. A failure is logged, never returned.
func (s *Service) inviteParticipant(ctx context.Context, sess store.Session, c store.Client, before, after store.Contact) {
	if s.mail == nil || !participantPortal(after) || !c.PortalEnabled || participantPortal(before) && *before.Email == *after.Email {
		return
	}
	// The workspace's switch for portal invitations (Settings → Client emails) covers participants too.
	if emails, err := s.db.Q.WorkspaceClientEmails(ctx, sess.Workspace.ID); err != nil || !emails.PortalInvitations {
		if err != nil {
			s.log.WarnContext(ctx, "check participant invitation", "client", c.ID, "error", err)
		}
		return
	}
	access, err := s.db.Q.PortalAccessByEmail(ctx, *after.Email, sess.Workspace.ID)
	if err != nil {
		s.log.WarnContext(ctx, "check participant invitation", "client", c.ID, "error", err)
		return
	}
	if !slices.ContainsFunc(access, func(a store.PortalAccess) bool { return a.ParticipantID == after.ID }) {
		return
	}
	link, err := s.portalURLs.CanonicalURL(ctx, sess.Workspace)
	if err == nil {
		err = s.mail.Send(context.WithoutCancel(ctx), participantInvite(sess.Workspace, c, after, link))
	}
	if err != nil {
		s.log.WarnContext(ctx, "participant invitation not sent", "client", c.ID, "error", err)
	}
}

// participantWords: the participant's invitation in the client's language.
var participantWords = map[string][5]string{
	"en": {"Use the portal to see your sessions and the documents shared with you.", "Open the portal",
		"Enter this email address on the portal and we’ll send you a one-time sign-in code.", " invited you to their portal", "Your portal at "},
	"de": {"Im Portal sehen Sie Ihre Termine und die Dokumente, die mit Ihnen geteilt wurden.", "Portal öffnen",
		"Geben Sie diese E-Mail-Adresse im Portal ein, und wir senden Ihnen einen einmaligen Anmeldecode.", " hat Sie zu seinem Portal eingeladen", "Ihr Portal bei "},
	"fr": {"Dans le portail, vous voyez vos séances et les documents partagés avec vous.", "Ouvrir le portail",
		"Saisissez cette adresse e-mail sur le portail et nous vous enverrons un code de connexion unique.", " vous a invité sur son portail", "Votre portail chez "},
	"it": {"Nel portale vede le sue sessioni e i documenti condivisi con lei.", "Apri il portale",
		"Inserisca questo indirizzo e-mail nel portale e le invieremo un codice di accesso monouso.", " l’ha invitata al suo portale", "Il suo portale presso "},
}

// participantInvite is a participant's invitation to the workspace's portal at link, from the business (Branded).
func participantInvite(ws store.Workspace, c store.Client, p store.Contact, link string) mailer.Message {
	lang := "en"
	if c.Language != nil && participantWords[*c.Language][0] != "" {
		lang = *c.Language
	}
	w := participantWords[lang]
	l := mailer.NewLetter(lang).Greeting(p.Name).Lead(w[0]).Action(w[1], link).FinePrint(w[2])
	return mailer.Message{Workspace: ws.ID, Language: lang, To: []string{*p.Email}, Subject: ws.Name + w[3],
		Text: l.Text(), HTML: mailer.Title(w[4]+ws.Name) + l.HTML()}
}
