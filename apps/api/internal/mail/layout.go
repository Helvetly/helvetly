package mail

import (
	"html"
	"strings"
)

// Email colours are in hex because mail clients do not support CSS variables consistently.
const (
	ink      = "#18181b"
	text     = "#3f3f46"
	muted    = "#71717a"
	line     = "#e8e8ec" // the summary panel's separators
	border   = "#e7e7ea" // the card's edge on the white page
	panel    = "#f5f5f7" // the summary panel
	primary  = "#0f766e" // Helvetly teal, with contrast for white button text
	logoFrom = "#0e9a86"
	fonts    = "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)

// What a style changes. Both stand on a white page with a white, thinly bordered card under a thin bar: Helvetly's own
// email has its teal gradient bar and buttons; a business's email to its clients stays neutral (a near-black bar,
// buttons and links) so it reads as the business's.
type look struct {
	button, link, bar, barImage string
}

var (
	helvetlyLook = look{button: primary, link: primary, bar: primary, barImage: "linear-gradient(90deg," + logoFrom + "," + primary + ")"}
	businessLook = look{button: ink, link: ink, bar: "#52525b"}
)

// SiteURL is the public website's origin (NEXT_PUBLIC_WEB_URL): Helvetly's own footer links its help and legal pages
// there. main sets it from the configuration.
var SiteURL = "https://www.helvetly.com"

const tagline = "The online back office for freelancers and small businesses."

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
	lk, footer, header := helvetlyLook, helvetlyFooter(m.Footer), helvetlyHeader(publicURL)
	switch {
	case m.Brand != nil && m.Footer == "":
		lk, footer, header = businessLook, brandFooter(*m.Brand, m.Language, publicURL), brandHeader(*m.Brand, publicURL)
	case m.Brand != nil:
		lk, footer, header = businessLook, m.Footer, brandHeader(*m.Brand, publicURL)
	}
	lang := "en"
	if m.Language != "" {
		lang = html.EscapeString(m.Language)
	}
	body := strings.NewReplacer(`<a href=`, `<a style="color:`+lk.link+`" href=`, buttonFill, `bgcolor="`+lk.button+`" style="background-color:`+lk.button).Replace(m.HTML)
	if title := strings.TrimSpace(m.Subject); !strings.Contains(body, "<h1") && title != "" {
		// An eyebrow saying what the email is replaces the same word leading the subject ("Invitation: …").
		if m.Eyebrow != "" {
			title = strings.TrimSpace(strings.TrimPrefix(title, m.Eyebrow+":"))
		}
		body = Title(title) + body
	}
	if m.Eyebrow != "" {
		body = eyebrow(m.Eyebrow, m.Tone) + body
	}
	bar := `background-color:` + lk.bar
	if lk.barImage != "" {
		bar += `;background-image:` + lk.barImage
	}
	return `<!doctype html><html lang="` + lang + `"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
		// Light only: inverted, the muted colours would be unreadable. No data detectors: the footer stays muted.
		`<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
		`<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">` +
		`<title>` + html.EscapeString(m.Subject) + "</title></head>\n" +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;background-color:#ffffff">` + "\n" +
		`<tr><td align="center" style="padding:32px 12px 40px;word-wrap:break-word;overflow-wrap:anywhere">` + "\n" +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">` + "\n" +
		`<tr><td align="center" style="padding:0 0 24px;font-family:` + fonts + `;font-size:20px;line-height:28px;color:` + ink + `">` + header + "</td></tr>\n" +
		`<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;background-color:#ffffff;border:1px solid ` + border + `;border-radius:16px">` + "\n" +
		`<tr><td height="3" bgcolor="` + lk.bar + `" style="height:3px;font-size:0;line-height:0;border-radius:16px 16px 0 0;` + bar + `">&nbsp;</td></tr>` + "\n" +
		`<tr><td style="padding:32px 32px 16px;font-family:` + fonts + `;font-size:15px;line-height:24px;color:` + text + `">` + "\n" + body + "</td></tr>\n" +
		"</table></td></tr>\n" +
		`<tr><td align="center" style="padding:28px 16px 0;font-family:` + fonts + `;font-size:12px;line-height:20px;color:` + muted + `">` + footer + "</td></tr>\n" +
		"</table>\n</td></tr>\n</table></html>"
}

// eyebrow is the small pill above the title saying what the email is ("Invoice", "✓ Completed").
func eyebrow(s string, tone Tone) string {
	bg, color, icon := panel, text, ""
	switch tone {
	case Positive:
		bg, color, icon = "#dcfce7", "#166534", "✓"
	case Negative:
		bg, color, icon = "#fee2e2", "#991b1b", "×"
	}
	if icon != "" {
		icon = `<span aria-hidden="true">` + icon + `</span> `
	}
	return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px"><tr><td bgcolor="` + bg + `" style="background-color:` + bg +
		`;border-radius:999px;padding:4px 12px;font-family:` + fonts + `;font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.2px;color:` + color + `">` +
		icon + html.EscapeString(strings.TrimSpace(s)) + "</td></tr></table>\n"
}

// helvetlyFooter is the small print under Helvetly's own card: who sends it, why it came (why, HTML, when given), the
// website's help and legal pages, and the company.
func helvetlyFooter(why string) string {
	site := html.EscapeString(SiteURL)
	link := func(label, path string) string {
		return `<a href="` + site + path + `" style="color:` + muted + `">` + label + `</a>`
	}
	f := `<strong style="font-weight:600;color:` + text + `">Helvetly</strong> &middot; ` + tagline + "<br>"
	if why != "" {
		f += why + "<br>"
	}
	return f + link("Help", "/help") + ` &nbsp;&middot;&nbsp; ` + link("Privacy", "/privacy") + ` &nbsp;&middot;&nbsp; ` + link("Terms", "/terms")
}

// helvetlyText is the same footer in the text part (without the why: a text part says it in its own words).
func helvetlyText() string {
	return "Helvetly · " + tagline + "\nHelp: " + SiteURL + "/help\nPrivacy: " + SiteURL + "/privacy\nTerms: " + SiteURL + "/terms\n"
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

// brandHeader: the business's logo and its name, as Helvetly's header shows its own (the name alone without a logo).
// The logo has no size attributes: its URL serves a file already scaled to 44 px high (invoices.scaleEmailLogo).
func brandHeader(b Brand, publicURL string) string {
	name := `<strong style="vertical-align:middle;font-size:19px;font-weight:600;color:` + ink + `">` + html.EscapeString(b.Name) + `</strong>`
	if b.LogoPath == "" {
		return name
	}
	return `<img src="` + html.EscapeString(publicURL+b.LogoPath) + `" alt="" style="vertical-align:middle;border:0">&nbsp;&nbsp;` + name
}

// plainText is the text part: the message, then the business footer for a branded email, Helvetly's for its own.
func plainText(m Message, publicURL string) string {
	switch {
	case m.Text == "" || (m.Brand != nil && m.Footer != ""):
		return m.Text
	case m.Brand != nil:
		return strings.TrimRight(m.Text, "\n") + brandText(*m.Brand, m.Language, publicURL)
	case strings.Contains(m.Text, "\n--"): // the message closes with its own signature block (a notification's settings)
		return strings.TrimRight(m.Text, "\n") + "\n\n" + helvetlyText()
	}
	return strings.TrimRight(m.Text, "\n") + "\n\n-- \n" + helvetlyText()
}
