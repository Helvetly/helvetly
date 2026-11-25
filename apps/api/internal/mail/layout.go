package mail

import (
	"html"
	"strings"
)

// The app's tokens (packages/ui globals.css) in hex: mail clients know no oklch or CSS variables.
const (
	ink      = "#18181b"
	text     = "#3f3f46"
	muted    = "#71717a"
	line     = "#e8e8ec" // the summary panel's separators
	panel    = "#f5f5f7" // the summary panel
	primary  = "#2563eb" // --primary: Helvetly's own buttons
	brand    = "#1d4fd1" // --brand: Helvetly's own links
	logoFrom = "#0e9a86"
	fonts    = "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)

// What a style changes: Helvetly's own email has its pastel page, gradient bar and blue buttons; a business's email to
// its clients stays neutral (grey page, near-black buttons and links) so it reads as the business's.
type look struct {
	page, pageImage, button, link, bar string
}

var (
	helvetlyLook = look{page: "#f3f1fa", pageImage: "linear-gradient(180deg,#e9e4fb 0%,#f3f1fa 38%,#f6f6f8 100%)", button: primary, link: brand,
		bar: "linear-gradient(90deg," + logoFrom + " 0%," + primary + " 55%,#8b5cf6 100%)"}
	businessLook = look{page: "#f4f4f5", button: ink, link: ink}
)

// Email HTML keeps to what renders in every common client, with inline styles only: tables for layout, padding,
// borders, rounded corners and backgrounds (a gradient always over a solid fallback colour), never a <style> block,
// <body> CSS, scripts, SVG, web fonts or CSS positioning, flex or grid. Outlook for Windows ignores the corners,
// gradients and max-width, so there the same email is square and full width but just as readable. The blocks of a
// client email are in letter.go.

// buttonFill is the call to action's fill as Button writes it; Helvetly's own email swaps it for its primary colour.
const buttonFill = `bgcolor="` + ink + `" style="background-color:` + ink

// layout puts a body fragment on the letter every email shares: the sender's mark above a white card with the subject
// as its title (unless the fragment brings its own <h1>), the footer under it. A full document is left alone.
// No <body> element (it is implied): clients rewrite or drop it, so nothing may hang on it.
func layout(m Message, publicURL string) string {
	if m.HTML == "" || strings.HasPrefix(strings.ToLower(strings.TrimSpace(m.HTML)), "<!doctype") {
		return m.HTML
	}
	lk, footer, header := helvetlyLook, m.Footer, helvetlyHeader(publicURL)
	switch {
	case m.Brand != nil && footer == "":
		lk, footer, header = businessLook, brandFooter(*m.Brand, m.Language, publicURL), brandHeader(*m.Brand, publicURL)
	case m.Brand != nil:
		lk, header = businessLook, brandHeader(*m.Brand, publicURL)
	case footer == "":
		footer = `Sent by <a href="` + html.EscapeString(publicURL) + `" style="color:` + muted + `">Helvetly</a>`
	}
	lang := "en"
	if m.Language != "" {
		lang = html.EscapeString(m.Language)
	}
	body := strings.NewReplacer(`<a href=`, `<a style="color:`+lk.link+`" href=`, buttonFill, `bgcolor="`+lk.button+`" style="background-color:`+lk.button).Replace(m.HTML)
	if !strings.Contains(body, "<h1") && strings.TrimSpace(m.Subject) != "" {
		body = Title(m.Subject) + body
	}
	page := `background-color:` + lk.page
	if lk.pageImage != "" {
		page += `;background-image:` + lk.pageImage
	}
	bar := ""
	if lk.bar != "" {
		bar = `<tr><td height="5" bgcolor="` + primary + `" style="height:5px;font-size:0;line-height:0;border-radius:16px 16px 0 0;background-color:` + primary +
			`;background-image:` + lk.bar + `">&nbsp;</td></tr>` + "\n"
	}
	return `<!doctype html><html lang="` + lang + `"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
		// Light only: inverted, the muted colours would be unreadable.
		`<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
		`<title>` + html.EscapeString(m.Subject) + "</title></head>\n" +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="` + lk.page + `" style="width:100%;` + page + `">` + "\n" +
		`<tr><td align="center" style="padding:32px 12px 40px">` + "\n" +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">` + "\n" +
		`<tr><td align="center" style="padding:0 0 24px;font-family:` + fonts + `;font-size:20px;line-height:28px;color:` + ink + `">` + header + "</td></tr>\n" +
		`<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;background-color:#ffffff;border:1px solid ` + line + `;border-radius:16px">` + "\n" +
		bar +
		`<tr><td style="padding:32px 28px 16px;font-family:` + fonts + `;font-size:15px;line-height:24px;color:` + text + `">` + "\n" + body + "</td></tr>\n" +
		"</table></td></tr>\n" +
		`<tr><td align="center" style="padding:24px 16px 0;font-family:` + fonts + `;font-size:12px;line-height:19px;color:` + muted + `">` + footer + "</td></tr>\n" +
		"</table>\n</td></tr>\n</table></html>"
}

// Title is the card's heading: the layout puts the subject there unless a fragment begins with its own.
func Title(s string) string {
	return `<h1 style="margin:0 0 20px;font-family:` + fonts + `;font-size:22px;line-height:30px;font-weight:600;color:` + ink + `">` + html.EscapeString(strings.TrimSpace(s)) + "</h1>\n"
}

// helvetlyHeader: the app icon (email-logo.png, 96 px shown at 40 for sharp screens) and the name, linking home.
func helvetlyHeader(publicURL string) string {
	home := html.EscapeString(publicURL)
	return `<a href="` + home + `" style="color:` + ink + `;text-decoration:none"><img src="` + home + `/email-logo.png" width="40" height="40" alt="" style="vertical-align:middle;border:0">` +
		`&nbsp;&nbsp;<strong style="vertical-align:middle;font-size:21px;font-weight:600">Helvetly</strong></a>`
}

// brandHeader: the business's logo, else its name. The logo has no size attributes: its URL serves a file already
// scaled to 36 px high (invoices.scaleEmailLogo); its alt text is the name, for clients that block images.
func brandHeader(b Brand, publicURL string) string {
	if b.LogoPath != "" {
		return `<img src="` + html.EscapeString(publicURL+b.LogoPath) + `" alt="` + html.EscapeString(b.Name) + `" style="border:0">`
	}
	return `<strong style="font-weight:600;color:` + ink + `">` + html.EscapeString(b.Name) + `</strong>`
}

// plainText is the text part: the message, then the business footer for a branded email.
func plainText(m Message, publicURL string) string {
	if m.Brand == nil || m.Footer != "" {
		return m.Text
	}
	return strings.TrimRight(m.Text, "\n") + brandText(*m.Brand, m.Language, publicURL)
}
