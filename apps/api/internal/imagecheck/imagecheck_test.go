package imagecheck

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func pngOf(w, h int) []byte {
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewGray(image.Rect(0, 0, w, h)))
	return b.Bytes()
}

func TestCheck(t *testing.T) {
	var j bytes.Buffer
	_ = jpeg.Encode(&j, image.NewGray(image.Rect(0, 0, 80, 80)), nil)
	free, square := Rules{MinSide: 64, MaxSide: 200}, Rules{MinSide: 64, MaxSide: 200, Square: true}
	for _, tt := range []struct {
		name    string
		b       []byte
		r       Rules
		ct      string
		problem string
	}{
		{"png", pngOf(100, 70), free, "image/png", ""},
		{"jpeg", j.Bytes(), square, "image/jpeg", ""},
		{"wide is fine unless square", pngOf(150, 100), free, "image/png", ""},
		{"not square", pngOf(150, 100), square, "", "must be square (this one is 150 × 100)"},
		{"one pixel off", pngOf(100, 101), square, "", "must be square"},
		{"short side", pngOf(100, 63), free, "", "at least 64 px"},
		{"long side", pngOf(201, 100), free, "", "at most 200 px"},
		{"truncated", pngOf(100, 100)[:60], free, "", "cannot be read"},
		{"svg", []byte("<svg xmlns='x'/>"), free, "", "SVG is not supported"},
		{"text", []byte("plain"), free, "", "PNG or JPEG"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ct, problem := Check(tt.b, tt.r)
			if ct != tt.ct || (tt.problem == "") != (problem == "") || !strings.Contains(problem, tt.problem) {
				t.Fatalf("%q, %q", ct, problem)
			}
		})
	}
}
