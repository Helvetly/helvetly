package portal

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

const avatarPath = "/api/v1/public/portal/avatar"

func (s *Service) registerAvatar(handle func(string, handler)) {
	handle("GET "+avatarPath, s.getAvatar)
	handle("PUT "+avatarPath, s.putAvatar)
	handle("DELETE "+avatarPath, s.deleteAvatar)
}

func avatarKey(workspaceID, id string) string {
	return "workspaces/" + workspaceID + "/portal-avatars/" + id
}

// avatarURL changes with the bytes, so a new photo is never shown from a cache.
func avatarURL(sum string) string { return avatarPath + "?v=" + sum[:12] }

func (s *Service) getAvatar(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	a, err := s.db.Q.PortalAvatar(r.Context(), sess.ClientID, sess.Email)
	if err != nil {
		return err
	}
	return storage.Serve(w, r, s.files, a.ObjectKey, "avatar", a.ContentType)
}

// putAvatar stores the new photo and points the login at it, then removes the previous object. The same bytes as the
// current photo store nothing new; a photo is never matched against other files, which would reveal what the
// workspace holds.
func (s *Service) putAvatar(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	b, err := uploads.ReadPhoto(w, r)
	if err != nil {
		return err
	}
	ct, err := uploads.CheckPhoto(b)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(b)
	sum := hex.EncodeToString(digest[:])
	ctx, ws := r.Context(), sess.Workspace.ID
	key := avatarKey(ws, auth.NewID("pav"))
	var old string
	stored := false
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockPortalAvatar(ctx, ws, sess.ClientID, sess.Email); err != nil {
			return err
		}
		cur, err := q.PortalAvatar(ctx, sess.ClientID, sess.Email)
		switch {
		case err == nil && cur.SHA256 == sum:
			return nil
		case err == nil:
			old = cur.ObjectKey
		case !errors.Is(err, store.ErrNotFound):
			return err
		}
		stored = true
		if err := s.files.Put(ctx, key, bytes.NewReader(b), int64(len(b)), ct, "avatar"); err != nil {
			return err
		}
		return q.PutPortalAvatar(ctx, ws, sess.ClientID, sess.Email,
			store.PortalAvatar{ObjectKey: key, ContentType: ct, SHA256: sum, Size: int64(len(b)), UpdatedAt: s.now()})
	})
	if err != nil {
		if stored {
			s.removeObject(ctx, key)
		}
		return err
	}
	s.removeObject(ctx, old)
	auth.WriteJSON(w, http.StatusOK, map[string]string{"avatar_url": avatarURL(sum)})
	return nil
}

func (s *Service) deleteAvatar(w http.ResponseWriter, r *http.Request, sess store.PortalSession) error {
	ctx := r.Context()
	var key string
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockPortalAvatar(ctx, sess.Workspace.ID, sess.ClientID, sess.Email); err != nil {
			return err
		}
		var err error
		key, err = q.DeletePortalAvatar(ctx, sess.ClientID, sess.Email)
		return err
	})
	if err != nil {
		return err
	}
	s.removeObject(ctx, key)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// removeObject deletes a photo no login points at any more; a failure only leaves an orphan behind.
func (s *Service) removeObject(ctx context.Context, key string) {
	if key == "" {
		return
	}
	ctx, cancel := uploads.CleanupContext(ctx)
	defer cancel()
	if err := s.files.Delete(ctx, key); err != nil {
		s.log.WarnContext(ctx, "orphaned portal avatar", "key", key, "error", err)
	}
}

// sessionAvatarURL is the login's photo for /session, "" when it has none (as a staff user's avatar_url).
func (s *Service) sessionAvatarURL(ctx context.Context, sess store.PortalSession) (string, error) {
	a, err := s.db.Q.PortalAvatar(ctx, sess.ClientID, sess.Email)
	if errors.Is(err, store.ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return avatarURL(a.SHA256), nil
}
