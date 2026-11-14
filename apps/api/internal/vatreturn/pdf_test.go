package vatreturn

import (
	"bytes"
	"testing"
	"unicode/utf16"

	"helvetly.com/api/internal/pdffont/pdffonttest"
	"helvetly.com/api/internal/vatcalc"
)

// utf16be: text as fpdf writes it into a content stream in a UTF-8 font (no characters it escapes).
func utf16be(s string) []byte {
	var b []byte
	for _, u := range utf16.Encode([]rune(s)) {
		b = append(b, byte(u>>8), byte(u))
	}
	return b
}

func TestPDFAnyScript(t *testing.T) {
	rep := Report{Period: "2026-Q3", From: "2026-07-01", To: "2026-09-30", Method: "effective", Basis: "agreed",
		Lines:    []vatcalc.Line{{Ziffer: "200", LabelDE: "Total der vereinbarten Entgelte", Tracked: true}},
		Warnings: []vatcalc.Warning{{Message: pdffonttest.All()}}}
	out, err := renderPDF(rep, "Zażółć Ştiinţă 株式会社", "2026-11-10")
	if err != nil {
		t.Fatal(err)
	}
	pdffonttest.Fonts(t, out)
	if !bytes.Contains(out, utf16be("MWST-Abrechnung 2026-Q3")) || !bytes.Contains(out, utf16be("Zażółć Ştiinţă ")) {
		t.Fatal("title or workspace name missing")
	}
}
