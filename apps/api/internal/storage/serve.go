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

// Serve answers a download of the object at key, saved as filename, once the caller has checked access: a 302 to a
// presigned URL or, with S3_PROXY_DOWNLOADS, the bytes through the API (range and conditional requests included) for
// a bucket the browser cannot reach. contentType "" falls back to the object's own, then to sniffing.
func Serve(w http.ResponseWriter, r *http.Request, src Source, key, filename, contentType string) error {
	h := w.Header()
	h.Set("Cache-Control", "private, no-store")
	if !src.ProxyDownloads() {
		link, err := src.PresignDownload(r.Context(), key, DownloadTTL, filename)
		if err != nil {
			return err
		}
		http.Redirect(w, r, link, http.StatusFound)
		return nil
	}
	obj, err := src.Open(r.Context(), key)
	if err != nil {
		return err
	}
	defer obj.Close()
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
	return nil
}
