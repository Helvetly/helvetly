package invoices

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg" // logos are PNG or JPEG
	"image/png"
)

const (
	emailLogoHeight   = 36
	emailLogoMaxWidth = 200
)

// scaleEmailLogo shrinks a logo to the size it shows at in a client email, as a PNG. The email's <img> carries no
// height or width (HTML Check counts both as partly supported), so the file itself has to be the right size.
// Box averaging in premultiplied colour keeps edges clean; a logo already small enough is only re-encoded.
func scaleEmailLogo(b []byte) ([]byte, error) {
	src, _, err := image.Decode(bytes.NewReader(b))
	if err != nil {
		return nil, fmt.Errorf("decode logo: %w", err)
	}
	sb := src.Bounds()
	sw, sh := sb.Dx(), sb.Dy()
	dh := emailLogoHeight
	dw := max(1, sw*dh/sh)
	if dw > emailLogoMaxWidth {
		dw, dh = emailLogoMaxWidth, max(1, sh*emailLogoMaxWidth/sw)
	}
	if dh > sh || dw > sw {
		dw, dh = sw, sh
	}
	dst := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	for y := range dh {
		y0, y1 := sb.Min.Y+y*sh/dh, sb.Min.Y+max(y+1, (y+1)*sh/dh)
		for x := range dw {
			x0, x1 := sb.Min.X+x*sw/dw, sb.Min.X+max(x+1, (x+1)*sw/dw)
			var r, g, bl, a, n uint64
			for yy := y0; yy < min(y1, sb.Max.Y); yy++ {
				for xx := x0; xx < min(x1, sb.Max.X); xx++ {
					pr, pg, pb, pa := src.At(xx, yy).RGBA()
					r, g, bl, a, n = r+uint64(pr), g+uint64(pg), bl+uint64(pb), a+uint64(pa), n+1
				}
			}
			if n > 0 {
				dst.Set(x, y, color.RGBA64{uint16(r / n), uint16(g / n), uint16(bl / n), uint16(a / n)})
			}
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, dst); err != nil {
		return nil, fmt.Errorf("encode email logo: %w", err)
	}
	return out.Bytes(), nil
}
