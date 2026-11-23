package signpdf

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
	"time"

	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/pdffont"
	"helvetly.com/api/internal/pdffont/pdffonttest"
)

// samplePDF: an A4 document of n pages, written by fpdf like the invoice PDFs.
func samplePDF(t *testing.T, n int) []byte {
	t.Helper()
	pdf := fpdf.New("P", "mm", "A4", "")
	for i := range n {
		pdf.AddPage()
		pdf.SetFont("Helvetica", "", 14)
		pdf.Text(20, 30, "Contract page "+string(rune('1'+i)))
	}
	var b bytes.Buffer
	if err := pdf.Output(&b); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func samplePNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 300, 100))
	for x := range 300 {
		img.Set(x, 50+x%20, color.NRGBA{A: 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestPageCount(t *testing.T) {
	for _, tc := range []struct {
		name  string
		input []byte
		pages int
		fails bool
	}{
		{"one page", samplePDF(t, 1), 1, false},
		{"three pages", samplePDF(t, 3), 3, false},
		{"not a pdf", []byte("hello"), 0, true},
		{"truncated", samplePDF(t, 2)[:200], 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			n, err := PageCount(tc.input)
			if (err != nil) != tc.fails || n != tc.pages {
				t.Fatalf("PageCount = %d, %v; want %d, fails=%v", n, err, tc.pages, tc.fails)
			}
		})
	}
}

func TestStampAppendsCertificate(t *testing.T) {
	sig := samplePNG(t)
	now := time.Date(2026, 11, 6, 10, 0, 0, 0, time.UTC)
	out, err := Stamp(samplePDF(t, 3), []Field{
		{Page: 1, Kind: "signature", X: 0.1, Y: 0.8, W: 0.3, H: 0.06, Image: sig},
		{Page: 3, Kind: "date", X: 0.6, Y: 0.8, W: 0.2, H: 0.03, Value: "06.11.2026"},
		{Page: 3, Kind: "name", X: 0.6, Y: 0.85, W: 0.2, H: 0.03, Value: "Zoë Müller"},
		{Page: 2, Kind: "signature", X: 0.1, Y: 0.1, W: 0.3, H: 0.06, Image: []byte("not a png")},
	}, Certificate{RequestID: "sig_1", Title: "Consulting – 2026", Sender: "Anna", Workspace: "Acme AG", Zone: time.UTC,
		OriginalSHA256: "ab", AuditHash: "cd", Consent: "I agree.", Created: now, Completed: now,
		Signers: []Signer{{Name: "Zoë", Email: "z@example.com", IP: "127.0.0.1", UserAgent: "Test", Method: "drawn", Viewed: now, Signed: now}}})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := PageCount(out); err != nil || n != 4 {
		t.Fatalf("finished PDF has %d pages (%v), want 3 + the certificate", n, err)
	}
}

func TestFillDrawsLines(t *testing.T) {
	original := samplePDF(t, 1)
	box := Text{Page: 1, X: 0.1, Y: 0.1, W: 0.05, H: 0.02, Value: "A rather long line that has to shrink\nand a second line"}
	filled, err := Fill(original, []Text{box}, "Agreement")
	if err != nil {
		t.Fatal(err)
	}
	empty, err := Fill(original, []Text{{Page: 1, X: 0.1, Y: 0.1, W: 0.5, H: 0.05}}, "Agreement")
	if err != nil {
		t.Fatal(err)
	}
	if pages, err := PageCount(filled); err != nil || pages != 1 || len(filled) <= len(empty) {
		t.Fatalf("filled: %d pages, %v, %d vs %d bytes", pages, err, len(filled), len(empty))
	}
	if _, err := Fill([]byte("not a pdf"), nil, "x"); err == nil {
		t.Fatal("a damaged PDF is an error")
	}
}

func TestAnyScript(t *testing.T) {
	var texts []Text
	for i, s := range pdffonttest.Samples {
		texts = append(texts, Text{Page: 1, X: 0.1, Y: 0.05 + 0.05*float64(i), W: 0.8, H: 0.04, Value: s.Name + ": " + s.Text})
	}
	filled, err := Fill(samplePDF(t, 1), texts, "Vertrag – Zażółć 契約")
	if err != nil {
		t.Fatal(err)
	}
	pdffonttest.Fonts(t, filled)

	now := time.Date(2026, 11, 6, 10, 0, 0, 0, time.UTC)
	stamped, err := Stamp(samplePDF(t, 1), []Field{{Page: 1, Kind: "name", X: 0.1, Y: 0.8, W: 0.4, H: 0.03, Value: pdffonttest.All()}},
		Certificate{RequestID: "sig_1", Title: "Umowa – Zażółć", Sender: "Ștefan", Workspace: "株式会社", Zone: time.UTC,
			Consent: "Zgadzam się.", Created: now, Completed: now,
			Signers: []Signer{{Name: "Łukasz 김민준 محمد", Email: "łukasz@例え.jp", Method: "typed", Viewed: now, Signed: now}}})
	if err != nil {
		t.Fatal(err)
	}
	pdffonttest.Fonts(t, stamped)
}

func TestFitSize(t *testing.T) {
	cases := []struct {
		name         string
		w, h         float64
		lines        int
		widest, want float64
	}{
		{"the box height sets it", 200, 20, 1, 3, 15},
		{"a larger box, larger text", 200, 40, 1, 3, 30},
		{"a smaller box, smaller text", 200, 10, 1, 3, 7.5},
		{"two lines share the height", 200, 40, 2, 3, 15},
		{"a wide value shrinks to the width", 60, 20, 1, 6, 10},
		{"never below the minimum", 8, 20, 1, 6, 4},
		{"an empty value keeps the height's size", 200, 20, 1, 0, 15},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := fitSize(c.w, c.h, c.lines, c.widest); got != c.want {
				t.Fatalf("fitSize(%v, %v, %d, %v) = %v, want %v", c.w, c.h, c.lines, c.widest, got, c.want)
			}
		})
	}
}

// TestDrawLinesPrints: black text, vertically centred, at the field's size (10 pt by default, whatever the box),
// shrunk to the box only with AutoFit and never grown, aligned as the field says.
func TestDrawLinesPrints(t *testing.T) {
	long := "A rather long client name that is much wider than its box"
	cases := []struct {
		name  string
		text  Text
		h     float64
		size  string
		start string
	}{
		{"no size: the default, whatever the box", Text{Value: "Müller AG"}, 40, "10.00 Tf", "BT 100.00 "},
		{"a small box keeps the default", Text{Value: "Müller AG"}, 8, "10.00 Tf", "BT 100.00 "},
		{"the field's own size", Text{Value: "Müller AG", Size: 14}, 40, "14.00 Tf", "BT 100.00 "},
		{"auto-fit never grows", Text{Value: "Müller AG", Size: 12, AutoFit: true}, 40, "12.00 Tf", "BT 100.00 "},
		{"auto-fit shrinks to the height", Text{Value: "Müller AG", Size: 24, AutoFit: true}, 20, "15.00 Tf", "BT 100.00 "},
		{"centred", Text{Value: "Müller AG", Align: "center"}, 20, "10.00 Tf", "BT 2"},
		{"a long value without auto-fit keeps its size", Text{Value: long}, 20, "10.00 Tf", "BT 100.00 "},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			pdf := fpdf.New("P", "pt", "A4", "")
			pdf.SetCompression(false)
			pdf.SetCellMargin(0)
			txt := pdffont.New(pdf)
			pdf.AddPage()
			drawLines(pdf, txt, c.text, 100, 200, 300, c.h)
			var b bytes.Buffer
			if err := pdf.Output(&b); err != nil {
				t.Fatal(err)
			}
			out := b.String()
			if !strings.Contains(out, c.size) {
				t.Fatalf("no %q in the page", c.size)
			}
			if !strings.Contains(out, "0.000 g") {
				t.Fatal("text is not black")
			}
			if !strings.Contains(out, c.start) {
				t.Fatalf("text does not start at %q", c.start)
			}
			if c.text.Align == "center" && strings.Contains(out, "BT 100.00 ") {
				t.Fatal("centred text starts at the box's left edge")
			}
		})
	}
	pdf := fpdf.New("P", "pt", "A4", "")
	txt := pdffont.New(pdf)
	txt.Font("", 1)
	size := fitSize(200, 20, 1, txt.Width(long))
	txt.Font("", size)
	if size >= 15 || txt.Width(long) > 200.001 {
		t.Fatalf("a long value at %v pt is %v wide in a 200 pt box", size, txt.Width(long))
	}
}
