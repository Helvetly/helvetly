package mail

import (
	"html"
	"slices"
	"strings"
)

// Letter is the body of an email to a client, built from the shared blocks in order: greeting, lead, summary card,
// call to action, note, fine print. Each block writes its HTML fragment (for layout's card) and its text part side by
// side, so the two always say the same. Every value is escaped; the blocks keep to the HTML rule of layout.go.
type Letter struct {
	language   string
	html, text strings.Builder
}

// NewLetter starts a letter in a language (de, fr, it, en; anything else reads as en) for its fixed words.
func NewLetter(language string) *Letter { return &Letter{language: language} }

// Row is one line of a summary card. Value may hold several lines; Hint is a muted word after it ("attached"); Link
// (with LinkText) is a small link under it, such as "Open in Maps".
type Row struct {
	Label, Value   string
	Hint           string
	Link, LinkText string
}

// Link is a labelled destination in a letter.
type Link struct{ Label, URL string }

// Section keeps related links and their context together in a distinct card.
func (l *Letter) Section(title, icon, description string, links ...Link) *Letter {
	l.html.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#fafafa" style="width:100%;margin:0 0 12px;background-color:#fafafa;border:1px solid ` +
		line + `"><tr><td style="padding:14px 16px"><h2 style="margin:0 0 6px;font-size:16px;line-height:22px;color:` + ink + `">`)
	if icon != "" {
		l.html.WriteString(`<span aria-hidden="true" style="color:` + primary + `">` + html.EscapeString(icon) + `</span> &nbsp;`)
	}
	l.html.WriteString(lines(title) + "</h2>")
	l.text.WriteString(title + "\n")
	if description != "" {
		l.html.WriteString(`<p style="margin:0 0 8px;font-size:13px;line-height:20px;color:` + muted + `">` + lines(description) + "</p>")
		l.text.WriteString(description + "\n")
	}
	l.html.WriteString(`<ul style="margin:8px 0 0;padding-left:20px">`)
	for _, link := range links {
		l.html.WriteString(`<li style="margin:4px 0"><a href="` + html.EscapeString(link.URL) + `">` + lines(link.Label) + `</a></li>`)
		l.text.WriteString("- " + link.Label + ": " + link.URL + "\n")
	}
	l.html.WriteString("</ul></td></tr></table>\n")
	l.text.WriteString("\n")
	return l
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
		l.html.WriteString(para + lines(s) + "</p>\n")
		l.text.WriteString(s + "\n\n")
	}
	return l
}

// Emphasis adds a paragraph with one important value highlighted.
func (l *Letter) Emphasis(before, value, after string) *Letter {
	l.html.WriteString(para + html.EscapeString(before) + "<strong>" + html.EscapeString(value) + "</strong>" + html.EscapeString(after) + "</p>\n")
	l.text.WriteString(before + value + after + "\n\n")
	return l
}

// Message is a typed text (an email template, a message the sender wrote): a paragraph per blank-line block.
func (l *Letter) Message(s string) *Letter {
	for p := range strings.SplitSeq(strings.ReplaceAll(s, "\r\n", "\n"), "\n\n") {
		l.Lead(p)
	}
	return l
}

// Summary lists the details in a panel. Each value sits beneath its label, leaving the full width for both.
func (l *Letter) Summary(rows ...Row) *Letter {
	var h, t strings.Builder
	for _, r := range rows {
		if strings.TrimSpace(r.Value) == "" {
			continue
		}
		value := lines(r.Value)
		t.WriteString(r.Label + ": " + strings.ReplaceAll(strings.TrimSpace(r.Value), "\n", "\n  "))
		if r.Hint != "" {
			value += ` <span style="font-weight:400;color:` + muted + `">(` + html.EscapeString(r.Hint) + ")</span>"
			t.WriteString(" (" + r.Hint + ")")
		}
		t.WriteString("\n")
		if r.Link != "" {
			value += `<br><span style="font-size:13px;font-weight:400"><a href="` + html.EscapeString(r.Link) + `">` + html.EscapeString(r.LinkText) + "</a></span>"
			t.WriteString("  " + r.LinkText + ": " + r.Link + "\n")
		}
		rule := ""
		if h.Len() > 0 {
			rule = "border-top:1px solid " + line + ";"
		}
		cell := rule + `font-family:` + fonts + `;font-size:14px;line-height:21px;`
		h.WriteString(`<tr><td style="` + cell + `padding:9px 14px;color:` + ink + `"><span style="display:block;font-size:12px;line-height:18px;color:` + muted + `">` +
			lines(r.Label) + `</span><strong style="font-weight:600">` + value + "</strong></td></tr>\n")
	}
	if h.Len() > 0 {
		l.html.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="` + panel + `" style="width:100%;margin:4px 0 24px;background-color:` +
			panel + `">` + "\n" + h.String() + "</table>\n")
		l.text.WriteString(t.String() + "\n")
	}
	return l
}

// Details are technical values (checksums, references) in a small muted box: each label above its value, set in a
// monospace face so a hash reads as one value rather than noise. Rows without a value are left out.
func (l *Letter) Details(rows ...Row) *Letter {
	var h, t strings.Builder
	for _, r := range rows {
		if strings.TrimSpace(r.Value) == "" {
			continue
		}
		pad := "12px"
		if h.Len() > 0 {
			pad = "0"
		}
		h.WriteString(`<tr><td style="padding:` + pad + ` 14px 10px;font-family:` + fonts + `;font-size:12px;line-height:18px;color:` + muted + `">` + html.EscapeString(r.Label) +
			`<br><span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:18px;color:` + text + `">` + lines(r.Value) + "</span></td></tr>\n")
		t.WriteString(r.Label + ": " + strings.TrimSpace(r.Value) + "\n")
	}
	if h.Len() > 0 {
		l.html.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#fafafa" style="width:100%;margin:0 0 16px;background-color:#fafafa;border:1px solid ` +
			line + `">` + "\n" + h.String() + `<tr><td height="2" style="height:2px;font-size:0;line-height:0">&nbsp;</td></tr></table>` + "\n")
		l.text.WriteString(t.String() + "\n")
	}
	return l
}

// Code is a one-time code, large and set apart so it is easy to read and copy.
func (l *Letter) Code(code string) *Letter {
	l.html.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="` + panel + `" style="width:100%;margin:4px 0 24px;background-color:` +
		panel + `"><tr><td align="center" style="padding:18px 16px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;line-height:40px;` +
		`font-weight:700;letter-spacing:6px;color:` + ink + `">` + html.EscapeString(code) + "</td></tr></table>\n")
	l.text.WriteString(code + "\n\n")
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

// Link adds a secondary action as a text link, leaving the main button prominent.
func (l *Letter) Link(label, url string) *Letter {
	if url != "" {
		l.html.WriteString(para + `<a href="` + html.EscapeString(url) + `">` + lines(label) + "</a></p>\n")
		l.text.WriteString(label + ": " + url + "\n\n")
	}
	return l
}

// Note is what the business wrote to the client, quoted and set apart; an empty one is left out.
func (l *Letter) Note(s string) *Letter {
	if s = strings.TrimSpace(s); s != "" {
		l.html.WriteString(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px"><tr><td style="border-left:3px solid ` + line +
			`;padding:2px 0 2px 14px;font-family:` + fonts + `;font-size:15px;line-height:24px;color:` + muted + `"><em>“` + lines(s) + "”</em></td></tr></table>\n")
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
		l.html.WriteString(`<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:` + muted + `">` + lines(strings.Join(kept, "\n")) + "</p>\n")
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

// Button is the call to action's HTML: a filled, rounded cell (bgcolor for Outlook) holding a white, bold link, centred.
// The fill is a business's near-black; layout makes it Helvetly's teal on Helvetly's own email (buttonFill).
func Button(label, url string) string {
	label = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(label), "→"))
	return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:8px auto 24px"><tr><td align="center" ` + buttonFill +
		`;padding:13px 30px;font-family:` + fonts + `;font-size:15px;line-height:20px;font-weight:600">` +
		`<a style="color:#ffffff;text-decoration:none" href="` + html.EscapeString(url) + `"><strong style="font-weight:600">` + html.EscapeString(label) + "</strong></a></td></tr></table>\n"
}

// para is a paragraph's opening tag: its own spacing, never the client's default margins.
const para = `<p style="margin:0 0 18px;line-height:26px">`

// lines escapes s and keeps its line breaks.
func lines(s string) string {
	return strings.ReplaceAll(html.EscapeString(strings.TrimSpace(s)), "\n", "<br>")
}
