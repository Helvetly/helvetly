package uploads

import (
	"bytes"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func encode(t *testing.T, format string, w, h int, shade uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = shade
	}
	var buf bytes.Buffer
	var err error
	switch format {
	case "png":
		err = png.Encode(&buf, img)
	case "jpeg":
		err = jpeg.Encode(&buf, img, nil)
	case "gif":
		err = gif.Encode(&buf, img, nil)
	}
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestCheckPhoto(t *testing.T) {
	good := encode(t, "png", 64, 64, 1)
	for _, tc := range []struct {
		name, want string // want: the content type, or a part of the error
		body       []byte
	}{
		{"png", "image/png", good},
		{"jpeg", "image/jpeg", encode(t, "jpeg", 400, 300, 2)},
		{"gif", "PNG or JPEG", encode(t, "gif", 64, 64, 3)},
		{"svg", "PNG or JPEG", []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)},
		{"text named .png", "PNG or JPEG", []byte("hello")},
		{"too small", "at least 32 px", encode(t, "png", 16, 64, 4)},
		{"too large", "at most 2048 px", encode(t, "png", 2049, 40, 5)},
		{"truncated", "cannot be read", good[:len(good)-30]},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ct, err := CheckPhoto(tc.body)
			if err != nil {
				if !strings.Contains(err.Error(), tc.want) {
					t.Fatalf("error %q, want %q", err, tc.want)
				}
				return
			}
			if ct != tc.want {
				t.Fatalf("content type %q, want %q", ct, tc.want)
			}
		})
	}
}
