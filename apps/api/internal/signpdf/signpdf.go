// Package signpdf finishes a signed contract: the original pages with every field stamped at its place, and a
// certificate of completion appended (docs/signatures-contract.md).
package signpdf

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"
	"codeberg.org/go-pdf/fpdf/contrib/gofpdi"

	"helvetly.com/api/internal/pdffont"
)

// Field is a filled box; X, Y, W, H are fractions of the page from its top-left corner.
type Field struct {
	Page       int
	Kind       string // signature | date | name | text
	X, Y, W, H float64
	Value      string // date, name or text
	Image      []byte // signature: a PNG
}

type Signer struct {
	Name, Email, IP, UserAgent string
	Method                     string // typed | drawn
	Viewed, Signed             time.Time
}

type Certificate struct {
	RequestID, Title, Sender, Workspace string
	Zone                                *time.Location // the workspace's time zone, for every time shown
	OriginalSHA256, AuditHash           string
	Consent                             string
	Created, Completed                  time.Time
	Signers                             []Signer
}

const box = "/MediaBox"

// PageCount opens the PDF the way Stamp will, so a file it can't read (encrypted, broken) is refused when the
// request is created rather than when the last person signs.
func PageCount(original []byte) (n int, err error) {
	defer recoverInto(&err)
	imp := gofpdi.NewImporter()
	pdf := fpdf.New("P", "pt", "A4", "")
	rs := io.ReadSeeker(bytes.NewReader(original))
	imp.ImportPageFromStream(pdf, &rs, 1, box)
	if err := pdf.Error(); err != nil {
		return 0, err
	}
	return len(imp.GetPageSizes()), nil
}

// gofpdi panics on PDFs it can't parse.
func recoverInto(err *error) {
	if p := recover(); p != nil {
		*err = fmt.Errorf("pdf: %v", p)
	}
}

// Stamp returns the finished PDF: each page of the original, the fields drawn on top, then the certificate.
func Stamp(original []byte, fields []Field, cert Certificate) (out []byte, err error) {
	defer recoverInto(&err)
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.SetTitle(cert.Title+" – signed", true)
	pdf.SetCreationDate(cert.Completed)
	pdf.SetModificationDate(cert.Completed)
	txt := pdffont.New(pdf)
	pages(pdf, original, func(page int, w, h float64) {
		for i, f := range fields {
			if f.Page == page {
				drawField(pdf, txt, f, w, h, "f"+strconv.Itoa(i))
			}
		}
	})
	certificate(pdf, txt, cert)
	return output(pdf)
}

// Text is a box of a template filled in (docs/templates-contract.md); X, Y, W, H as in Field, "\n" breaks lines.
type Text struct {
	Page       int
	X, Y, W, H float64
	Value      string
}

// Fill returns the original with each text written into its box: Liberation Sans (any script through pdffont's
// fallbacks), black, sized by drawLines.
func Fill(original []byte, texts []Text, title string) (out []byte, err error) {
	defer recoverInto(&err)
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.SetTitle(title, true)
	txt := pdffont.New(pdf)
	pdf.SetCellMargin(0) // the text starts at the box's edge, as in the preview
	pages(pdf, original, func(page int, w, h float64) {
		for _, t := range texts {
			if t.Page == page && strings.TrimSpace(t.Value) != "" {
				drawLines(pdf, txt, t.Value, t.X*w, t.Y*h, t.W*w, t.H*h)
			}
		}
	})
	return output(pdf)
}

// pages copies each page of the original into pdf and calls draw on it.
func pages(pdf *fpdf.Fpdf, original []byte, draw func(page int, w, h float64)) {
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetCreator("Helvetly", true)
	imp := gofpdi.NewImporter()
	rs := io.ReadSeeker(bytes.NewReader(original))
	first := imp.ImportPageFromStream(pdf, &rs, 1, box)
	sizes := imp.GetPageSizes()
	for page := 1; page <= len(sizes); page++ {
		tpl := first
		if page > 1 {
			tpl = imp.ImportPageFromStream(pdf, &rs, page, box)
		}
		w, h := sizes[page][box]["w"], sizes[page][box]["h"]
		pdf.AddPageFormat(orientation(w, h), fpdf.SizeType{Wd: w, Ht: h})
		imp.UseImportedTemplate(pdf, tpl, 0, 0, w, h)
		draw(page, w, h)
	}
}

func output(pdf *fpdf.Fpdf) ([]byte, error) {
	var b bytes.Buffer
	if err := pdf.Output(&b); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// Text sizes of a filled box (the platform's fitFontSize in lib/template-text.ts follows the same rule).
const (
	heightRatio = 0.75 // of a line's share of the box height
	leading     = 1.15
	minSize     = 4.0
)

// fitSize: the font size of lines in a w × h box, the widest line widest wide at size 1: the box height sets it,
// a line wider than the box shrinks it, never below minSize.
func fitSize(w, h float64, lines int, widest float64) float64 {
	size := h / float64(max(lines, 1)) * heightRatio
	if widest > 0 {
		size = min(size, w/widest)
	}
	return max(size, minSize)
}

// drawLines writes text into the box like print on the page: black, left aligned, vertically centred, at fitSize.
func drawLines(pdf *fpdf.Fpdf, txt *pdffont.Text, text string, x, y, w, h float64) {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	txt.Font("", 1)
	widest := 0.0
	for _, l := range lines {
		widest = max(widest, txt.Width(l))
	}
	size := fitSize(w, h, len(lines), widest)
	txt.Font("", size)
	pdf.SetTextColor(0, 0, 0)
	lh := size * leading
	top := y + (h-lh*float64(len(lines)))/2
	for i, l := range lines {
		pdf.SetXY(x, top+lh*float64(i))
		txt.Cell(w, lh, l, "LM")
	}
}

func orientation(w, h float64) string {
	if w > h {
		return "L"
	}
	return "P"
}

func drawField(pdf *fpdf.Fpdf, txt *pdffont.Text, f Field, pw, ph float64, name string) {
	x, y, w, h := f.X*pw, f.Y*ph, f.W*pw, f.H*ph
	if f.Kind == "signature" {
		if http.DetectContentType(f.Image) != "image/png" {
			return
		}
		info := pdf.RegisterImageOptionsReader(name, fpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(f.Image))
		if info == nil || info.Width() == 0 || info.Height() == 0 {
			return
		}
		// Fit the image into the box, keeping its aspect ratio, bottom-left aligned like a hand on a line.
		scale := min(w/info.Width(), h/info.Height())
		iw, ih := info.Width()*scale, info.Height()*scale
		pdf.ImageOptions(name, x, y+h-ih, iw, ih, false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
		return
	}
	size := min(max(h*0.6, 7), 12)
	txt.Font("", size)
	pdf.SetTextColor(20, 20, 20)
	for size > 5 && txt.Width(f.Value) > w {
		size -= 0.5
		txt.Font("", size)
	}
	pdf.SetXY(x, y)
	txt.Cell(w, h, f.Value, "LM")
}

// ---- the certificate of completion ----

func when(t time.Time, zone *time.Location) string {
	if t.IsZero() {
		return "–"
	}
	return t.In(zone).Format("02.01.2006 15:04:05 MST")
}

func certificate(pdf *fpdf.Fpdf, txt *pdffont.Text, c Certificate) {
	pdf.AddPageFormat("P", fpdf.SizeType{Wd: 595.28, Ht: 841.89})
	const left, width = 56.0, 483.28
	y := 64.0
	// lines writes s wrapped to width w from (x, y) and returns the y below it, as MultiCell would.
	lines := func(x, w, lh float64, s string) float64 {
		ly := y
		for _, l := range txt.Wrap(s, w) {
			pdf.SetXY(x, ly)
			txt.Cell(w, lh, l, "L")
			ly += lh
		}
		return ly
	}
	text := func(style string, size float64, s string, r, g, b int) {
		txt.Font(style, size)
		pdf.SetTextColor(r, g, b)
		y = lines(left, width, size*1.35, s)
	}
	row := func(label, value string) {
		txt.Font("", 8.5)
		pdf.SetTextColor(110, 110, 110)
		pdf.SetXY(left, y)
		txt.Cell(120, 12, label, "L")
		pdf.SetTextColor(20, 20, 20)
		y = lines(left+120, width-120, 12, value) + 1
	}
	rule := func() {
		y += 8
		pdf.SetDrawColor(225, 225, 225)
		pdf.SetLineWidth(0.6)
		pdf.Line(left, y, left+width, y)
		y += 12
	}

	text("B", 18, "Certificate of completion", 20, 20, 20)
	y += 4
	text("", 9, "Simple electronic signature (SES) under the Swiss ZertES and the EU eIDAS Regulation. "+
		"Every signer was sent a personal link by email and confirmed their consent to sign electronically.", 90, 90, 90)
	rule()
	row("Document", c.Title)
	row("Request", c.RequestID)
	row("Sent by", strings.TrimSpace(c.Sender+" · "+c.Workspace))
	row("Sent", when(c.Created, c.Zone))
	row("Completed", when(c.Completed, c.Zone))
	row("Original SHA-256", c.OriginalSHA256)
	row("Audit trail SHA-256", c.AuditHash)
	row("This file", "Its SHA-256 is recorded with the request and sent with the completion email.")
	rule()
	text("B", 11, "Signers", 20, 20, 20)
	y += 6
	for i, s := range c.Signers {
		if y > 700 {
			pdf.AddPageFormat("P", fpdf.SizeType{Wd: 595.28, Ht: 841.89})
			y = 64
		}
		text("B", 9.5, fmt.Sprintf("%d. %s", i+1, s.Name), 20, 20, 20)
		y += 2
		row("Email", s.Email)
		row("Signature", map[string]string{"typed": "Typed name, rendered in a script font", "drawn": "Drawn by hand"}[s.Method])
		row("Viewed", when(s.Viewed, c.Zone))
		row("Signed", when(s.Signed, c.Zone))
		row("IP address", s.IP)
		row("Device", s.UserAgent)
		y += 8
	}
	rule()
	text("B", 9, "Consent given by each signer", 20, 20, 20)
	y += 2
	text("", 8.5, c.Consent, 90, 90, 90)
	y += 10
	text("", 7.5, "Times are "+c.Zone.String()+". Generated by Helvetly.", 140, 140, 140)
}
