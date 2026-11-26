package storage

import (
	"context"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/minio/minio-go/v7"
)

// DownloadTTL: how long a presigned download link works.
const DownloadTTL = 5 * time.Minute

// Source is what Serve needs from the bucket: *S3, or a fake in tests.
type Source interface {
	Open(ctx context.Context, key string) (io.ReadSeekCloser, error)
	PresignDownload(ctx context.Context, key string, ttl time.Duration, filename string) (string, error)
	ProxyDownloads() bool
}

// mediaLinker: a Source that can sign MEDIA_URL links (*S3 with UseMedia); "" when it has no media origin.
type mediaLinker interface {
	MediaLink(ctx context.Context, workspaceID, key, filename, contentType string) (string, error)
}

// Serve answers a download of workspaceID's object at key ("" for a file of no workspace, such as a personal avatar),
// saved as filename, once the caller has checked access: a 302 to a signed MEDIA_URL link, else to a presigned URL
// or, with S3_PROXY_DOWNLOADS, the bytes through the API (range and conditional requests included) for a bucket the
// browser cannot reach. contentType "" falls back to the object's own, then to sniffing.
func Serve(w http.ResponseWriter, r *http.Request, src Source, workspaceID, key, filename, contentType string) error {
	w.Header().Set("Cache-Control", "private, no-store")
	if m, ok := src.(mediaLinker); ok {
		link, err := m.MediaLink(r.Context(), workspaceID, key, filename, contentType)
		if err != nil {
			return err
		}
		if link != "" {
			http.Redirect(w, r, link, http.StatusFound)
			return nil
		}
	}
	if !src.ProxyDownloads() {
		link, err := src.PresignDownload(r.Context(), key, DownloadTTL, filename)
		if err != nil {
			return err
		}
		http.Redirect(w, r, link, http.StatusFound)
		return nil
	}
	return ServeDirect(w, r, src, key, filename, contentType)
}

// ServeDirect answers an attachment without granting a separate storage URL.
func ServeDirect(w http.ResponseWriter, r *http.Request, src Source, key, filename, contentType string) error {
	w.Header().Set("Cache-Control", "private, no-store")
	obj, err := src.Open(r.Context(), key)
	if err != nil {
		return err
	}
	defer obj.Close()
	stream(w, r, obj, filename, contentType)
	return nil
}

// stream sends an opened object as an attachment, with range and conditional requests.
func stream(w http.ResponseWriter, r *http.Request, obj io.ReadSeeker, filename, contentType string) {
	h := w.Header()
	var modified time.Time
	if o, ok := obj.(*minio.Object); ok {
		if info, err := o.Stat(); err == nil { // already fetched by Open
			modified = info.LastModified
			if info.ETag != "" {
				h.Set("ETag", `"`+info.ETag+`"`)
			}
			if contentType == "" {
				contentType = info.ContentType
			}
		}
	}
	if contentType != "" {
		h.Set("Content-Type", contentType)
	}
	// The same headers a presigned download gets, plus: never rendered as a page on the API's origin.
	h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	http.ServeContent(w, r, "", modified, obj)
}
