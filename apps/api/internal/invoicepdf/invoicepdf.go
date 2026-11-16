// Package invoicepdf renders an invoice or credit note as an A4 PDF in its language, with a Swiss QR bill page
// laid out to the SIX implementation guidelines (Swiss Payment Standards 2.3).
package invoicepdf

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // logo sizes
	_ "image/png"
	"net/http"
	"strconv"
	"strings"
	"time"

	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/pdffont"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/swissqr"
)

type Document struct {
	Invoice    store.Invoice // lines, totals, dates, kind, number and payment details
	Seller     store.Party
	Phone      *string
	Buyer      store.Party
	BankName   *string
	Bill       *swissqr.Bill // nil: no QR bill page
	Draft      bool          // watermark the invoice pages; the QR bill page says so above the slip
	Created    time.Time     // the PDF's creation date
	Logo       []byte        // PNG or JPEG (checked with CheckLogo), nil for none
	Refund     bool          // credit note on a paid invoice: its amount is paid back, not offset
	SelfBilled bool          // credit note against a self-billed invoice: printed like one
}

// Logo box on the first page, in mm; a logo is never drawn larger than its pixels at 96 dpi, so a small
// image is not blown up into a blurry one.
const (
	logoMaxW, logoMaxH = 45.0, 18.0
	mmPerPixel         = 25.4 / 96
)

// logoType: the fpdf image type of PNG or JPEG bytes, "" for anything else.
func logoType(b []byte) string {
	switch http.DetectContentType(b) {
	case "image/png":
		return "PNG"
	case "image/jpeg":
		return "JPG"
	}
	return ""
}

// CheckLogo: nil when the image is a PNG or JPEG that fpdf can embed (it refuses, for one, interlaced and
// 16-bit PNGs).
func CheckLogo(b []byte) (err error) {
	defer func() { // fpdf panics on some malformed images instead of returning an error
		if p := recover(); p != nil {
			err = fmt.Errorf("image cannot be embedded: %v", p)
		}
	}()
	t := logoType(b)
	if t == "" {
		return errors.New("not a PNG or JPEG image")
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.RegisterImageOptionsReader("logo", fpdf.ImageOptions{ImageType: t}, bytes.NewReader(b))
	return pdf.Error()
}

// logoSize fits w × h pixels into the logo box, keeping the aspect ratio.
func logoSize(w, h float64) (float64, float64) {
	scale := min(logoMaxW/(w*mmPerPixel), logoMaxH/(h*mmPerPixel), 1)
	return w * mmPerPixel * scale, h * mmPerPixel * scale
}

const (
	left, right, contentW = 20.0, 190.0, 170.0
	bottom                = 272.0
)

type renderer struct {
	pdf *fpdf.Fpdf
	txt *pdffont.Text // Liberation Sans (SIX IG 2.3 §3.4), any other script from its fallbacks
	l   labels
	d   Document
}

// Render returns the PDF; an error means the document could not be produced and must not be shipped.
func Render(d Document) ([]byte, error) {
	r, onQRPage, err := newRenderer(d, TitleFor(d.Invoice)+" "+number(d.Invoice))
	if err != nil {
		return nil, err
	}
	pdf, l := r.pdf, r.l
	r.invoicePages()
	pdf.RegisterAlias("{nb}", strconv.Itoa(pdf.PageNo())) // known only now; the footers wrote {nb}
	if bills := instalmentBills(d); bills != nil {
		for i, b := range bills {
			pdf.AddPage() // closes the previous page, running its footer first
			*onQRPage = true
			r.set("B", 12)
			r.cell(left, 20, contentW, 6, instalmentOf(l, d.Invoice.Instalments.Items[i], len(bills)), "L")
			if err := r.qrBill(b); err != nil {
				return nil, err
			}
		}
	} else if d.Bill != nil {
		pdf.AddPage() // closes the last invoice page, running its footer first
		*onQRPage = true
		if err := r.qrBill(*d.Bill); err != nil {
			return nil, err
		}
	}
	return r.output()
}

// newRenderer starts the PDF of d: fonts, metadata and the footer (draft mark, page numbers). The footer reads
// *onQRPage, which the caller sets once it adds the QR bill pages.
func newRenderer(d Document, title string) (*renderer, *bool, error) {
	l, ok := languages[d.Invoice.Language]
	if !ok {
		return nil, nil, fmt.Errorf("invoice pdf: no labels for language %q", d.Invoice.Language)
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetCreationDate(d.Created)
	pdf.SetMargins(left, 15, 210-right)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetTitle(title, true)
	pdf.SetAuthor(d.Seller.Name, true)
	r := &renderer{pdf: pdf, txt: pdffont.New(pdf), l: l, d: d}
	onQRPage := new(bool)
	pdf.SetFooterFunc(func() {
		switch {
		case r.d.Draft && *onQRPage: // nothing may be printed over the payment part (SIX IG 3.5)
			r.set("B", 40)
			pdf.SetTextColor(220, 150, 150)
			r.cell(0, 80, 210, 16, l.Draft, "C")
			pdf.SetTextColor(0, 0, 0)
		case r.d.Draft:
			r.watermark()
		}
		if !*onQRPage { // the QR bill page has no page number
			r.set("", 8)
			pdf.SetTextColor(110, 110, 110)
			r.cell(left, 284, contentW, 4, fmt.Sprintf(l.Page, pdf.PageNo()), "C")
			pdf.SetTextColor(0, 0, 0)
		}
	})
	return r, onQRPage, nil
}

func (r *renderer) output() ([]byte, error) {
	var out bytes.Buffer
	if err := r.pdf.Output(&out); err != nil {
		return nil, fmt.Errorf("invoice pdf: %w", err)
	}
	return out.Bytes(), nil
}

// receivable: the kinds the buyer pays to the workspace, which print the payment terms.
var receivable = map[string]bool{"invoice": true, "partial": true, "prepayment": true, "debit_note": true, "corrected": true}

func number(inv store.Invoice) string {
	if inv.Number == nil {
		return ""
	}
	return *inv.Number
}

// ---- drawing helpers ----

func (r *renderer) set(style string, size float64) { r.txt.Font(style, size) }

func (r *renderer) cell(x, y, w, h float64, s, align string) {
	r.pdf.SetXY(x, y)
	r.txt.Cell(w, h, s, align)
}

// wrap splits text at its line breaks and to width w in the current font.
func (r *renderer) wrap(s string, w float64) []string { return r.txt.Wrap(s, w) }

// lines writes pre-wrapped (translated) lines from y and returns the y below them.
func (r *renderer) lines(x, y, w, h float64, ls []string, align string) float64 {
	for _, s := range ls {
		r.cell(x, y, w, h, s, align)
		y += h
	}
	return y
}

func swissDate(d string) string {
	if t, err := time.Parse(time.DateOnly, d); err == nil {
		return t.Format("02.01.2006")
	}
	return d
}

func (r *renderer) watermark() {
	p := r.pdf
	p.TransformBegin()
	p.TransformRotate(45, 105, 148)
	p.SetAlpha(0.12, "Normal")
	r.set("B", 96)
	p.SetTextColor(200, 0, 0)
	r.cell(0, 136, 210, 24, r.l.Draft, "C")
	p.SetTextColor(0, 0, 0)
	p.SetAlpha(1, "Normal")
	p.TransformEnd()
}

func (r *renderer) vatNumber(v *string) string {
	if v == nil {
		return ""
	}
	if strings.HasPrefix(*v, "CHE-") && !strings.Contains(*v, " ") {
		return *v + " " + r.l.VATSuffix
	}
	return *v
}

func addressLines(p store.Party, sellerCountry string) []string {
	out := []string{p.Name, p.StreetLine()}
	city := strings.TrimSpace(p.Zip + " " + p.City)
	if p.Country != "" && p.Country != sellerCountry {
		city = p.Country + "-" + city
	}
	return append(out, city)
}

// ---- invoice pages ----

func (r *renderer) invoicePages() {
	p, inv, l := r.pdf, r.d.Invoice, r.l
	p.AddPage()
	// a self-billed invoice is drawn up by the buyer: the buyer heads it and the seller gets it
	issuer, recipient, phone := r.d.Seller, r.d.Buyer, r.d.Phone
	if inv.Kind == "self_billed" || r.d.SelfBilled {
		issuer, recipient, phone = r.d.Buyer, r.d.Seller, nil
	}
	r.letterhead(issuer, recipient, phone)

	// document details
	meta := [][2]string{}
	if n := number(inv); n != "" {
		meta = append(meta, [2]string{l.Number, n})
	}
	meta = append(meta, [2]string{l.IssueDate, swissDate(inv.IssueDate)})
	switch {
	case inv.ServiceDate != nil && inv.ServiceDateEnd != nil:
		meta = append(meta, [2]string{l.ServicePeriod, swissDate(*inv.ServiceDate) + " – " + swissDate(*inv.ServiceDateEnd)})
	case inv.ServiceDate != nil:
		meta = append(meta, [2]string{l.ServiceDate, swissDate(*inv.ServiceDate)})
	}
	if receivable[inv.Kind] || inv.Kind == "self_billed" {
		meta = append(meta, [2]string{l.DueDate, swissDate(inv.DueDate)})
	}
	if inv.Kind == "quote" { // a quote carries its valid-until date in DueDate
		meta = append(meta, [2]string{l.ValidUntil, swissDate(inv.DueDate)})
	}
	meta = append(meta, [2]string{l.ClientNumber, fmt.Sprint(inv.Client.Number)})
	if inv.Reference != nil {
		meta = append(meta, [2]string{l.Reference, *inv.Reference})
	}
	r.details(meta)

	// title
	y := 95.0
	r.set("B", 16)
	r.cell(left, y, contentW, 8, strings.TrimSpace(TitleFor(inv)+" "+number(inv)), "L")
	y += 9
	var subtitles []string
	if f := l.Preceding[inv.Kind]; f != "" && inv.CreditedInvoice != nil {
		subtitles = append(subtitles, fmt.Sprintf(f, inv.CreditedInvoice.Number))
	}
	switch {
	case inv.Kind == "self_billed" || r.d.SelfBilled:
		subtitles = append(subtitles, l.SelfBilling)
	case inv.Kind == "proforma":
		subtitles = append(subtitles, l.NotVATInvoice)
	}
	if inv.Plan != nil && inv.Plan.Seq >= 1 {
		subtitles = append(subtitles, fmt.Sprintf(l.PlanPart, inv.Plan.Seq, inv.Plan.Count))
	}
	r.set("", 10)
	for _, s := range subtitles {
		r.cell(left, y, contentW, 5, s, "L")
		y += 6
	}
	if inv.Intro != nil {
		r.set("", 9.5)
		y = r.lines(left, y+1, contentW, 4.6, r.wrap(*inv.Intro, contentW), "L") + 2
	}
	y = r.table(y + 3)
	y = r.totals(y + 3)
	y = r.schedule(y)
	r.closing(y + 6)
}

// letterhead draws the issuer's block (beside the logo when there is one) and the recipient in the envelope window.
func (r *renderer) letterhead(issuer, recipient store.Party, phone *string) {
	p := r.pdf
	// seller block, beside the logo (top left) when there is one
	sellerX, align := left, "L"
	if r.d.Logo != nil {
		if cfg, _, err := image.DecodeConfig(bytes.NewReader(r.d.Logo)); err == nil {
			opts := fpdf.ImageOptions{ImageType: logoType(r.d.Logo)}
			p.RegisterImageOptionsReader("logo", opts, bytes.NewReader(r.d.Logo))
			w, h := logoSize(float64(cfg.Width), float64(cfg.Height))
			p.ImageOptions("logo", left, 15, w, h, false, opts, 0, "")
			sellerX, align = 90, "R"
		}
	}
	r.set("B", 11)
	r.cell(sellerX, 15, right-sellerX, 5, issuer.Name, align)
	r.set("", 8.5)
	y := 20.5
	info := addressLines(issuer, "")[1:]
	info[len(info)-1] = strings.TrimSpace(issuer.Zip + " " + issuer.City)
	for _, s := range []*string{issuer.Email, phone} {
		if s != nil {
			info = append(info, *s)
		}
	}
	if v := r.vatNumber(issuer.VATNumber); v != "" {
		info = append(info, v)
	}
	for _, s := range info {
		r.cell(sellerX, y, right-sellerX, 3.8, s, align)
		y += 3.8
	}

	// buyer in the left window of a C5/6 envelope
	r.set("", 7)
	p.SetTextColor(110, 110, 110)
	r.cell(left, 47, 85, 3, senderLine(issuer.Name, issuer.StreetLine(), issuer.Zip+" "+issuer.City), "L")
	p.SetTextColor(0, 0, 0)
	y = 52
	for i, s := range addressLines(recipient, issuer.Country) {
		r.set(map[bool]string{true: "B", false: ""}[i == 0], 10)
		r.cell(left, y, 85, 4.6, s, "L")
		y += 4.6
	}
	if v := r.vatNumber(recipient.VATNumber); v != "" {
		r.set("", 8.5)
		r.cell(left, y+1, 85, 4, v, "L")
	}
}

// details writes the document's label/value pairs to the right of the address.
func (r *renderer) details(meta [][2]string) {
	y := 52.0
	for _, m := range meta {
		r.set("", 9)
		r.cell(120, y, 32, 4.6, m[0], "L")
		r.set("B", 9)
		r.cell(152, y, 38, 4.6, m[1], "R")
		y += 4.6
	}
}

type column struct {
	key, title string
	w          float64
	align      string
}

func (r *renderer) columns() []column {
	inv, l := r.d.Invoice, r.l
	hasDiscount := false
	for _, ln := range inv.Lines {
		hasDiscount = hasDiscount || ln.DiscountPercent > 0
	}
	cols := []column{{"pos", l.Pos, 10, "L"}, {"desc", l.Description, 0, "L"}, {"qty", l.Quantity, 24, "R"},
		{"price", l.UnitPrice, 24, "R"}}
	if hasDiscount {
		cols = append(cols, column{"discount", l.Discount, 15, "R"})
	}
	if inv.VATMode != invoicecalc.None {
		cols = append(cols, column{"vat", l.VAT, 15, "R"})
	}
	cols = append(cols, column{"amount", l.Amount, 26, "R"})
	rest := contentW
	for _, c := range cols {
		rest -= c.w
	}
	cols[1].w = rest
	return cols
}

func (r *renderer) tableHeader(cols []column, y float64) float64 {
	r.set("B", 8.5)
	x := left
	for _, c := range cols {
		r.cell(x, y, c.w, 5, c.title, c.align)
		x += c.w
	}
	r.pdf.SetLineWidth(0.3)
	r.pdf.Line(left, y+5.5, right, y+5.5)
	return y + 7
}

func (r *renderer) newPage() float64 {
	r.pdf.AddPage()
	return 20
}

func (r *renderer) table(y float64) float64 {
	cols := r.columns()
	y = r.tableHeader(cols, y)
	const h = 4.3
	for _, ln := range r.d.Invoice.Lines {
		r.set("", 9)
		desc := r.wrap(ln.Description, cols[1].w-2)
		if y+float64(len(desc))*h > bottom {
			y = r.tableHeader(cols, r.newPage())
			r.set("", 9)
		}
		qty := ln.Quantity.String()
		if ln.Unit != nil {
			qty += " " + r.l.Units[*ln.Unit]
		}
		vat := ln.VATRate.String() + " %"
		if ln.VATCategory != "S" {
			vat = ln.VATCategory
		}
		discount := ""
		if ln.DiscountPercent > 0 {
			discount = ln.DiscountPercent.String() + " %"
		}
		values := map[string]string{"pos": fmt.Sprint(ln.Position), "qty": qty, "price": ln.UnitPrice.Swiss("'"),
			"discount": discount, "vat": vat, "amount": ln.Amount.Swiss("'")}
		x := left
		for _, c := range cols {
			if c.key == "desc" {
				r.lines(x, y, c.w-2, h, desc, "L")
			} else {
				r.cell(x, y, c.w, h, values[c.key], c.align)
			}
			x += c.w
		}
		y += float64(len(desc))*h + 1.2
	}
	r.pdf.SetLineWidth(0.2)
	r.pdf.Line(left, y, right, y)
	return y
}

func (r *renderer) totals(y float64) float64 {
	inv, l := r.d.Invoice, r.l
	type row struct {
		label string
		value invoicecalc.Money
		bold  bool
	}
	rows := []row{{l.Subtotal, inv.Subtotal, false}}
	if inv.DiscountAmount != 0 {
		rows = append(rows, row{fmt.Sprintf(l.DocDiscount, inv.DiscountPercent), -inv.DiscountAmount, false})
	}
	// the stored totals of a final invoice are after the deduction (invoicecalc.Deduct): each prepayment comes
	// off the subtotal at the level it is in (net when prices exclude VAT, gross otherwise)
	for _, pp := range inv.Prepayments {
		var v invoicecalc.Money
		for _, g := range pp.VATBreakdown {
			v += g.TaxableAmount
			if inv.VATMode == invoicecalc.Inclusive {
				v += g.VATAmount
			}
		}
		n := ""
		if pp.Number != nil {
			n = *pp.Number
		}
		rows = append(rows, row{strings.TrimSpace(l.Titles["prepayment"] + " " + n), -v, false})
	}
	total, final := l.TotalNoVAT, l.Payable
	if inv.VATMode != invoicecalc.None {
		total = l.Total
	}
	switch {
	case inv.Kind == "credit_note":
		final = l.Credited
	case inv.Kind == "quote": // nothing is payable yet
		final = total
	case len(inv.Prepayments) > 0 && inv.RoundingAmount == 0:
		total = l.AmountDue
	case len(inv.Prepayments) > 0:
		final = l.AmountDue
	}
	if inv.VATMode != invoicecalc.None {
		rows = append(rows, row{l.NetTotal, inv.NetTotal, false})
		for _, g := range inv.VATBreakdown {
			label := fmt.Sprintf(l.VATOn, g.Rate, g.TaxableAmount.Swiss("'"))
			if g.Category != "S" {
				label += " (" + g.Category + ")"
			}
			rows = append(rows, row{label, g.VATAmount, false})
		}
	}
	rows = append(rows, row{total, inv.Total, inv.RoundingAmount == 0})
	if inv.RoundingAmount != 0 {
		rows = append(rows, row{l.Rounding, inv.RoundingAmount, false}, row{final, inv.Payable(), true})
	}
	if y+float64(len(rows))*5 > bottom {
		y = r.newPage()
	}
	for _, rw := range rows {
		style := ""
		if rw.bold {
			style = "B"
			r.pdf.SetLineWidth(0.3)
			r.pdf.Line(110, y, right, y)
			y += 0.8
		}
		r.set(style, 9)
		r.cell(110, y, 56, 5, rw.label, "L")
		r.cell(166, y, 24, 5, inv.Currency+" "+rw.value.Swiss("'"), "R")
		y += 5
	}
	return y
}

// schedule lists the instalments below the totals; it returns y unchanged without them.
func (r *renderer) schedule(y float64) float64 {
	if r.d.Invoice.Instalments == nil || len(r.d.Invoice.Instalments.Items) == 0 {
		return y
	}
	items, l, cur := r.d.Invoice.Instalments.Items, r.l, r.d.Invoice.Currency
	if y+6+float64(len(items)+2)*5 > bottom {
		y = r.newPage()
	} else {
		y += 6
	}
	r.set("B", 9)
	r.cell(110, y, 80, 5, l.Schedule, "L")
	y += 5
	r.cell(110, y, 16, 5, l.InstalmentNo, "L")
	r.cell(126, y, 30, 5, l.InstalmentDue, "L")
	r.cell(156, y, 34, 5, l.Amount, "R")
	r.pdf.SetLineWidth(0.2)
	r.pdf.Line(110, y+5.3, right, y+5.3)
	y += 6
	r.set("", 9)
	for _, it := range items {
		r.cell(110, y, 16, 5, fmt.Sprint(it.Seq), "L")
		r.cell(126, y, 30, 5, swissDate(it.DueDate), "L")
		r.cell(156, y, 34, 5, cur+" "+it.Amount.Swiss("'"), "R")
		y += 5
	}
	return y
}

// closing writes the VAT notes, the payment terms and bank details, and the footer text.
func (r *renderer) closing(y float64) {
	inv, l := r.d.Invoice, r.l
	var notes []string
	switch inv.VATMode {
	case invoicecalc.None:
		notes = append(notes, l.NotRegistered)
	case invoicecalc.Inclusive:
		notes = append(notes, l.InclusiveNote)
	}
	for _, c := range invoicecalc.Categories {
		for _, g := range inv.VATBreakdown {
			if g.Category == c && l.CategoryNotes[c] != "" && inv.VATMode != invoicecalc.None {
				note := l.CategoryNotes[c]
				if r.d.Seller.Country != "CH" && r.d.Seller.Country != "LI" {
					// The language does not identify the applicable tax jurisdiction.
					if generic := foreignCategoryNotes[inv.Language][c]; generic != "" {
						note = generic
					}
				}
				notes = append(notes, note)
				break
			}
		}
	}
	var block []string
	r.set("", 9)
	for _, n := range notes {
		block = append(block, r.wrap(n, contentW)...)
	}
	if receivable[inv.Kind] {
		block = append(block, "", fmt.Sprintf(l.PayBy, swissDate(inv.DueDate)))
		if inv.Payment.IBAN != nil {
			bank := l.BankDetails + ": IBAN " + swissqr.FormatIBAN(*inv.Payment.IBAN)
			if r.d.BankName != nil {
				bank += ", " + *r.d.BankName
			}
			block = append(block, bank)
		}
		if ref := paymentReference(inv.Payment.ReferenceType, inv.Payment.Reference); ref != "" {
			block = append(block, l.PaymentReference+": "+ref)
		}
	}
	if inv.Kind == "credit_note" && r.d.Refund {
		block = append(block, "", l.Refunded)
	}
	y = r.block(y, block)
	if inv.Payment.RevolutURL != nil {
		y = r.revolut(y+4, *inv.Payment.RevolutURL)
	}
	if inv.Footer != nil {
		r.set("", 9)
		r.block(y, append([]string{""}, r.wrap(*inv.Footer, contentW)...))
	}
}

// paymentReference: the reference as printed, in blocks; "" without one.
func paymentReference(refType string, ref *string) string {
	switch {
	case ref == nil:
		return ""
	case refType == "QRR":
		return swissqr.FormatQRR(*ref)
	}
	return swissqr.FormatSCOR(*ref)
}

// block writes pre-wrapped lines from y, continuing on a new page at the bottom; returns the y below them.
func (r *renderer) block(y float64, block []string) float64 {
	const h = 4.4
	r.set("", 9)
	for _, s := range block {
		if y+h > bottom {
			y = r.newPage()
			r.set("", 9)
		}
		y = r.lines(left, y, contentW, h, []string{s}, "L")
	}
	return y
}

// revolut draws "Pay with Revolut": a small QR code of the revolut.me link, the link (clickable), and the
// amount and reference to enter, since the link itself carries neither.
func (r *renderer) revolut(y float64, url string) float64 {
	const size = 22.0
	if y+size > bottom {
		y = r.newPage()
	}
	if err := r.qrModules(url, left, y, size); err != nil {
		r.pdf.SetError(fmt.Errorf("revolut qr: %w", err))
		return y
	}
	inv, x := r.d.Invoice, left+size+4
	r.set("B", 9.5)
	r.cell(x, y+2, contentW-size-4, 5, r.l.PayWithRevolut, "L")
	r.set("", 9)
	r.pdf.SetTextColor(0, 80, 200)
	r.pdf.SetXY(x, y+7.5)
	r.pdf.CellFormat(r.pdf.GetStringWidth(url), 4.4, url, "", 0, "L", false, 0, url)
	r.pdf.SetTextColor(0, 0, 0)
	details := fmt.Sprintf(r.l.RevolutAmount, inv.Currency, inv.Payable().Swiss("'"))
	if n := number(inv); n != "" {
		details += " · " + fmt.Sprintf(r.l.RevolutNote, n)
	}
	r.cell(x, y+12.5, contentW-size-4, 4.4, details, "L")
	return y + size
}

// senderLine is the return address over the window: the parts that are filled in, so missing company details
// never print as ", ,".
func senderLine(parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, ", ")
}
