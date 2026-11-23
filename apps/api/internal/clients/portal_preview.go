package clients

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// previewLinkTTL is how long a preview link stays good unused; the portal takes it once (portal/preview.go).
const previewLinkTTL = 5 * time.Minute

// startPortalPreview makes a one-use link that opens the client's portal read-only as the member
// (POST /clients/{id}/portal-preview, session-only): the portal must be open for the client, as it would be for them.
func (s *Service) startPortalPreview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	c, err := s.db.Q.Client(ctx, sess.Workspace.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	if err := s.db.Q.RequireFeature(ctx, sess.Workspace.ID, store.FeatureClientPortal); err != nil {
		return err
	}
	off, err := s.db.Q.PortalOff(ctx, sess.Workspace.ID)
	switch {
	case err != nil:
		return err
	case off:
		return errPortalClosed
	case !c.PortalEnabled:
		return errPortalOff
	case PortalLogin(c) == "":
		return errNoPortalLogin
	case s.portalURLs == nil:
		return auth.ErrNotFound
	}
	base, err := s.portalURLs.CanonicalURL(ctx, sess.Workspace)
	if err != nil {
		return err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(secret)
	hash := sha256.Sum256([]byte(token))
	now := s.now()
	expires := now.Add(previewLinkTTL)
	if err := s.db.Q.CreatePortalPreviewLink(ctx, hex.EncodeToString(hash[:]), sess.Workspace.ID, c.ID, sess.User.ID, now, expires); err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusCreated, data(map[string]any{
		"url":        base + "api/v1/public/portal/auth/preview?token=" + token,
		"expires_at": expires,
	}))
	return nil
}
