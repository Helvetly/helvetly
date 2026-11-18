package invoicepdf

import (
	"bytes"
	"image"
	"image/draw"
	"image/png"
)

// OnWhite flattens a PNG with transparency onto white, the paper's colour. Viewers scale a logo's colour and its
// soft mask apart, so fully transparent pixels (often black) bleed a grey line along the edges of opaque areas.
// JPEGs, opaque PNGs and anything that does not decode are returned as they are.
func OnWhite(b []byte) []byte {
	if logoType(b) != "PNG" {
		return b
	}
	src, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		return b
	}
	if o, ok := src.(interface{ Opaque() bool }); ok && o.Opaque() {
		return b
	}
	flat := image.NewRGBA(src.Bounds())
	draw.Draw(flat, flat.Bounds(), image.White, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), src, src.Bounds().Min, draw.Over)
	var out bytes.Buffer
	if err := png.Encode(&out, flat); err != nil {
		return b
	}
	return out.Bytes()
}
