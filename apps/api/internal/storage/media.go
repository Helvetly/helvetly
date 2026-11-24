package storage

import (
	"context"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

// Media signs download links for another origin (MEDIA_URL) and serves them at GET /api/media/{token}: the browser
// gets the bytes from a host that holds no session, without the bucket being reachable or presigned.
type Media struct {
	origin string
	key    []byte
	now    func() time.Time
}

// NewMedia keys the links with a key derived from SECRET_KEY for this purpose only.
func NewMedia(origin string, secret []byte) (*Media, error) {
	if len(secret) < 32 {
		return nil, errors.New("storage: SECRET_KEY must be at least 32 bytes")
	}
	key, err := hkdf.Key(sha256.New, secret, nil, "helvetly media links", 32)
	if err != nil {
		return nil, err
	}
	return &Media{origin: origin, key: key, now: time.Now}, nil
}

// mediaClaims: what a link may download (the version recorded when it was signed) and how, until Expires (Unix s).
type mediaClaims struct {
	Workspace   string `json:"w,omitempty"`
	Key         string `json:"k"`
	Version     string `json:"v,omitempty"`
	Filename    string `json:"n"`
	ContentType string `json:"t,omitempty"`
	Expires     int64  `json:"e"`
}

func (m *Media) mac(payload string) []byte {
	h := hmac.New(sha256.New, m.key)
	h.Write([]byte(payload))
	return h.Sum(nil)
}

// link: MEDIA_URL/api/media/<base64url(JSON)>.<base64url(HMAC-SHA256)>, valid for DownloadTTL.
func (m *Media) link(workspaceID, key, version, filename, contentType string) string {
	b, _ := json.Marshal(mediaClaims{Workspace: workspaceID, Key: key, Version: version, Filename: filename, ContentType: contentType,
		Expires: m.now().Add(DownloadTTL).Unix()}) // strings and an int: cannot fail
	payload := base64.RawURLEncoding.EncodeToString(b)
	return m.origin + "/api/media/" + payload + "." + base64.RawURLEncoding.EncodeToString(m.mac(payload))
}

func (m *Media) verify(token string) (mediaClaims, bool) {
	payload, sig, ok := strings.Cut(token, ".")
	if !ok {
		return mediaClaims{}, false
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, m.mac(payload)) {
		return mediaClaims{}, false
	}
	b, err := base64.RawURLEncoding.DecodeString(payload)
	var c mediaClaims
	if err != nil || json.Unmarshal(b, &c) != nil || c.Key == "" || m.now().Unix() >= c.Expires {
		return mediaClaims{}, false
	}
	return c, true
}

// VersionOpener is what the media handler needs from the bucket (*S3).
type VersionOpener interface {
	OpenVersion(ctx context.Context, key, version string) (io.ReadSeekCloser, error)
}

// Handler serves GET (and HEAD) /api/media/{token}: no session, the signature is the permission. Any bad, tampered
// or expired token, and a missing object, is a bare 404.
func (m *Media) Handler(src VersionOpener) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		c, ok := m.verify(r.PathValue("token"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		obj, err := src.OpenVersion(r.Context(), c.Key, c.Version)
		if errors.Is(err, store.ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		if err != nil {
			slog.ErrorContext(r.Context(), "media download", "err", err)
			http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			return
		}
		defer obj.Close()
		stream(w, r, obj, c.Filename, c.ContentType)
	})
}
