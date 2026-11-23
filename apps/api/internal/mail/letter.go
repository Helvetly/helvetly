package mail

import (
	"html"
	"slices"
	"strings"
)

// Letter is the body of an email to a client, built from the shared blocks in order: greeting, lead, summary card,
// call to action, note, fine print. Each block writes its HTML fragment (for layout) and its text part side by side,
// so the two always say the same. Every value is escaped; the blocks keep to the supported HTML of layout.go.
type Letter struct {
	language   string
	html, text strings.Builder
}

// NewLetter starts a letter in a language (de, fr, it, en; anything else reads as en) for its fixed words.
func NewLetter(language string) *Letter { return &Letter{language: language} }

// Row is one line of a summary card. Value may hold several lines; Link (with LinkText) is a small link under it,
// such as "Open in Maps".
type Row struct {
	Label, Value   string
	Link, LinkText string
}

var greetings = map[string]string{"de": "Guten Tag", "fr": "Bonjour", "it": "Buongiorno", "en": "Hello"}

// Greeting is "Hello Anna," in the letter's language; without a name, "Hello,".
func (l *Letter) Greeting(name string) *Letter {
	g, ok := greetings[l.language]
	if !ok {
		g = greetings["en"]
	}
	if name = strings.TrimSpace(name); name != "" {
		g += " " + name
	}
	return l.Lead(g + ",")
}

// Lead is one paragraph of the message; an empty one is left out.
func (l *Letter) Lead(s string) *Letter {
	if s = strings.TrimSpace(s); s != "" {
		l.html.WriteString(`<p>` + lines(s) + "</p>\n")
		l.text.WriteString(s + "\n\n")
	}
	return l
}

// Message is a typed text (an email template, a message the sender wrote): a paragraph per blank-line block.
func (l *Letter) Message(s string) *Letter {
	for p := range strings.SplitSeq(strings.ReplaceAll(s, "\r\n", "\n"), "\n\n") {
		l.Lead(p)
	}
	return l
}

// Summary is the card of what the email is about: label and value rows, labels muted. Rows without a value are left
// out.
func (l *Letter) Summary(rows ...Row) *Letter {
	var h, t strings.Builder
	for _, r := range rows {
		if strings.TrimSpace(r.Value) == "" {
			continue
		}
		value := lines(r.Value)
		t.WriteString(r.Label + ": " + strings.ReplaceAll(strings.TrimSpace(r.Value), "\n", "\n  ") + "\n")
		if r.Link != "" {
			value += `<br><a style="color:` + brand + `;font-size:13px" href="` + html.EscapeString(r.Link) + `">` + html.EscapeString(r.LinkText) + "</a>"
			t.WriteString("  " + r.LinkText + ": " + r.Link + "\n")
		}
		h.WriteString(`<tr><td valign="top" style="font-family:` + fonts + `;font-size:13px;color:` + muted + `">` + html.EscapeString(r.Label) +
			`</td><td valign="top" style="font-family:` + fonts + `;font-size:15px;color:` + ink + `">` + value + "</td></tr>\n")
	}
	if h.Len() > 0 {
		l.html.WriteString(`<table role="presentation" cellpadding="6" cellspacing="0">` + "\n" + h.String() + "</table>\n")
		l.text.WriteString(t.String() + "\n")
	}
	return l
}

// Action is the call to action: the email's most prominent link.
func (l *Letter) Action(label, url string) *Letter {
	if url != "" {
		l.html.WriteString(Button(label, url))
		l.text.WriteString(strings.TrimSuffix(strings.TrimSpace(label), " →") + ": " + url + "\n\n")
	}
	return l
}

// Note is what the business wrote to the client, quoted and set apart; an empty one is left out.
func (l *Letter) Note(s string) *Letter {
	if s = strings.TrimSpace(s); s != "" {
		l.html.WriteString(`<p style="color:` + muted + `"><em>“` + lines(s) + "”</em></p>\n")
		l.text.WriteString("“" + s + "”\n\n")
	}
	return l
}

// FinePrint is the small print under the rest (an attachment, a legal note); empty lines are left out.
func (l *Letter) FinePrint(ls ...string) *Letter {
	kept := []string{}
	for _, s := range ls {
		if s = strings.TrimSpace(s); s != "" {
			kept = append(kept, s)
		}
	}
	if len(kept) > 0 {
		l.html.WriteString(`<p style="font-size:13px;color:` + muted + `">` + lines(strings.Join(kept, "\n")) + "</p>\n")
		l.text.WriteString(strings.Join(kept, "\n") + "\n\n")
	}
	return l
}

var attached = map[string]string{"de": "Angehängt", "fr": "En pièce jointe", "it": "In allegato", "en": "Attached"}

// Attached is the fine print naming the attached files (empty names left out).
func (l *Letter) Attached(names ...string) *Letter {
	names = slices.DeleteFunc(slices.Clone(names), func(n string) bool { return strings.TrimSpace(n) == "" })
	if len(names) == 0 {
		return l
	}
	word, ok := attached[l.language]
	if !ok {
		word = attached["en"]
	}
	return l.FinePrint(word + ": " + strings.Join(names, ", "))
}

// HTML is the body fragment for Message.HTML.
func (l *Letter) HTML() string { return l.html.String() }

// Text is the text part for Message.Text.
func (l *Letter) Text() string { return strings.TrimRight(l.text.String(), "\n") + "\n" }

// Button is the call to action's HTML: a filled button needs a background, so a bold, larger brand-coloured link in
// a cell of its own, with an arrow. Its style comes before href: layout colours only the links of `<a href=`.
func Button(label, url string) string {
	label = strings.TrimSpace(label)
	if !strings.HasSuffix(label, "→") {
		label += " →"
	}
	return `<table role="presentation" cellpadding="6" cellspacing="0"><tr><td style="font-family:` + fonts + `;font-size:17px">` +
		`<a style="color:` + brand + `" href="` + html.EscapeString(url) + `"><strong>` + html.EscapeString(label) + "</strong></a></td></tr></table>\n"
}

// lines escapes s and keeps its line breaks.
func lines(s string) string {
	return strings.ReplaceAll(html.EscapeString(strings.TrimSpace(s)), "\n", "<br>")
}
