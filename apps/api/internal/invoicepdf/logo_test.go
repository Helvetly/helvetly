package invoicepdf

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestOnWhite(t *testing.T) {
	encode := func(img image.Image) []byte {
		var b bytes.Buffer
		if err := png.Encode(&b, img); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	}
	// a white band on transparent black: the edge a viewer smears grey
	band := image.NewNRGBA(image.Rect(0, 0, 4, 3))
	band.SetNRGBA(0, 1, color.NRGBA{255, 255, 255, 255})
	band.SetNRGBA(1, 1, color.NRGBA{40, 40, 60, 160})
	opaque := image.NewRGBA(image.Rect(0, 0, 2, 2))
	for i := range opaque.Pix {
		opaque.Pix[i] = 255
	}
	opaqueBytes := encode(opaque)

	tests := []struct {
		name string
		in   []byte
		same bool
		want map[image.Point]color.RGBA
	}{
		{"transparent PNG is flattened onto white", encode(band), false, map[image.Point]color.RGBA{
			{0, 0}: {255, 255, 255, 255}, // transparent black becomes paper
			{0, 1}: {255, 255, 255, 255},
			{1, 1}: {120, 120, 133, 255}, // 160/255 of the colour over white
		}},
		{"opaque PNG is kept", opaqueBytes, true, nil},
		{"JPEG is kept", []byte("\xff\xd8\xff\xe0 not decoded"), true, nil},
		{"broken PNG is kept", []byte("\x89PNG\r\n\x1a\n broken"), true, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := OnWhite(tt.in)
			if tt.same {
				if !bytes.Equal(got, tt.in) {
					t.Fatal("bytes changed")
				}
				return
			}
			img, err := png.Decode(bytes.NewReader(got))
			if err != nil {
				t.Fatal(err)
			}
			if o, ok := img.(interface{ Opaque() bool }); !ok || !o.Opaque() {
				t.Fatal("not opaque")
			}
			for p, want := range tt.want {
				if c := color.RGBAModel.Convert(img.At(p.X, p.Y)); c != want {
					t.Errorf("%v = %v, want %v", p, c, want)
				}
			}
			if err := CheckLogo(got); err != nil {
				t.Fatal(err)
			}
		})
	}
}
