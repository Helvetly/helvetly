package pdffont

import (
	"bytes"
	"strings"
	"testing"

	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/pdffont/pdffonttest"
)

func TestEverySampleHasGlyphs(t *testing.T) {
	for _, s := range pdffonttest.Samples {
		t.Run(s.Name, func(t *testing.T) {
			fonts := map[string]bool{}
			for _, r := range runs(s.Text) {
				if strings.ContainsAny(r.s, "?�") {
					t.Fatalf("%q drawn as %q", s.Text, r.s)
				}
				for _, c := range r.s {
					if !r.f.glyphs().has(c) {
						t.Fatalf("%U drawn in %s, which has no glyph for it", c, r.f.family)
					}
				}
				fonts[r.f.family] = true
			}
			if !fonts[s.Font] {
				t.Fatalf("%q used %v, want %s", s.Text, fonts, s.Font)
			}
		})
	}
}

func TestRendersEveryScript(t *testing.T) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetCompression(false)
	tx := New(pdf)
	pdf.AddPage()
	for i, s := range pdffonttest.Samples {
		tx.Font(map[bool]string{true: "B"}[i%2 == 0], 11)
		pdf.SetXY(20, 20+float64(i)*8)
		tx.Cell(170, 8, s.Name+": "+s.Text, []string{"L", "C", "R"}[i%3])
	}
	pdf.SetXY(20, 160)
	for _, l := range tx.Wrap("中文没有空格所以按字符换行。"+strings.Repeat("Zażółć gęślą jaźń ", 6), 60) {
		tx.Cell(60, 6, l, "L")
		pdf.SetXY(20, pdf.GetY()+6)
	}
	var b bytes.Buffer
	if err := pdf.Output(&b); err != nil {
		t.Fatal(err)
	}
	pdffonttest.Fonts(t, b.Bytes())
}

func TestUnusedFallbacksAreNotEmbedded(t *testing.T) {
	pdf := fpdf.New("P", "mm", "A4", "")
	tx := New(pdf)
	pdf.AddPage()
	tx.Cell(100, 10, "Zürich, Łódź, Ștefan", "L")
	var b bytes.Buffer
	if err := pdf.Output(&b); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(b.Bytes(), []byte("Noto")) {
		t.Fatal("Latin text embeds a Noto fallback")
	}
}

func TestWrap(t *testing.T) {
	pdf := fpdf.New("P", "mm", "A4", "")
	tx := New(pdf)
	tx.Font("", 10)
	for _, tc := range []struct {
		name, text string
		w          float64
	}{
		{"CJK without spaces", strings.Repeat("发票金额", 20), 40},
		{"mixed scripts at spaces", strings.Repeat("Ελλάδα 日本 Ünal ", 10), 50},
		{"Arabic", strings.Repeat("مرحبا بالعالم ", 10), 40},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lines := tx.Wrap(tc.text, tc.w)
			if len(lines) < 2 {
				t.Fatalf("not wrapped: %q", lines)
			}
			joined := strings.Join(lines, "")
			if strings.ReplaceAll(joined, " ", "") != strings.ReplaceAll(tc.text, " ", "") {
				t.Fatalf("wrapping lost text: %q", lines)
			}
			for _, l := range lines {
				if tx.Width(l) > tc.w-2*pdf.GetCellMargin()+0.01 {
					t.Fatalf("line %q is %.1f wide, more than %.1f", l, tx.Width(l), tc.w)
				}
			}
		})
	}
	if got := tx.Wrap("a\n\nb", 100); len(got) != 3 || got[1] != "" {
		t.Fatalf("line breaks: %q", got)
	}
}

func TestShapeArabic(t *testing.T) {
	for _, tc := range []struct{ name, in, want string }{
		{"initial medial final", "بيت", "ﺑﻴﺖ"},
		{"right-joining letter breaks the word", "دار", "\uFEA9\uFE8D\uFEAD"},
		{"lam-alef ligature", "سلام", "ﺳﻼﻡ"},
		{"isolated lam-alef", "لا", "ﻻ"},
		{"marks are transparent", "بَت", "ﺑَﺖ"},
		{"Latin unchanged", "abc", "abc"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := string(shapeArabic([]rune(tc.in))); got != tc.want {
				t.Fatalf("shapeArabic(%q) = %+q, want %+q", tc.in, got, tc.want)
			}
		})
	}
}

func TestVisual(t *testing.T) {
	for _, tc := range []struct{ name, in, want string }{
		{"Latin", "Rechnung 12", "Rechnung 12"},
		{"Hebrew", "שלום", "םולש"},
		{"Hebrew with a number", "חשבון 2026 מס", "סמ 2026 ןובשח"},
		{"Hebrew inside Latin", "Firma שלום AG", "Firma םולש AG"},
		{"brackets mirror", "א (ב) ג", "ג (ב) א"},
		{"decimal kept", "סה\"כ 1,234.50 ש", "ש 1,234.50 כ\"הס"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := string(visual([]rune(tc.in))); got != tc.want {
				t.Fatalf("visual(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestDevanagariVowelI(t *testing.T) {
	for _, tc := range []struct{ name, in, want string }{
		{"after one consonant", "दुनिया", "दु\u093Fनया"},
		{"after a conjunct", "स्थिति", "\u093Fस्थ\u093Fत"},
		{"none", "नमस्ते", "नमस्ते"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := string(devanagariVowelI([]rune(tc.in))); got != tc.want {
				t.Fatalf("devanagariVowelI(%q) = %+q, want %+q", tc.in, got, tc.want)
			}
		})
	}
}

func TestCharacterWithoutGlyph(t *testing.T) {
	rs := runs("a\U0010FFFDb")
	if len(rs) != 3 || rs[1].s != string(rune(replacement)) || rs[1].f == nil {
		t.Fatalf("runs = %+v", rs)
	}
}

func TestClean(t *testing.T) {
	if got := clean("é‍👍🏽️\tx"); got != "é👍 x" {
		t.Fatalf("clean = %+q", got)
	}
}
