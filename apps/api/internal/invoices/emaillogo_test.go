package invoices

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestScaleEmailLogo(t *testing.T) {
	for _, tc := range []struct {
		name               string
		w, h, wantW, wantH int
	}{
		{"square", 400, 400, 36, 36},
		{"wide", 800, 200, 144, 36},
		{"very wide", 4000, 200, 200, 10},
		{"already small", 64, 30, 64, 30},
	} {
		img := image.NewNRGBA(image.Rect(0, 0, tc.w, tc.h))
		for x := range tc.w {
			for y := range tc.h {
				img.Set(x, y, color.NRGBA{R: 200, A: 255})
			}
		}
		var in bytes.Buffer
		if err := png.Encode(&in, img); err != nil {
			t.Fatal(err)
		}
		out, err := scaleEmailLogo(in.Bytes())
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		cfg, err := png.DecodeConfig(bytes.NewReader(out))
		if err != nil || cfg.Width != tc.wantW || cfg.Height != tc.wantH {
			t.Errorf("%s: got %dx%d, %v; want %dx%d", tc.name, cfg.Width, cfg.Height, err, tc.wantW, tc.wantH)
		}
	}
	if _, err := scaleEmailLogo([]byte("nope")); err == nil {
		t.Error("garbage decoded")
	}
}
