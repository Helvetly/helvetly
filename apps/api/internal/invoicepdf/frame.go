package invoicepdf

import (
	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/pdffont"
	"helvetly.com/api/internal/store"
)

// Frame draws on another document (a contract written from a quote) what quotes and invoices print, so both look
// alike: the logo top left with the title and details top right, the two parties under bold headings, and each
// page's footer (the issuer's contact line and the page number). pageH is the page's height in mm (A4 or Letter):
// the footer keeps its distance from the bottom edge.
type Frame struct {
	r      *renderer
	offset float64
}

// NewFrame draws with pdf and txt in lang (English when invoices have no labels for it).
func NewFrame(pdf *fpdf.Fpdf, txt *pdffont.Text, lang string, logo []byte, pageH float64) *Frame {
	l, ok := languages[lang]
	if !ok {
		lang, l = "en", languages["en"]
	}
	d := Document{Logo: logo}
	d.Invoice.Language = lang
	return &Frame{r: &renderer{pdf: pdf, txt: txt, l: l, d: d, bottom: pageBottom}, offset: 297 - pageH}
}

// Header draws the logo and, right-aligned, the title and its label: value pairs; it returns the y below them.
func (f *Frame) Header(title string, meta [][2]string) float64 { return f.r.header(title, meta) }

// Parties draws the two parties from y under their headings and returns the y below the longer column.
func (f *Frame) Parties(y float64, leftHeading, rightHeading string, a, b store.Party) float64 {
	return f.r.partiesUnder(y, leftHeading, rightHeading, a, b)
}

// Footer prints the contact line and the page text ("Page 1 of 2") as invoices do; call it from the footer func.
func (f *Frame) Footer(contact, page string) {
	r := f.r
	r.set("", 8)
	r.pdf.SetTextColor(110, 110, 110)
	if contact != "" {
		r.cell(left, contactY-f.offset, contentW, 4, contact, "C")
	}
	r.cell(left, pageNoY-f.offset, contentW, 4, page, "C")
	r.pdf.SetTextColor(0, 0, 0)
}

// ContactLine: the issuer's email, phone and website as the footer prints them.
func ContactLine(email, phone, website *string) string { return contactLine(email, phone, website) }
