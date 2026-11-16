// Package avatars holds a person's own photo (docs/auth-contract.md, "Photo"): uploaded, replaced or removed by the
// person, shown instead of Google's picture to them and to the members of their workspaces.
package avatars

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/storage"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
}

// Storage holds the photos' bytes (internal/storage in production, a fake in tests).
type Storage interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType, filename string) error
	Delete(ctx context.Context, key string) error
	storage.Source // Open, PresignDownload, ProxyDownloads
}

type Service struct {
	db    *store.Store
	auth  Auth
	files Storage
	log   *slog.Logger
	now   func() time.Time
}

func New(db *store.Store, a Auth, files Storage, log *slog.Logger) *Service {
	return &Service{db: db, auth: a, files: files, log: log, now: func() time.Time { return time.Now().UTC() }}
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			if err := h(w, r, sess); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					err = auth.ErrNotFound
				}
				s.auth.WriteError(w, r, err)
			}
		}))
	}
	handle("PUT /api/v1/account/avatar", s.put)
	handle("DELETE /api/v1/account/avatar", s.delete)
	handle("GET "+store.UserAvatarPath+"{id}/avatar", s.get)
}

// key is per upload, so a replaced photo is a new object and the old one can be removed after the commit.
func key(userID string) string { return "users/" + userID + "/avatars/" + auth.NewID("uav") }

// URL is the photo's address as the session and member lists give it (store's avatarColumn): it changes with the
// bytes, so a new photo is never shown from a cache.
func URL(userID, sum string) string { return store.UserAvatarPath + userID + "/avatar?v=" + sum[:12] }

// get serves the photo of the person themself or of a member of the current workspace; anyone else is not found.
func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	p, err := s.db.Q.VisibleUserPhoto(r.Context(), sess.Workspace.ID, sess.User.ID, r.PathValue("id"))
	if err != nil {
		return err
	}
	return storage.Serve(w, r, s.files, "", p.ObjectKey, "avatar", p.ContentType)
}

// put stores the new photo and points the person at it, then removes the previous object. The same bytes as the
// current photo store nothing new; a photo is never matched against other files, which would reveal what others hold.
func (s *Service) put(w http.ResponseWriter, r *http.Request, sess store.Session) error {
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
	ctx, id := r.Context(), sess.User.ID
	k := key(id)
	var old string
	stored := false
	err = s.db.Tx(ctx, func(q store.Q) error {
		cur, err := q.LockUserPhoto(ctx, id) // serializes one person's changes, also across tabs
		switch {
		case err == nil && cur.SHA256 == sum:
			return nil
		case err == nil:
			old = cur.ObjectKey
		case !errors.Is(err, store.ErrNotFound):
			return err
		}
		stored = true
		if err := s.files.Put(ctx, k, bytes.NewReader(b), int64(len(b)), ct, "avatar"); err != nil {
			return err
		}
		return q.SetUserPhoto(ctx, id, store.UserPhoto{ObjectKey: k, ContentType: ct, SHA256: sum, Size: int64(len(b))}, s.now())
	})
	if err != nil {
		if stored {
			s.RemoveObject(ctx, k)
		}
		return err
	}
	s.RemoveObject(ctx, old)
	auth.WriteJSON(w, http.StatusOK, map[string]string{"avatar_url": URL(id, sum)})
	return nil
}

// delete removes the photo; the person is shown with Google's picture again, else their initials. The answer's
// avatar_url is that fallback.
func (s *Service) delete(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	var old string
	err := s.db.Tx(ctx, func(q store.Q) error {
		cur, err := q.LockUserPhoto(ctx, sess.User.ID)
		if err != nil {
			return err
		}
		old = cur.ObjectKey
		return q.SetUserPhoto(ctx, sess.User.ID, store.UserPhoto{}, s.now())
	})
	if err != nil {
		return err
	}
	s.RemoveObject(ctx, old)
	u, err := s.db.Q.User(ctx, sess.User.ID)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]string{"avatar_url": u.AvatarURL})
	return nil
}

// RemoveObject deletes a photo no one points at any more (also auth's OnPhotoRemoved for a closed account); a
// failure only leaves an orphan behind.
func (s *Service) RemoveObject(ctx context.Context, key string) {
	if key == "" {
		return
	}
	ctx, cancel := uploads.CleanupContext(ctx)
	defer cancel()
	if err := s.files.Delete(ctx, key); err != nil {
		s.log.WarnContext(ctx, "orphaned user avatar", "key", key, "error", err)
	}
}
