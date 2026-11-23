// Package contractpdf renders a contract written from a quote in the format of quotes and invoices (invoicepdf's
// Frame: logo and seller, the parties, the footer with contact line and page numbers): the title, the quote's
// services and payment schedule as tables, numbered clauses with a hanging indent and the signature block, two
// columns where each party signs. Everything is drawn from the Document as given, so the same reviewed sections
// always print the same contract. A4, or US Letter under US law (contractlaw).
package contractpdf

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg" // signature sizes
	_ "image/png"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/contractlaw"
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

// Signer: who signs for a party, printed under the signature line (the company below the name).
type Signer struct {
	Name    string `json:"name"`
	Company string `json:"company"`
}

// Signed is the contractor's stored signature, applied when the contract is made: its image, place and date (ISO).
type Signed struct {
	Image []byte `json:"-"` // PNG or JPEG
	Place string `json:"place"`
	Date  string `json:"date"`
}

// Document: display-ready strings except dates (ISO yyyy-mm-dd). Totals print only when not empty.
type Document struct {
	Language     string      `json:"language"`
	Law          string      `json:"law"` // contractlaw code; "" is Swiss law
	Seller       store.Party `json:"seller"`
	Phone        *string     `json:"phone,omitempty"`
	Website      *string     `json:"website,omitempty"`
	Client       store.Party `json:"client"`
	Logo         []byte      `json:"-"`      // PNG or JPEG, nil for none
	Number       string      `json:"number"` // the contract's number; empty prints "Draft"
	Quote        string      `json:"quote"`  // the quote's number
	Date         string      `json:"date"`
	Title        string      `json:"title"`
	Intro        string      `json:"intro"`
	Rows         []Row       `json:"rows"`
	Subtotal     string      `json:"subtotal"`
	Discount     string      `json:"discount"`
	VAT          string      `json:"vat"`
	Total        string      `json:"total"`
	Schedule     []Payment   `json:"schedule"`
	Clauses      []Clause    `json:"clauses"`
	SellerSigner Signer      `json:"seller_signer"`
	ClientSigner Signer      `json:"client_signer"`
	SellerSigned *Signed     `json:"seller_signed,omitempty"` // nil: the contractor signs later
}

// Box is a signature field's place, in fractions of the page as signatures expect.
type Box struct {
	Page       int
	X, Y, W, H float64
}

// Result: the PDF and where each party signs; ClientDate is the client's date field on the "Place, date" line.
type Result struct {
	PDF                        []byte
	Pages                      int
	Seller, Client, ClientDate Box
}

const (
	left, right, contentW = 20.0, 190.0, 170.0
	top                   = 18.0
	indent                = 8.0 // a clause's text hangs right of its number
	lineH                 = 4.7
	bodySize              = 9.5
	gap                   = 3.5 // between blocks: paragraphs' rhythm is lineH, a block's is this
)

type renderer struct {
	pdf          *fpdf.Fpdf
	txt          *pdffont.Text
	frame        *invoicepdf.Frame
	l            labels
	d            Document
	date         string // layout of the law's dates
	pageW, pageH float64
	bottom       float64
}

// Render returns the PDF and where the parties sign; an error means it must not be shipped.
func Render(d Document) (Result, error) {
	l, ok := languages[d.Language]
	if !ok {
		return Result{}, fmt.Errorf("contract pdf: no labels for language %q", d.Language)
	}
	law, ok := contractlaw.Lookup(d.Law)
	if !ok {
		law, _ = contractlaw.Lookup("CH")
	}
	pdf := fpdf.New("P", "mm", contractlaw.PageSize(law), "")
	pdf.SetCompression(false) // small documents; keeps the text greppable in tests
	pdf.SetCatalogSort(true)  // fonts in a fixed order, so the same sections print the same bytes
	if t, err := time.Parse(time.DateOnly, d.Date); err == nil {
		pdf.SetCreationDate(t)
		pdf.SetModificationDate(t)
	}
	pageW, pageH := pdf.GetPageSize()
	pdf.SetMargins(left, top, pageW-right)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetTitle(d.Title, true)
	pdf.SetAuthor(d.Seller.Name, true)
	txt := pdffont.New(pdf)
	r := &renderer{pdf: pdf, txt: txt, frame: invoicepdf.NewFrame(pdf, txt, d.Language, d.Logo, pageH), l: l, d: d,
		date: contractlaw.FormatFor(law, d.Language).Date, pageW: pageW, pageH: pageH, bottom: pageH - 27}
	number := d.Number
	if number == "" {
		number = l.Draft
	}
	contact := invoicepdf.ContactLine(d.Seller.Email, d.Phone, d.Website)
	pdf.SetFooterFunc(func() {
		r.frame.Footer(contact, l.Title+" "+number+"  ·  "+fmt.Sprintf(l.Page, pdf.PageNo()))
	})
	pdf.AddPage()
	meta := [][2]string{{l.Date, r.civil(d.Date)}}
	if d.Quote != "" {
		meta = append(meta, [2]string{l.Quote, d.Quote})
	}
	y := r.frame.Header(l.Title+" "+number, meta)
	y = r.title(max(y+8, 45))
	y = r.frame.Parties(y, l.Seller, l.Client, d.Seller, d.Client) + gap*2
	if strings.TrimSpace(d.Intro) != "" {
		y = r.paragraphs(y, left, contentW, d.Intro) + gap
	}
	y = r.services(y + gap)
	y = r.schedule(y)
	for i, c := range d.Clauses {
		y = r.clause(y+gap, i+1, c)
	}
	res := r.signatures(y + gap*3)
	pdf.RegisterAlias("{nb}", strconv.Itoa(pdf.PageNo()))
	res.Pages = pdf.PageNo()
	var out bytes.Buffer
	if err := pdf.Output(&out); err != nil {
		return Result{}, fmt.Errorf("contract pdf: %w", err)
	}
	res.PDF = out.Bytes()
	return res, nil
}

func (r *renderer) set(style string, size float64) { r.txt.Font(style, size) }

func (r *renderer) cell(x, y, w, h float64, s, align string) {
	r.pdf.SetXY(x, y)
	r.txt.Cell(w, h, s, align)
}

func (r *renderer) grey(on bool) {
	if on {
		r.pdf.SetTextColor(90, 90, 90)
	} else {
		r.pdf.SetTextColor(0, 0, 0)
	}
}

// room starts a new page when h more millimetres do not fit below y, and returns where to draw.
func (r *renderer) room(y, h float64) float64 {
	if y+h <= r.bottom {
		return y
	}
	r.pdf.AddPage()
	return top
}

func (r *renderer) lines(s, style string, size, w float64) []string {
	r.set(style, size)
	return r.txt.Wrap(strings.TrimSpace(s), w)
}

// paragraphs wraps s (paragraphs split by a blank line) at x over w, page by page; returns the y below it.
func (r *renderer) paragraphs(y, x, w float64, s string) float64 {
	for i, para := range strings.Split(strings.TrimSpace(s), "\n\n") {
		if i > 0 {
			y += lineH / 2
		}
		for _, line := range r.lines(para, "", bodySize, w) {
			y = r.room(y, lineH)
			r.set("", bodySize) // the footer of a new page changed it
			r.cell(x, y, w, lineH, line, "L")
			y += lineH
		}
	}
	return y
}

func (r *renderer) civil(iso string) string {
	if t, err := time.Parse(time.DateOnly, iso); err == nil {
		return t.Format(r.date)
	}
	return iso
}

// title: the contract's own title, large, under the header.
func (r *renderer) title(y float64) float64 {
	for _, line := range r.lines(r.d.Title, "B", 15, contentW) {
		r.cell(left, y, contentW, 7, line, "L")
		y += 7
	}
	return y + gap
}

func nonEmpty(s []string) []string {
	return slices.DeleteFunc(s, func(v string) bool { return strings.TrimSpace(v) == "" })
}

const descW, qtyW, priceW, amountW = 92.0, 20.0, 29.0, 29.0

// heading: a block's bold heading, kept on the page with keep more millimetres of what follows.
func (r *renderer) heading(y, keep float64, s string) float64 {
	y = r.room(y, 7+keep)
	r.set("B", 10.5)
	r.cell(left, y, contentW, 6, s, "L")
	return y + 7.5
}

func (r *renderer) tableHead(y float64, cols [][2]string, widths []float64) float64 {
	r.set("B", 8.5)
	r.grey(true)
	x := left
	for i, c := range cols {
		r.cell(x, y, widths[i], 5, c[0], c[1])
		x += widths[i]
	}
	r.grey(false)
	r.pdf.SetDrawColor(170, 170, 170)
	r.pdf.SetLineWidth(0.2)
	r.pdf.Line(left, y+5.5, right, y+5.5)
	return y + 7.5
}

// services: the quote's lines and totals, as the quote has them.
func (r *renderer) services(y float64) float64 {
	d := r.d
	if len(d.Rows) == 0 {
		return y
	}
	y = r.heading(y, 7.5+2*lineH, r.l.Services)
	cols := [][2]string{{r.l.Description, "L"}, {r.l.Quantity, "R"}, {r.l.UnitPrice, "R"}, {r.l.Amount, "R"}}
	widths := []float64{descW, qtyW, priceW, amountW}
	y = r.tableHead(y, cols, widths)
	for _, row := range d.Rows {
		desc := r.lines(row.Description, "", 9, descW-3)
		h := float64(max(len(desc), 1)) * lineH
		if y+h > r.bottom {
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
		y += h + 1.5
	}
	totals := [][2]string{{r.l.Subtotal, d.Subtotal}, {r.l.Discount, d.Discount}, {r.l.VAT, d.VAT}, {r.l.Total, d.Total}}
	totals = slices.DeleteFunc(totals, func(t [2]string) bool { return t[1] == "" })
	y = r.room(y+0.5, float64(len(totals))*5.5+2)
	r.pdf.Line(left+descW, y, right, y) // the totals start under the Qty column
	y += 2
	for i, t := range totals {
		r.set(map[bool]string{true: "B", false: ""}[i == len(totals)-1], 9.5)
		r.cell(left+descW, y, right-35-left-descW, 5, t[0], "L")
		r.cell(right-35, y, 35, 5, t[1], "R")
		y += 5.5
	}
	return y + gap
}

// schedule: the quote's instalments, when it has them.
func (r *renderer) schedule(y float64) float64 {
	if len(r.d.Schedule) == 0 {
		return y
	}
	y = r.heading(y+gap, 7.5+lineH, r.l.Schedule)
	cols := [][2]string{{"#", "L"}, {r.l.Due, "L"}, {r.l.Amount, "R"}}
	widths := []float64{12, 60, 98}
	y = r.tableHead(y, cols, widths)
	for i, p := range r.d.Schedule {
		if y+lineH > r.bottom {
			r.pdf.AddPage()
			y = r.tableHead(top, cols, widths)
		}
		r.set("", 9)
		r.cell(left, y, 12, lineH, strconv.Itoa(i+1), "L")
		r.cell(left+12, y, 60, lineH, r.civil(p.Due), "L")
		r.cell(left+72, y, 98, lineH, p.Amount, "R")
		y += lineH + 1
	}
	return y + gap
}

// clause: "n." in the margin, its heading and paragraphs hanging right of it; the heading never ends a page alone.
func (r *renderer) clause(y float64, n int, c Clause) float64 {
	heading := r.lines(strings.TrimSpace(c.Heading), "B", 10.5, contentW-indent)
	y = r.room(y, float64(len(heading))*5.5+2*lineH+1)
	r.set("B", 10.5)
	r.cell(left, y, indent, 5.5, strconv.Itoa(n)+".", "L")
	for _, line := range heading {
		r.cell(left+indent, y, contentW-indent, 5.5, line, "L")
		y += 5.5
	}
	return r.paragraphs(y+1, left+indent, contentW-indent, c.Body)
}

// Signature block measures, in mm.
const (
	sigColW  = 78.0 // each party's column
	sigGapX  = 14.0 // between the columns
	sigAreaH = 20.0 // where the signature goes, above its line
	sigBoxW  = 62.0 // the signature field
	blockH   = 54.0 // heading, label, area, line, name, company, place and date
)

func logoType(b []byte) string {
	switch http.DetectContentType(b) {
	case "image/png":
		return "PNG"
	case "image/jpeg":
		return "JPG"
	}
	return ""
}

// signatures draws the block, never split over two pages: each party's label, the area where it signs above a line,
// the signer's name in bold, the company, and "Place, date". The contractor's stored signature, place and date are
// printed when applied. It returns where the fields go.
func (r *renderer) signatures(y float64) Result {
	y = r.room(y, blockH)
	y = r.heading(y, 0, r.l.Signatures)
	var res Result
	page := r.pdf.PageNo()
	box := func(x, y, w, h float64) Box {
		return Box{Page: page, X: x / r.pageW, Y: y / r.pageH, W: w / r.pageW, H: h / r.pageH}
	}
	column := func(x float64, role string, who Signer, party store.Party, signed *Signed) (sig, date Box) {
		r.set("", 8.5)
		r.grey(true)
		r.cell(x, y, sigColW, lineH, role, "L")
		r.grey(false)
		areaY := y + lineH + 1
		if signed != nil && logoType(signed.Image) != "" {
			r.signatureImage(x, areaY, signed.Image)
		}
		lineY := areaY + sigAreaH
		r.pdf.SetDrawColor(120, 120, 120)
		r.pdf.SetLineWidth(0.25)
		r.pdf.Line(x, lineY, x+sigColW, lineY)
		name, company := strings.TrimSpace(who.Name), strings.TrimSpace(who.Company)
		if name == "" {
			name, company = party.Name, ""
		}
		yy := lineY + 1.5
		r.set("B", 9.5)
		r.cell(x, yy, sigColW, lineH, name, "L")
		yy += lineH
		if company != "" && company != name {
			r.set("", 8.5)
			r.grey(true)
			r.cell(x, yy, sigColW, lineH, company, "L")
			r.grey(false)
		}
		yy += lineH + 2.5
		r.set("", 9)
		label := r.l.Place + ": "
		r.cell(x, yy, sigColW, lineH, label, "L")
		valueX := x + r.txt.Width(label) + 1
		if signed != nil {
			r.cell(valueX, yy, x+sigColW-valueX, lineH, strings.Join(nonEmpty([]string{signed.Place, r.civil(signed.Date)}), ", "), "L")
		} else {
			r.pdf.SetDrawColor(170, 170, 170)
			r.pdf.Line(valueX, yy+lineH, x+sigColW, yy+lineH)
		}
		dateW := min(32.0, x+sigColW-valueX)
		return box(x, areaY+1, sigBoxW, sigAreaH-2), box(x+sigColW-dateW, yy-0.8, dateW, lineH+1.2)
	}
	res.Seller, _ = column(left, r.l.Seller, r.d.SellerSigner, r.d.Seller, r.d.SellerSigned)
	res.Client, res.ClientDate = column(left+sigColW+sigGapX, r.l.Client, r.d.ClientSigner, r.d.Client, nil)
	return res
}

// signatureImage fits the stored signature into the signature area, bottom left, never enlarged past 96 dpi.
func (r *renderer) signatureImage(x, y float64, img []byte) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(img))
	if err != nil || cfg.Width == 0 || cfg.Height == 0 {
		return
	}
	const mmPerPixel = 25.4 / 96
	w, h := float64(cfg.Width)*mmPerPixel, float64(cfg.Height)*mmPerPixel
	scale := min(sigBoxW/w, (sigAreaH-2)/h, 1)
	opts := fpdf.ImageOptions{ImageType: logoType(img)}
	r.pdf.RegisterImageOptionsReader("signature", opts, bytes.NewReader(invoicepdf.OnWhite(img)))
	r.pdf.ImageOptions("signature", x, y+sigAreaH-h*scale-0.5, w*scale, h*scale, false, opts, 0, "")
}
