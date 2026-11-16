// Package imagecheck validates an uploaded logo by its bytes, never its name or declared type.
package imagecheck

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg" // DecodeConfig of uploaded logos
	_ "image/png"
	"net/http"
	"strings"
)

// Rules are the size limits of one kind of logo; Square demands width == height.
type Rules struct {
	MinSide, MaxSide int
	Square           bool
}

// Check returns the content type to store (image/png or image/jpeg), or the message to show the person when the
// bytes are not an acceptable logo: PNG or JPEG only, a short side of at least MinSide, a long side of at most
// MaxSide, decodable to the end (the header alone can hide a truncated file).
func Check(b []byte, r Rules) (contentType, problem string) {
	ct := http.DetectContentType(b)
	switch {
	case ct == "image/webp":
		return "", "WebP is not supported: upload the logo as PNG or JPEG."
	case strings.Contains(ct, "xml") || bytes.Contains(b[:min(len(b), 1024)], []byte("<svg")):
		return "", "SVG is not supported: upload the logo as PNG or JPEG."
	case ct != "image/png" && ct != "image/jpeg":
		return "", "Upload the logo as a PNG or JPEG image."
	}
	unreadable := "This image cannot be read: upload another PNG or JPEG."
	cfg, _, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return "", unreadable
	}
	inBounds := min(cfg.Width, cfg.Height) >= r.MinSide && max(cfg.Width, cfg.Height) <= r.MaxSide
	if inBounds {
		if _, _, err := image.Decode(bytes.NewReader(b)); err != nil {
			return "", unreadable
		}
	} else {
		return "", fmt.Sprintf("Use an image of at least %d px on its short side and at most %d px on its long side (this one is %d × %d).",
			r.MinSide, r.MaxSide, cfg.Width, cfg.Height)
	}
	if r.Square && cfg.Width != cfg.Height {
		return "", fmt.Sprintf("The workspace logo must be square (this one is %d × %d).", cfg.Width, cfg.Height)
	}
	return ct, ""
}
