package mail

import (
	"strings"
	"testing"
)

func TestLetter(t *testing.T) {
	l := NewLetter("de").Greeting("Anna").Lead("Line <1>\nline 2").Message("One\n\nTwo").
		Summary(Row{Label: "Wann", Value: "Di, 1. Dez.\nMi, 2. Dez."}, Row{Label: "Leer"}, Row{Label: "Wo", Value: "Weg 1", Link: "https://m.example/?q=a&b", LinkText: "Karte"}).
		Action("Öffnen", "https://x.example/a?b=1&c=2").Note("Bitte <pünktlich>").FinePrint("", "Angehängt")
	h := l.HTML()
	for _, w := range []string{"<p>Guten Tag Anna,</p>", "<p>Line &lt;1&gt;<br>line 2</p>", "<p>One</p>\n<p>Two</p>", "Di, 1. Dez.<br>Mi, 2. Dez.",
		`href="https://m.example/?q=a&amp;b"`, `<a style="color:#0b7268" href="https://x.example/a?b=1&amp;c=2"><strong>Öffnen →</strong>`,
		"<em>“Bitte &lt;pünktlich&gt;”</em>", ">Angehängt</p>"} {
		if !strings.Contains(h, w) {
			t.Errorf("no %q in\n%s", w, h)
		}
	}
	if strings.Contains(h, "Leer") {
		t.Error("an empty row is shown")
	}
	want := "Guten Tag Anna,\n\nLine <1>\nline 2\n\nOne\n\nTwo\n\nWann: Di, 1. Dez.\n  Mi, 2. Dez.\nWo: Weg 1\n  Karte: https://m.example/?q=a&b\n\n" +
		"Öffnen: https://x.example/a?b=1&c=2\n\n“Bitte <pünktlich>”\n\nAngehängt\n"
	if got := l.Text(); got != want {
		t.Errorf("text:\n%s\nwant:\n%s", got, want)
	}
	if got := NewLetter("fr").Attached().Attached("", " ").Attached("a.pdf", "", "b.xml").Text(); got != "En pièce jointe: a.pdf, b.xml\n" {
		t.Errorf("attached %q", got)
	}
	if got := NewLetter("xx").Greeting("").Text(); got != "Hello,\n" {
		t.Errorf("fallback greeting %q", got)
	}
}
