package mail

import (
	"html"
	"strings"
)

// The app's tokens (packages/ui globals.css) in hex: mail clients know no oklch or CSS variables.
const (
	ink   = "#18181b" // --primary
	text  = "#3f3f46"
	muted = "#71717a"
	brand = "#0b7268" // --brand, the links
	fonts = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)

// Only what every client in caniemail supports fully (Mailpit's HTML Check at 100%): tags, cellpadding, align and
// inline colour, font family, size and style. No margin, padding, border, background, width or <style>: so no card,
// no filled button and a fluid width. The blocks of a client email are in letter.go.

// linkColour gives a fragment's links the brand colour inline: there is no <style> block to do it.
var linkColour = strings.NewReplacer(`<a href=`, `<a style="color:`+brand+`" href=`)

// layout puts a body fragment on the letter every Helvetly email shares; a full document is left alone.
// No <body> element (it is implied): clients rewrite or drop it, so nothing may hang on it.
func layout(m Message, publicURL string) string {
	if m.HTML == "" || strings.HasPrefix(strings.ToLower(strings.TrimSpace(m.HTML)), "<!doctype") {
		return m.HTML
	}
	footer, header := m.Footer, helvetlyHeader(publicURL)
	switch {
	case m.Brand != nil && footer == "":
		footer, header = brandFooter(*m.Brand, m.Language, publicURL), brandHeader(*m.Brand, publicURL)
	case m.Brand != nil:
		header = brandHeader(*m.Brand, publicURL)
	case footer == "":
		footer = `Sent by <a href="` + html.EscapeString(publicURL) + `" style="color:` + muted + `">Helvetly</a>`
	}
	lang := "en"
	if m.Language != "" {
		lang = html.EscapeString(m.Language)
	}
	cell := func(size, colour, content string) string {
		return `<tr><td align="left" style="font-family:` + fonts + `;font-size:` + size + `;color:` + colour + `">` + content + "</td></tr>\n"
	}
	return `<!doctype html><html lang="` + lang + `"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
		// Light only: inverted, the muted colours would be unreadable.
		`<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
		`<title>` + html.EscapeString(m.Subject) + "</title></head>\n" +
		`<table role="presentation" cellpadding="16" cellspacing="0" align="left">` + "\n" +
		cell("17px", ink, header) + cell("15px", text, linkColour.Replace(m.HTML)) + cell("12px", muted, footer) +
		`</table></html>`
}

func helvetlyHeader(publicURL string) string {
	return `<a href="` + html.EscapeString(publicURL) + `" style="color:` + ink + `;font-size:20px"><strong>Helvetly</strong></a>`
}

// brandHeader: the business's logo (if any) and name. The logo has no height or width (Mailpit counts both as partly
// supported): the logo URL serves a file already scaled to 36 px high (invoices.scaleEmailLogo).
func brandHeader(b Brand, publicURL string) string {
	logo := ""
	if b.LogoPath != "" {
		logo = `<img src="` + html.EscapeString(publicURL+b.LogoPath) + `" alt="" style="vertical-align:middle"> &nbsp;`
	}
	return logo + `<strong style="vertical-align:middle;color:` + ink + `">` + html.EscapeString(b.Name) + `</strong>`
}

// plainText is the text part: the message, then the business footer for a branded email.
func plainText(m Message, publicURL string) string {
	if m.Brand == nil || m.Footer != "" {
		return m.Text
	}
	return strings.TrimRight(m.Text, "\n") + brandText(*m.Brand, m.Language, publicURL)
}
