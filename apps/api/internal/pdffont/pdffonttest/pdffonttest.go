// Package pdffonttest holds the text in every script that the PDF generators' tests render.
package pdffonttest

import (
	"bytes"
	"strings"
	"testing"
)

// Samples: one line per script a user may type, and the font that should draw it.
var Samples = []struct{ Name, Text, Font string }{
	{"Polish", "Zażółć gęślą jaźń ŁÓDŹ", "LiberationSans"},
	{"Romanian", "Știință și țară: ă î â Ș Ț", "LiberationSans"},
	{"German", "Straße äöü ÄÖÜ ß", "LiberationSans"},
	{"Czech", "Příliš žluťoučký kůň ř ů", "LiberationSans"},
	{"Vietnamese", "Tiếng Việt có dấu", "LiberationSans"},
	{"Greek", "Καλημέρα κόσμε", "LiberationSans"},
	{"Cyrillic", "Съешь же ещё этих булок", "LiberationSans"},
	{"Hebrew", "שלום עולם", "LiberationSans"},
	{"Arabic", "مرحبا بالعالم", "NotoSansArabic"},
	{"Devanagari", "नमस्ते दुनिया", "NotoSansDevanagari"},
	{"Thai", "สวัสดีชาวโลก", "NotoSansThai"},
	{"Chinese", "你好，世界：发票", "NotoSansSC"},
	{"Japanese", "こんにちは世界、請求書", "NotoSansSC"},
	{"Korean", "안녕하세요 세계", "NotoSansKRHangul"},
	{"Emoji", "Danke 🎉👍❤️ 😀", "NotoEmoji"},
	{"Symbols", "≈ ∑ → ✓ ★", "NotoSansMath"},
}

// All is every sample on one line.
func All() string {
	var b strings.Builder
	for _, s := range Samples {
		b.WriteString(s.Text + " ")
	}
	return b.String()
}

// Fonts fails t unless pdf embeds every sample's font.
func Fonts(t *testing.T, pdf []byte) {
	t.Helper()
	for _, s := range Samples {
		if !bytes.Contains(pdf, []byte("/BaseFont /utf8"+strings.ToLower(s.Font))) { // fpdf's name for a UTF-8 font
			t.Errorf("the PDF does not embed %s, needed for %s", s.Font, s.Name)
		}
	}
}
