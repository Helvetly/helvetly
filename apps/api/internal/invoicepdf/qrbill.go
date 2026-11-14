package invoicepdf

import (
	"fmt"
	"strings"

	"github.com/boombuler/barcode/qr"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/swissqr"
)

// The QR bill's geometry in mm (SIX implementation guidelines, 3.4–3.6): an A6 landscape payment part with
// the receipt on its left, at the bottom of an A4 page.
const (
	slipTop    = 297 - 105.0
	receiptW   = 62.0
	qrSize     = 46.0 // without the quiet zone
	crossSize  = 7.0
	payInfoX   = 118.0
	payAmountY = slipTop + 68
)

// instalmentBills: one bill per instalment of doc.Bill, nil without a schedule. An issued instalment carries its own
// reference (QRR digits or an RF creditor reference); a draft's has none and keeps the bill's.
func instalmentBills(d Document) []swissqr.Bill {
	if d.Bill == nil || d.Invoice.Instalments == nil {
		return nil
	}
	var bills []swissqr.Bill
	for _, it := range d.Invoice.Instalments.Items {
		b := *d.Bill
		b.Amount = it.Amount
		if it.Reference != nil {
			b.ReferenceType, b.Reference = "QRR", *it.Reference
			if strings.HasPrefix(*it.Reference, "RF") {
				b.ReferenceType = "SCOR"
			}
		}
		b.Message = strings.TrimSpace(b.Message + " · " + instalmentOf(languages[d.Invoice.Language], it, len(d.Invoice.Instalments.Items)))
		bills = append(bills, b)
	}
	return bills
}

func instalmentOf(l labels, it store.InstalmentItem, count int) string {
	return fmt.Sprintf(l.InstalmentOf, it.Seq, count, swissDate(it.DueDate))
}

// qrBill draws the payment part and receipt, drafts too (the invoice pages carry the draft watermark).
func (r *renderer) qrBill(b swissqr.Bill) error {
	b = b.Normalized()
	p, l := r.pdf, r.l

	// perforation lines, with the instruction above (fpdf's core fonts have no scissors symbol)
	p.SetDrawColor(0, 0, 0)
	p.SetLineWidth(0.2)
	p.SetDashPattern([]float64{1.5, 1}, 0)
	p.Line(0, slipTop, 210, slipTop)
	p.Line(receiptW, slipTop, receiptW, 297)
	p.SetDashPattern([]float64{}, 0)
	r.set("", 7)
	r.cell(0, slipTop-4, 210, 3, l.SeparateBeforePaying, "C")

	// receipt
	r.set("B", 11)
	r.cell(5, slipTop+5, 52, 5, l.Receipt, "L")
	y := slipTop + 12
	y = r.section(5, y, 52, 6, 8, l.AccountPayableTo, account(b))
	if b.ReferenceType != "NON" {
		y = r.section(5, y, 52, 6, 8, l.QRReference, []string{reference(b)})
	}
	if b.Debtor != nil {
		r.section(5, y, 52, 6, 8, l.PayableBy, debtor(b))
	} else {
		r.set("B", 6)
		r.cell(5, y, 52, 3, l.PayableByBlank, "L")
		corners(p, 5, y+3.5, 52, 20)
	}
	r.amount(5, 17, slipTop+68, 6, 8, b)
	r.set("B", 6)
	r.cell(5, slipTop+82, 52, 3, l.AcceptancePoint, "R")

	// payment part
	r.set("B", 11)
	r.cell(receiptW+5, slipTop+5, 51, 5, l.PaymentPart, "L")
	if err := r.qrCode(b.Payload(), receiptW+5, slipTop+17); err != nil {
		return err
	}
	r.amount(receiptW+5, receiptW+22, payAmountY, 8, 10, b)
	y = slipTop + 5
	y = r.section(payInfoX, y, 205-payInfoX, 8, 10, l.AccountPayableTo, account(b))
	if b.ReferenceType != "NON" {
		y = r.section(payInfoX, y, 205-payInfoX, 8, 10, l.QRReference, []string{reference(b)})
	}
	if b.Message != "" {
		y = r.section(payInfoX, y, 205-payInfoX, 8, 10, l.AdditionalInfo, []string{b.Message})
	}
	if b.Debtor != nil {
		r.section(payInfoX, y, 205-payInfoX, 8, 10, l.PayableBy, debtor(b))
	} else {
		r.set("B", 8)
		r.cell(payInfoX, y, 87, 3.5, l.PayableByBlank, "L")
		corners(p, payInfoX, y+4, 65, 25)
	}
	return p.Error()
}

// section writes a heading and its values (wrapped to w) and returns the y of the next section.
func (r *renderer) section(x, y, w, headingPt, valuePt float64, heading string, values []string) float64 {
	hh, vh := headingPt*0.3528+0.9, valuePt*0.3528+0.6
	r.set("B", headingPt)
	r.cell(x, y, w, hh, heading, "L")
	y += hh
	r.set("", valuePt)
	for _, v := range values {
		y = r.lines(x, y, w, vh, r.wrap(v, w), "L")
	}
	return y + vh*0.7
}

func (r *renderer) amount(currencyX, amountX, y, headingPt, valuePt float64, b swissqr.Bill) {
	r.set("B", headingPt)
	r.cell(currencyX, y, 12, headingPt*0.3528+1, r.l.Currency, "L")
	r.cell(amountX, y, 30, headingPt*0.3528+1, r.l.QRAmount, "L")
	y += headingPt*0.3528 + 1.5
	r.set("", valuePt)
	r.cell(currencyX, y, 12, valuePt*0.3528+1, b.Currency, "L")
	r.cell(amountX, y, 30, valuePt*0.3528+1, b.Amount.Swiss(" "), "L")
}

func account(b swissqr.Bill) []string {
	return append([]string{swissqr.FormatIBAN(b.IBAN)}, addressBlock(b.Creditor)...)
}

func debtor(b swissqr.Bill) []string { return addressBlock(*b.Debtor) }

func addressBlock(a swissqr.Address) []string {
	city := strings.TrimSpace(a.Zip + " " + a.City)
	if a.Country != "CH" && a.Country != "" {
		city = a.Country + "-" + city
	}
	return []string{a.Name, strings.TrimSpace(a.Street + " " + a.Number), city}
}

func reference(b swissqr.Bill) string {
	if b.ReferenceType == "QRR" {
		return swissqr.FormatQRR(b.Reference)
	}
	return swissqr.FormatSCOR(b.Reference)
}

// corners marks a blank field to fill in by hand with its four corners.
func corners(p interface{ Line(x1, y1, x2, y2 float64) }, x, y, w, h float64) {
	const c = 3
	for _, pt := range [][4]float64{{x, y, 1, 1}, {x + w, y, -1, 1}, {x, y + h, 1, -1}, {x + w, y + h, -1, -1}} {
		p.Line(pt[0], pt[1], pt[0]+pt[2]*c, pt[1])
		p.Line(pt[0], pt[1], pt[0], pt[1]+pt[3]*c)
	}
}

// qrCode draws the Swiss QR Code (error correction M, UTF-8, 46 × 46 mm) with the Swiss cross in its centre.
func (r *renderer) qrCode(payload string, x, y float64) error {
	if err := r.qrModules(payload, x, y, qrSize); err != nil {
		return fmt.Errorf("qr bill: %w", err)
	}
	p := r.pdf
	// the Swiss cross: a white-bordered black square with a white cross (proportions of the flag, 20:6 in 32)
	cx, cy := x+qrSize/2, y+qrSize/2
	p.SetFillColor(255, 255, 255)
	p.Rect(cx-crossSize/2, cy-crossSize/2, crossSize, crossSize, "F")
	inner := crossSize - 1
	p.SetFillColor(0, 0, 0)
	p.Rect(cx-inner/2, cy-inner/2, inner, inner, "F")
	u := inner / 32
	p.SetFillColor(255, 255, 255)
	p.Rect(cx-3*u, cy-10*u, 6*u, 20*u, "F")
	p.Rect(cx-10*u, cy-3*u, 20*u, 6*u, "F")
	p.SetFillColor(0, 0, 0)
	return nil
}

// qrModules draws payload as a QR code (error correction M) of size × size mm at x, y.
func (r *renderer) qrModules(payload string, x, y, size float64) error {
	code, err := qr.Encode(payload, qr.M, qr.Unicode)
	if err != nil {
		return err
	}
	p := r.pdf
	n := code.Bounds().Dx()
	m := size / float64(n)
	p.SetFillColor(0, 0, 0)
	for row := range n {
		for col := 0; col < n; {
			if !dark(code.At(col, row)) {
				col++
				continue
			}
			start := col
			for col < n && dark(code.At(col, row)) {
				col++
			}
			// a hair of overlap keeps viewers from drawing seams between modules
			p.Rect(x+float64(start)*m, y+float64(row)*m, float64(col-start)*m+0.01, m+0.01, "F")
		}
	}
	return nil
}

func dark(c interface{ RGBA() (r, g, b, a uint32) }) bool {
	v, _, _, _ := c.RGBA()
	return v < 0x8000
}
