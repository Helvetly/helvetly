package mail

import (
	"strings"
	"testing"
)

func TestDocumentMessageHighlightsFactsAndClosesAfterDetails(t *testing.T) {
	l := NewLetter("en").
		DocumentMessage("Invoice 2026-001 for CHF 216.20 is due on 06.12.2026. <Thanks!>\n\nKind regards,\n\nAna & Co",
			"2026-001", "CHF 216.20", "06.12.2026").
		Summary(Row{Label: "Invoice", Value: "2026-001"}).Lead("Payment link: https://pay.example.test/").Attached("invoice.pdf")
	body := l.HTML()
	for _, fact := range []string{"2026-001", "CHF 216.20", "06.12.2026"} {
		if !strings.Contains(body, "<strong>"+fact+"</strong>") {
			t.Errorf("%q was not highlighted", fact)
		}
	}
	if !strings.Contains(body, "&lt;Thanks!&gt;") || !strings.Contains(body, "Ana &amp; Co") ||
		!strings.Contains(body, "https://pay.example.test/") ||
		strings.Index(body, "Attached: invoice.pdf") >= strings.Index(body, "Kind regards") ||
		!strings.HasSuffix(l.Text(), "Attached: invoice.pdf\n\nKind regards,\n\nAna & Co\n") {
		t.Fatalf("closing or body was lost or misplaced: %s", l.Text())
	}
}

func TestLongLetterKeepsItsLayout(t *testing.T) {
	long := strings.Repeat("é", 2500)
	l := NewLetter("en").Message(long).Summary(Row{Label: "Outstanding amount for invoice 2026-042", Value: "CHF 1’081.00"})
	body := layout(Message{Subject: "Payment reminder", HTML: l.HTML()}, "https://app.example.com")
	if !strings.Contains(body, "overflow-wrap:anywhere") || strings.Contains(body, "white-space:nowrap") {
		t.Fatal("long messages and summary labels must wrap inside the card")
	}
	if strings.Contains(body, "td valign") || !strings.Contains(body, "Outstanding amount for invoice 2026-042</span><strong") {
		t.Fatal("summary labels must be above their values")
	}
	if !strings.Contains(l.Text(), long) {
		t.Fatal("the text version must preserve the sender's message")
	}
}

func TestLetter(t *testing.T) {
	l := NewLetter("de").Greeting("Anna").Lead("Line <1>\nline 2").Message("One\n\nTwo").
		Summary(Row{Label: "Wann", Value: "Di, 1. Dez.\nMi, 2. Dez."}, Row{Label: "Leer"}, Row{Label: "Wo", Value: "Weg 1", Link: "https://m.example/?q=a&b", LinkText: "Karte"}).
		Action("Öffnen", "https://x.example/a?b=1&c=2").Note("Bitte <pünktlich>").FinePrint("", "Angehängt")
	h := l.HTML()
	for _, w := range []string{para + "Guten Tag Anna,</p>", para + "Line &lt;1&gt;<br>line 2</p>", para + "One</p>\n" + para + "Two</p>", "Di, 1. Dez.<br>Mi, 2. Dez.",
		`href="https://m.example/?q=a&amp;b"`, `<a style="color:#ffffff;text-decoration:none" href="https://x.example/a?b=1&amp;c=2"><strong style="font-weight:600">Öffnen</strong>`, buttonFill,
		"<em>“Bitte &lt;pünktlich&gt;”</em>", ">Angehängt</p>"} {
		if !strings.Contains(h, w) {
			t.Errorf("no %q in\n%s", w, h)
		}
	}
	if c := NewLetter("en").Code("123 456"); !strings.Contains(c.HTML(), ">123 456</td>") || c.Text() != "123 456\n" {
		t.Errorf("code %q", c.Text())
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
