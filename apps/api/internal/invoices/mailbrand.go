package invoices

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// emailLogoPath is where a client email's header loads the invoice logo: public (mail clients carry no session),
// found only by the logo's random id, which a new logo replaces.
const emailLogoPath = "/api/v1/public/email-logo/"

// MailBrand is the business a workspace's client email comes from (mail.Branded): the seller details of the
// invoice settings, else the workspace's name, the reply address and the owner's email as the last reply address.
func (s *Service) MailBrand(ctx context.Context, workspaceID string) (mail.Brand, error) {
	set, err := loadSettings(ctx, s.db.Q, workspaceID)
	if err != nil {
		return mail.Brand{}, err
	}
	own, err := s.db.WorkspaceReplyTo(ctx, workspaceID)
	if err != nil {
		return mail.Brand{}, err
	}
	sl := set.Seller
	b := mail.Brand{Name: strings.TrimSpace(sl.Name), Phone: deref(sl.Phone), Email: deref(sl.Email), VAT: deref(sl.VATNumber),
		Language: set.Language, ReplyTo: replyAddress(own, set, "")}
	if b.Name == "" {
		if b.Name, err = s.db.WorkspaceName(ctx, workspaceID); err != nil {
			return mail.Brand{}, err
		}
	}
	for _, l := range []string{sl.StreetLine(), strings.TrimSpace(sl.Zip + " " + sl.City)} {
		if l != "" {
			b.Address = append(b.Address, l)
		}
	}
	if set.LogoFileID != nil {
		b.LogoPath = emailLogoPath + workspaceID + "/" + *set.LogoFileID
	}
	members, err := s.db.ListMembers(ctx, workspaceID)
	if err != nil {
		return mail.Brand{}, err
	}
	if len(members) > 0 && members[0].Role == "owner" { // owners come first
		b.Owner = members[0].Email
	}
	return b, nil
}

// replyAddress: where a client's answer goes, the workspace's reply address, else the company email, else member's.
func replyAddress(own *string, set Settings, member string) string {
	if own != nil {
		return *own
	}
	if set.Seller.Email != nil {
		return *set.Seller.Email
	}
	return member
}

// ReplyTo is where a client's answer to the email the signed-in member sends goes, for the send dialogs.
func (s *Service) ReplyTo(ctx context.Context, sess store.Session) (string, error) {
	set, err := loadSettings(ctx, s.db.Q, sess.Workspace.ID)
	if err != nil {
		return "", err
	}
	own, err := s.db.WorkspaceReplyTo(ctx, sess.Workspace.ID)
	return replyAddress(own, set, sess.User.Email), err
}

// getEmailLogo serves the invoice logo to a client email's header while it is the workspace's current one.
func (s *Service) getEmailLogo(w http.ResponseWriter, r *http.Request) {
	workspaceID, id := r.PathValue("workspace"), r.PathValue("id")
	set, err := loadSettings(r.Context(), s.db.Q, workspaceID)
	switch {
	case err != nil && !errors.Is(err, store.ErrNotFound):
	case err != nil || set.LogoFileID == nil || *set.LogoFileID != id:
		err = auth.ErrNotFound
	default:
		err = s.serveEmailLogo(w, r, workspaceID, id)
	}
	if err != nil {
		s.auth.WriteError(w, r, err)
	}
}

// serveEmailLogo answers with the logo at its size in the email (see scaleEmailLogo). The id names one immutable
// upload, so the answer may be cached for good; the unscaled original stays what the platform and PDFs use.
func (s *Service) serveEmailLogo(w http.ResponseWriter, r *http.Request, workspaceID, id string) error {
	b, err := s.files.Get(r.Context(), logoKey(workspaceID, id))
	if err != nil {
		return err
	}
	small, err := scaleEmailLogo(b)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, err = w.Write(small)
	return err
}
