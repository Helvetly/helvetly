// Package contractpdf renders a contract written from a quote as an A4 PDF: the seller's header (logo, details), the
// parties, the quote's services and payment schedule as tables, numbered clauses and a signature block. Everything is
// drawn from the Document as given, so the same reviewed sections always print the same contract.
package contractpdf

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg" // logo sizes
	_ "image/png"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/pdffont"
	"helvetly.com/api/internal/store"
)

// Row is one line of the quote, display-ready ("CHF 1'200.00").
type Row struct {
	Description string `json:"description"`
	Quantity    string `json:"quantity"`
	UnitPrice   string `json:"unit_price"`
	Amount      string `json:"amount"`
}

// Payment is one instalment: its due date (ISO) and amount, display-ready.
type Payment struct {
	Due    string `json:"due"`
	Amount string `json:"amount"`
}

// Clause is one numbered section of the contract's text.
type Clause struct {
	Heading string `json:"heading"`
	Body    string `json:"body"`
}

// Document: display-ready strings except dates (ISO yyyy-mm-dd). Totals print only when not empty.
type Document struct {
	Language string      `json:"language"`
	Seller   store.Party `json:"seller"`
	Client   store.Party `json:"client"`
	Logo     []byte      `json:"-"`      // PNG or JPEG, nil for none
	Number   string      `json:"number"` // the contract's number; empty prints "Draft"
	Quote    string      `json:"quote"`  // the quote's number
	Date     string      `json:"date"`
	Title    string      `json:"title"`
	Intro    string      `json:"intro"`
	Rows     []Row       `json:"rows"`
	Subtotal string      `json:"subtotal"`
	Discount string      `json:"discount"`
	VAT      string      `json:"vat"`
	Total    string      `json:"total"`
	Schedule []Payment   `json:"schedule"`
	Clauses  []Clause    `json:"clauses"`
}

// Box is a signature field's place, in fractions of the page as signatures expect.
type Box struct {
	Page       int
	X, Y, W, H float64
}

type Result struct {
	PDF            []byte
	Pages          int
	Seller, Client Box // where each party signs
}

const (
	left, right, contentW = 20.0, 190.0, 170.0
	top, bottom           = 18.0, 272.0
	pageW, pageH          = 210.0, 297.0
	logoMaxW, logoMaxH    = 75.0, 18.0
	logoGap               = 10.0
	mmPerPixel            = 25.4 / 96
	lineH                 = 4.6
)

type renderer struct {
	pdf *fpdf.Fpdf
	txt *pdffont.Text
	l   labels
	d   Document
}

// Render returns the PDF and where the parties sign; an error means it must not be shipped.
func Render(d Document) (Result, error) {
	l, ok := languages[d.Language]
	if !ok {
		return Result{}, fmt.Errorf("contract pdf: no labels for language %q", d.Language)
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetCompression(false) // small documents; keeps the text greppable in tests
	if t, err := time.Parse(time.DateOnly, d.Date); err == nil {
		pdf.SetCreationDate(t)
		pdf.SetModificationDate(t)
	}
	pdf.SetMargins(left, top, pageW-right)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetTitle(d.Title, true)
	pdf.SetAuthor(d.Seller.Name, true)
	r := &renderer{pdf: pdf, txt: pdffont.New(pdf), l: l, d: d}
	number := d.Number
	if number == "" {
		number = l.Draft
	}
	pdf.SetFooterFunc(func() {
		r.set("", 8)
		pdf.SetTextColor(110, 110, 110)
		r.cell(left, 284, contentW/2, 4, l.Title+" "+number, "L")
		r.cell(left+contentW/2, 284, contentW/2, 4, fmt.Sprintf(l.Page, pdf.PageNo()), "R")
		pdf.SetTextColor(0, 0, 0)
	})
	pdf.AddPage()
	y := r.header()
	y = r.parties(y)
	if strings.TrimSpace(d.Intro) != "" {
		y = r.text(y+2, d.Intro, "", 9.5)
	}
	y = r.services(y + 4)
	y = r.schedule(y)
	for i, c := range d.Clauses {
		y = r.clause(y+3, i+1, c)
	}
	seller, client := r.signatures(y + 8)
	pdf.RegisterAlias("{nb}", strconv.Itoa(pdf.PageNo()))
	pages := pdf.PageNo()
	var out bytes.Buffer
	if err := pdf.Output(&out); err != nil {
		return Result{}, fmt.Errorf("contract pdf: %w", err)
	}
	return Result{PDF: out.Bytes(), Pages: pages, Seller: seller, Client: client}, nil
}

func (r *renderer) set(style string, size float64) { r.txt.Font(style, size) }

func (r *renderer) cell(x, y, w, h float64, s, align string) {
	r.pdf.SetXY(x, y)
	r.txt.Cell(w, h, s, align)
}

// room starts a new page when h more millimetres do not fit below y, and returns where to draw.
func (r *renderer) room(y, h float64) float64 {
	if y+h <= bottom {
		return y
	}
	r.pdf.AddPage()
	return top
}

// text wraps s over the content width, page by page, and returns the y below it.
func (r *renderer) text(y float64, s, style string, size float64) float64 {
	for _, line := range r.lines(s, style, size, contentW) {
		y = r.room(y, lineH)
		r.set(style, size) // the footer of a new page changed it
		r.cell(left, y, contentW, lineH, line, "L")
		y += lineH
	}
	return y
}

func (r *renderer) lines(s, style string, size, w float64) []string {
	r.set(style, size)
	return r.txt.Wrap(strings.TrimSpace(s), w)
}

func swissDate(d string) string {
	if t, err := time.Parse(time.DateOnly, d); err == nil {
		return t.Format("02.01.2006")
	}
	return d
}

func logoType(b []byte) string {
	switch http.DetectContentType(b) {
	case "image/png":
		return "PNG"
	case "image/jpeg":
		return "JPG"
	}
	return ""
}

func nonEmpty(s []string) []string {
	return slices.DeleteFunc(s, func(v string) bool { return strings.TrimSpace(v) == "" })
}

// partyLines: name, street, city, UID and email of a party, those it has.
func partyLines(p store.Party) []string {
	lines := []string{p.Name, p.StreetLine(), strings.TrimSpace(p.Zip + " " + p.City)}
	if p.VATNumber != nil {
		lines = append(lines, *p.VATNumber)
	}
	if p.Email != nil {
		lines = append(lines, *p.Email)
	}
	return nonEmpty(lines)
}

// header draws the logo and the seller's block, then the title and the contract's details; returns the y below.
func (r *renderer) header() float64 {
	p, d := r.pdf, r.d
	info := partyLines(d.Seller)
	if len(info) > 0 && info[0] == d.Seller.Name {
		info = info[1:]
	}
	sellerX, align := left, "L"
	if d.Logo != nil && logoType(d.Logo) != "" {
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(d.Logo)); err == nil {
			r.set("B", 11)
			text := r.txt.Width(d.Seller.Name)
			r.set("", 8.5)
			for _, s := range info {
				text = max(text, r.txt.Width(s))
			}
			maxW := min(max(right-text-logoGap-left, 45), logoMaxW)
			opts := fpdf.ImageOptions{ImageType: logoType(d.Logo)}
			p.RegisterImageOptionsReader("logo", opts, bytes.NewReader(invoicepdf.OnWhite(d.Logo)))
			w, h := float64(cfg.Width)*mmPerPixel, float64(cfg.Height)*mmPerPixel
			scale := min(maxW/w, logoMaxH/h, 1)
			p.ImageOptions("logo", left, 15, w*scale, h*scale, false, opts, 0, "")
			sellerX, align = max(90, left+w*scale+logoGap), "R"
		}
	}
	r.set("B", 11)
	r.cell(sellerX, 15, right-sellerX, 5, d.Seller.Name, align)
	r.set("", 8.5)
	y := 20.5
	for _, s := range info {
		r.cell(sellerX, y, right-sellerX, 3.8, s, align)
		y += 3.8
	}

	y = max(y, 33) + 8
	for _, line := range r.lines(d.Title, "B", 16, contentW) {
		r.cell(left, y, contentW, 7.5, line, "L")
		y += 7.5
	}
	number := d.Number
	if number == "" {
		number = r.l.Draft
	}
	meta := []string{r.l.Number + ": " + number, r.l.Date + ": " + swissDate(d.Date)}
	if d.Quote != "" {
		meta = append(meta, r.l.Quote+": "+d.Quote)
	}
	r.set("", 9)
	p.SetTextColor(90, 90, 90)
	r.cell(left, y+1, contentW, lineH, strings.Join(meta, "   ·   "), "L")
	p.SetTextColor(0, 0, 0)
	return y + 9
}

// parties: "between" the seller (contractor) "and" the client, side by side.
func (r *renderer) parties(y float64) float64 {
	r.set("", 9)
	r.cell(left, y, contentW, lineH, r.l.Between, "L")
	y += lineH + 1
	half := contentW/2 - 4
	block := func(x float64, p store.Party, role string) float64 {
		yy := y
		for i, s := range partyLines(p) {
			r.set(map[bool]string{true: "B", false: ""}[i == 0], 9.5)
			r.cell(x, yy, half, lineH, s, "L")
			yy += lineH
		}
		r.set("", 8.5)
		r.cell(x, yy, half, lineH, "("+role+")", "L")
		return yy + lineH
	}
	end := max(block(left, r.d.Seller, r.l.Seller), block(left+contentW/2+4, r.d.Client, r.l.Client))
	r.set("", 9)
	r.cell(left+contentW/2-4, y, 8, lineH, r.l.And, "C")
	return end + 2
}

const descW, qtyW, priceW, amountW = 92.0, 20.0, 29.0, 29.0

func (r *renderer) heading(y float64, s string) float64 {
	y = r.room(y, 14)
	r.set("B", 10.5)
	r.cell(left, y, contentW, 6, s, "L")
	return y + 7
}

func (r *renderer) tableHead(y float64, cols [][2]string, widths []float64) float64 {
	r.set("B", 8.5)
	x := left
	for i, c := range cols {
		r.cell(x, y, widths[i], 5, c[0], c[1])
		x += widths[i]
	}
	r.pdf.SetDrawColor(150, 150, 150)
	r.pdf.Line(left, y+5.5, right, y+5.5)
	return y + 7
}

// services: the quote's lines and totals, as the quote has them.
func (r *renderer) services(y float64) float64 {
	d := r.d
	if len(d.Rows) == 0 {
		return y
	}
	y = r.heading(y, r.l.Services)
	cols := [][2]string{{r.l.Description, "L"}, {r.l.Quantity, "R"}, {r.l.UnitPrice, "R"}, {r.l.Amount, "R"}}
	widths := []float64{descW, qtyW, priceW, amountW}
	y = r.tableHead(y, cols, widths)
	for _, row := range d.Rows {
		desc := r.lines(row.Description, "", 9, descW-2)
		h := float64(max(len(desc), 1)) * lineH
		if y+h > bottom {
			r.pdf.AddPage()
			y = r.tableHead(top, cols, widths)
		}
		r.set("", 9)
		for i, s := range desc {
			r.cell(left, y+float64(i)*lineH, descW, lineH, s, "L")
		}
		r.cell(left+descW, y, qtyW, lineH, row.Quantity, "R")
		r.cell(left+descW+qtyW, y, priceW, lineH, row.UnitPrice, "R")
		r.cell(left+descW+qtyW+priceW, y, amountW, lineH, row.Amount, "R")
		y += h + 1
	}
	totals := [][2]string{{r.l.Subtotal, d.Subtotal}, {r.l.Discount, d.Discount}, {r.l.VAT, d.VAT}, {r.l.Total, d.Total}}
	totals = slices.DeleteFunc(totals, func(t [2]string) bool { return t[1] == "" })
	y = r.room(y+1, float64(len(totals))*5+2)
	r.pdf.Line(right-80, y, right, y)
	y += 1.5
	for i, t := range totals {
		r.set(map[bool]string{true: "B", false: ""}[i == len(totals)-1], 9.5)
		r.cell(right-80, y, 45, 5, t[0], "L")
		r.cell(right-35, y, 35, 5, t[1], "R")
		y += 5
	}
	return y + 2
}

// schedule: the quote's instalments, when it has them.
func (r *renderer) schedule(y float64) float64 {
	if len(r.d.Schedule) == 0 {
		return y
	}
	y = r.heading(y+3, r.l.Schedule)
	cols := [][2]string{{"#", "L"}, {r.l.Due, "L"}, {r.l.Amount, "R"}}
	widths := []float64{12, 60, 98}
	y = r.tableHead(y, cols, widths)
	for i, p := range r.d.Schedule {
		if y+lineH > bottom {
			r.pdf.AddPage()
			y = r.tableHead(top, cols, widths)
		}
		r.set("", 9)
		r.cell(left, y, 12, lineH, strconv.Itoa(i+1), "L")
		r.cell(left+12, y, 60, lineH, swissDate(p.Due), "L")
		r.cell(left+72, y, 98, lineH, p.Amount, "R")
		y += lineH + 0.5
	}
	return y + 2
}

// clause: "n. Heading" and its paragraphs; the heading never ends a page alone.
func (r *renderer) clause(y float64, n int, c Clause) float64 {
	y = r.room(y, 6+2*lineH)
	r.set("B", 10.5)
	heading := strconv.Itoa(n) + ". " + strings.TrimSpace(c.Heading)
	for _, line := range r.lines(heading, "B", 10.5, contentW) {
		r.cell(left, y, contentW, 6, line, "L")
		y += 6
	}
	for i, para := range strings.Split(strings.TrimSpace(c.Body), "\n\n") {
		if i > 0 {
			y += 1.5
		}
		y = r.text(y, para, "", 9.5)
	}
	return y
}

// signatures draws the block (both parties side by side) and returns where each signs.
func (r *renderer) signatures(y float64) (seller, client Box) {
	const boxW, boxH = 70.0, 16.0
	y = r.room(y, 52)
	y = r.heading(y, r.l.Signatures)
	half := contentW/2 - 4
	block := func(x float64, role, name string) Box {
		r.set("", 8.5)
		r.pdf.SetTextColor(90, 90, 90)
		r.cell(x, y, half, lineH, role, "L")
		r.pdf.SetTextColor(0, 0, 0)
		r.cell(x, y+lineH+2, half, lineH, r.l.Place+": ", "L")
		r.pdf.Line(x+r.txt.Width(r.l.Place+": ")+2, y+lineH+6, x+half, y+lineH+6)
		boxY := y + 2*lineH + 6
		r.pdf.Line(x, boxY+boxH, x+boxW, boxY+boxH)
		r.set("B", 9)
		r.cell(x, boxY+boxH+1, half, lineH, name, "L")
		return Box{Page: r.pdf.PageNo(), X: x / pageW, Y: boxY / pageH, W: boxW / pageW, H: boxH / pageH}
	}
	seller = block(left, r.l.Seller, r.d.Seller.Name)
	client = block(left+contentW/2+4, r.l.Client, r.d.Client.Name)
	return seller, client
}
