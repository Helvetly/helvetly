package mail

import (
	"fmt"
	"html"
	"strings"
)

// The app's tokens (packages/ui globals.css) in hex: mail clients know no oklch or CSS variables.
const (
	ink    = "#18181b" // --primary
	text   = "#3f3f46"
	muted  = "#71717a"
	border = "#e4e4e7"
	canvas = "#f4f4f5"
	brand  = "#0b7268" // --brand, the links
	fonts  = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
)

// Button is the call to action: a table cell carries the colour, so Outlook draws it too ("bulletproof").
func Button(label, url string) string {
	return fmt.Sprintf(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">`+
		`<tr><td bgcolor="%s" style="border-radius:8px"><a href="%s" style="display:inline-block;padding:12px 22px;border:1px solid %s;`+
		`border-radius:8px;font-family:%s;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none">%s</a></td></tr></table>`+"\n",
		ink, html.EscapeString(url), ink, fonts, html.EscapeString(label))
}

// layout puts a body fragment on the branded card every Helvetly email shares; a full document is left alone.
// Tables and inline styles, so Outlook and Gmail keep it; the <style> block only spaces the fragments' tags.
// publicURL hosts the logo (the platform's public/email-logo.png); with images off its alt text stays.
func layout(m Message, publicURL string) string {
	if m.HTML == "" || strings.HasPrefix(strings.ToLower(strings.TrimSpace(m.HTML)), "<!doctype") {
		return m.HTML
	}
	footer := m.Footer
	if footer == "" {
		footer = `Sent by <a href="` + html.EscapeString(publicURL) + `" style="color:` + muted + `">Helvetly</a>`
	}
	preview := ""
	if m.Preview != "" {
		preview = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">` + html.EscapeString(m.Preview) + "</div>\n"
	}
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
		// Light only: an inverted card would leave the fragments' own muted colours unreadable.
		`<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
		`<title>` + html.EscapeString(m.Subject) + `</title>` +
		`<style>:root{color-scheme:light}p{margin:0 0 16px}ul{margin:0 0 16px;padding-left:20px}li{margin:0 0 6px}` +
		`h3{margin:24px 0 8px;font-size:15px;color:` + ink + `}a{color:` + brand + `}.card>:last-child{margin-bottom:0!important}@media (max-width:480px){.card{padding:24px 20px!important}.outer{padding:20px 8px!important}}</style></head>` + "\n" +
		`<body style="margin:0;padding:0;background:` + canvas + `">` + "\n" + preview +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="` + canvas + `" style="background:` + canvas + `">` +
		`<tr><td class="outer" align="center" style="padding:32px 16px">` + "\n" +
		`<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">` + "\n" +
		`<tr><td style="padding:0 4px 20px;font-family:` + fonts + `">` +
		`<a href="` + html.EscapeString(publicURL) + `" style="text-decoration:none;color:` + ink + `">` +
		`<img src="` + html.EscapeString(publicURL) + `/email-logo.png" width="28" height="28" alt="" style="display:inline-block;border:0;` +
		`vertical-align:middle;border-radius:7px">` +
		`<span style="vertical-align:middle;margin-left:10px;font-size:17px;font-weight:700;letter-spacing:-0.01em;color:` + ink + `">Helvetly</span></a>` +
		`</td></tr>` + "\n" +
		`<tr><td class="card" bgcolor="#ffffff" style="background:#ffffff;border:1px solid ` + border + `;border-radius:12px;padding:32px;` +
		`font-family:` + fonts + `;font-size:15px;line-height:1.6;color:` + text + `">` + "\n" +
		m.HTML + "\n</td></tr>\n" +
		`<tr><td style="padding:20px 4px 0;font-family:` + fonts + `;font-size:12px;line-height:1.6;color:` + muted + `">` + footer + `</td></tr>` + "\n" +
		`</table><!--[if mso]></td></tr></table><![endif]-->` + "\n" +
		`</td></tr></table></body></html>`
}
