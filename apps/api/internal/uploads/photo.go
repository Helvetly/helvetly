package uploads

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // Decode of uploaded photos
	_ "image/png"
	"io"
	"net/http"

	"helvetly.com/api/internal/auth"
)

// A person's photo (the portal login's and the staff account's): PNG or JPEG of 32–2048 px a side, at most 1 MB,
// in the multipart field "file".
const (
	MaxPhotoSize   = 1 << 20
	minPhotoSide   = 32
	maxPhotoSide   = 2048
	photoFormField = "file"
)

func invalidPhoto(msg string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", msg, map[string]any{"fields": map[string]string{photoFormField: msg}})
}

// CheckPhoto validates a photo by its bytes, never its name or header: a PNG or JPEG that decodes, of sane size. It
// returns the content type sniffed from the bytes.
func CheckPhoto(b []byte) (string, error) {
	ct := http.DetectContentType(b)
	if ct != "image/png" && ct != "image/jpeg" {
		return "", invalidPhoto("Upload the photo as a PNG or JPEG image.")
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return "", invalidPhoto("This image cannot be read: choose another PNG or JPEG.")
	}
	if min(cfg.Width, cfg.Height) < minPhotoSide || max(cfg.Width, cfg.Height) > maxPhotoSide {
		return "", invalidPhoto(fmt.Sprintf("Use an image of at least %d px and at most %d px on each side (this one is %d × %d).",
			minPhotoSide, maxPhotoSide, cfg.Width, cfg.Height))
	}
	// The header alone can hide a truncated file; the size bound above keeps this decode small.
	if _, _, err := image.Decode(bytes.NewReader(b)); err != nil {
		return "", invalidPhoto("This image cannot be read: choose another PNG or JPEG.")
	}
	return ct, nil
}

// ReadPhoto reads the one photo of a multipart request, refusing more than MaxPhotoSize bytes.
func ReadPhoto(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	tooBig := invalidPhoto("Use an image of at most 1 MB.")
	r.Body = http.MaxBytesReader(w, r.Body, MaxPhotoSize+64<<10)
	if err := r.ParseMultipartForm(MaxPhotoSize + 64<<10); err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return nil, tooBig
		}
		return nil, auth.Error(http.StatusBadRequest, "bad_request", "Send the photo as multipart/form-data in the field file.", nil)
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	headers := r.MultipartForm.File[photoFormField]
	if len(headers) != 1 {
		return nil, invalidPhoto("Choose one image.")
	}
	if headers[0].Size > MaxPhotoSize {
		return nil, tooBig
	}
	f, err := headers[0].Open()
	if err != nil {
		return nil, fmt.Errorf("open photo upload: %w", err)
	}
	defer f.Close()
	b, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("read photo upload: %w", err)
	}
	return b, nil
}
