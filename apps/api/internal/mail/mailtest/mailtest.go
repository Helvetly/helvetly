// Package mailtest renders client emails for golden tests and holds them to the HTML every mail client supports.
package mailtest

import (
	"flag"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"

	"helvetly.com/api/internal/mail"
)

var update = flag.Bool("update", false, "rewrite the email golden files in testdata")

// Unsupported is what email HTML never uses (layout.go): style blocks, <body> CSS, external CSS, scripts, SVG, frames
// and forms, web fonts, CSS positioning, floats, flex and grid. Inline padding, borders, rounded corners, backgrounds
// over a solid colour, widths and bgcolor are allowed: Outlook for Windows ignores some of them and stays readable.
var Unsupported = regexp.MustCompile(`(?i)<style|<body|<link|<script|<svg|<iframe|<object|<embed|<form|@media|@import|@font-face|!important|` +
	`javascript:|[;"]\s*(position|float|flex[a-z-]*|grid[a-z-]*)\s*:|display:\s*(inline-)?(flex|grid)`)

// PublicURL and Brand are the fixtures every golden email is rendered with.
const PublicURL = "https://app.helvetly.example"

var Brand = mail.Brand{Name: "Dein Deutsch Coach", LogoPath: "/api/v1/public/email-logo/ws/logo", Address: []string{"Bahnhofstrasse 1", "8001 Zürich"},
	Phone: "+41 44 000 00 00", Email: "hallo@deutsch.example", Website: "https://www.deutsch.example/", VAT: "CHE-123.456.789", Language: "de", SentWith: true}

// maxWord: a longer run of visible characters without a break (a bare URL) would make a phone scroll sideways.
const maxWord = 60

var tag = regexp.MustCompile(`<[^>]*>`)

// attr is an attribute's name in a tag: one given twice is kept once by a client, so a style or link is lost.
var attr = regexp.MustCompile(`\s([a-z-]+)=`)

// Golden renders m as the client gets it (a workspace's email as the business Brand) and compares its HTML and text with testdata/<name>.html.golden and
// .txt.golden (go test -update rewrites them). The HTML must keep to the supported set and wrap on a phone.
func Golden(t *testing.T, name string, m mail.Message) {
	t.Helper()
	GoldenWith(t, name, m, Brand)
}

// GoldenWith is Golden for the business brand.
func GoldenWith(t *testing.T, name string, m mail.Message, brand mail.Brand) {
	t.Helper()
	if m.Workspace == "" || m.Members { // Helvetly's own, as Branded passes it through
		brand = mail.Brand{}
	}
	h, text := mail.Render(m, brand, PublicURL)
	Check(t, name, h)
	if strings.Contains(text, "<p") || strings.Contains(text, "<br") || strings.Contains(text, "&amp;") {
		t.Errorf("%s: HTML in the text part:\n%s", name, text)
	}
	compare(t, filepath.Join("testdata", name+".html.golden"), h)
	compare(t, filepath.Join("testdata", name+".txt.golden"), text)
}

// Check holds one email's HTML to the supported set and to words that wrap.
func Check(t *testing.T, name, h string) {
	t.Helper()
	if m := Unsupported.FindString(h); m != "" {
		t.Errorf("%s: %q is not supported in every mail client", name, m)
	}
	for _, tg := range tag.FindAllString(h, -1) {
		seen := map[string]bool{}
		for _, m := range attr.FindAllStringSubmatch(tg, -1) {
			if seen[m[1]] {
				t.Errorf("%s: %s given twice in %s", name, m[1], tg)
			}
			seen[m[1]] = true
		}
	}
	for w := range strings.FieldsSeq(html.UnescapeString(tag.ReplaceAllString(h, " "))) {
		if utf8.RuneCountInString(w) > maxWord {
			t.Errorf("%s: %q does not wrap", name, w)
		}
	}
}

func compare(t *testing.T, path, got string) {
	t.Helper()
	if *update {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (go test -update writes it)", err)
	}
	if string(want) != got {
		t.Errorf("%s differs (go test -update rewrites it):\n--- got\n%s", path, got)
	}
}
