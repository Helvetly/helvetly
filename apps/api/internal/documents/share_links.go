package documents

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

const maxShareSeconds = int64((1<<63 - 1) / time.Second)

func shareExpiry(now time.Time, seconds *int64) (*time.Time, error) {
	if seconds == nil {
		return nil, nil
	}
	if *seconds < 1 || *seconds > maxShareSeconds {
		return nil, validationFailed(map[string]string{"expires_in_seconds": "Enter a valid positive duration."})
	}
	return new(now.Add(time.Duration(*seconds) * time.Second)), nil
}

func (s *Service) registerShareLinks(mux *http.ServeMux, handle func(string, handler)) {
	handle("GET /api/v1/documents/{id}/share-links", s.listShareLinks)
	handle("POST /api/v1/documents/{id}/share-links", s.createShareLink)
	handle("DELETE /api/v1/documents/{id}/share-links", s.deleteShareLink)
	limit := auth.NewRateLimiter(120, time.Minute)
	mux.HandleFunc("POST /api/v1/public/document-share/download", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Robots-Tag", "noindex")
		if !limit.Allow(r) {
			w.Header().Set("Retry-After", "60")
			http.Error(w, "Too many requests. Try again in a minute.", http.StatusTooManyRequests)
			return
		}
		switch err := s.downloadShareLink(w, r); {
		case errors.Is(err, store.ErrNotFound):
			http.Error(w, "This link is invalid, expired, revoked, or already used.", http.StatusNotFound)
		case err != nil:
			s.log.ErrorContext(r.Context(), "document share download failed", "error", err)
			http.Error(w, "The file could not be downloaded. Try again.", http.StatusServiceUnavailable)
		}
	})
}

func (s *Service) listShareLinks(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, ws, id := r.Context(), sess.Workspace.ID, r.PathValue("id")
	if _, err := s.db.Document(ctx, ws, id); err != nil {
		return err
	}
	links, err := s.db.DocumentShareLinks(ctx, ws, id)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(links))
	return nil
}

func (s *Service) createShareLink(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		SingleUse        bool   `json:"single_use"`
		ExpiresInSeconds *int64 `json:"expires_in_seconds"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	now := s.now()
	expiry, err := shareExpiry(now, body.ExpiresInSeconds)
	if err != nil {
		return err
	}
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(secret[:])
	hash := sha256.Sum256(secret[:])
	link := store.DocumentShareLink{ID: auth.NewID("dsl"), CreatedAt: now, ExpiresAt: expiry, SingleUse: body.SingleUse}
	ctx, ws, id := r.Context(), sess.Workspace.ID, r.PathValue("id")
	if err := s.db.CreateDocumentShareLink(ctx, ws, id, link, hash[:]); err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "private, no-store")
	auth.WriteJSON(w, http.StatusCreated, data(struct {
		store.DocumentShareLink
		Token string `json:"token"`
	}{DocumentShareLink: link, Token: token}))
	return nil
}

func (s *Service) deleteShareLink(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if err := s.db.DeleteDocumentShareLink(r.Context(), sess.Workspace.ID, r.PathValue("id"), r.URL.Query().Get("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Service) downloadShareLink(w http.ResponseWriter, r *http.Request) error {
	r.Body = http.MaxBytesReader(w, r.Body, 256)
	if err := r.ParseForm(); err != nil {
		return store.ErrNotFound
	}
	token := r.PostForm.Get("token")
	secret, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(secret) != 32 {
		return store.ErrNotFound
	}
	ctx := r.Context()
	hash := sha256.Sum256(secret)
	d, err := s.db.DocumentShareDownload(ctx, hash[:], s.now())
	if err != nil {
		return err
	}
	file, err := s.files.Open(ctx, d.ObjectKey)
	if err != nil {
		return err
	}
	defer file.Close()
	if err := s.db.ClaimDocumentShareDownload(ctx, hash[:], s.now(), d.ObjectKey); err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(d.Size, 10))
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": d.Name}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if _, err := io.Copy(w, file); err != nil {
		s.log.WarnContext(ctx, "document share stream interrupted", "error", err)
	}
	return nil
}
