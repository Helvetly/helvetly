package invoicepdf

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"regexp"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/swissqr"
)

func ptr[T any](v T) *T { return &v }

func sample(language string, lines int) Document {
	inv := store.Invoice{Kind: "invoice", Number: ptr("2026-001"), Status: "open", Client: store.InvoiceClient{Number: 7},
		IssueDate: "2026-11-05", DueDate: "2026-12-05", ServiceDate: ptr("2026-10-01"), ServiceDateEnd: ptr("2026-10-31"),
		Currency: "CHF", Language: language, VATMode: invoicecalc.Exclusive, Reference: ptr("PO-4711"), Intro: ptr("Grüezi\nwie besprochen:"),
		Footer: ptr("Merci vielmal."), DiscountPercent: 500,
		Payment: store.InvoicePaymentInfo{IBAN: ptr("CH4431999123000889012"), ReferenceType: "QRR", Reference: ptr("000000000000000000202600000"), QRBill: true}}
	calc := []invoicecalc.Line{}
	for i := range lines {
		category, rate := "S", invoicecalc.Percent(810)
		if i%3 == 2 {
			category, rate = "E", 0
		}
		l := store.InvoiceLine{Position: i + 1, Description: "Beratung und Umsetzung, Teil " + strings.Repeat("sehr lang ", i%4),
			Quantity: 1500, Unit: ptr("hour"), UnitPrice: 15000, DiscountPercent: invoicecalc.Percent(i % 2 * 1000), VATCategory: category, VATRate: rate}
		calc = append(calc, invoicecalc.Line{Quantity: l.Quantity, UnitPrice: l.UnitPrice, Discount: l.DiscountPercent, Category: category, Rate: rate})
		inv.Lines = append(inv.Lines, l)
	}
	t := invoicecalc.Compute(inv.VATMode, inv.Currency, calc, inv.DiscountPercent)
	for i := range inv.Lines {
		inv.Lines[i].Amount = t.Amounts[i]
	}
	inv.Subtotal, inv.DiscountAmount, inv.NetTotal, inv.VATBreakdown = t.Subtotal, t.DiscountAmount, t.NetTotal, t.Breakdown
	inv.VATTotal, inv.Total, inv.RoundingAmount = t.VATTotal, t.Total, t.RoundingAmount
	seller := store.Party{Name: "Muster Beratung GmbH", Street: "Bahnhofstrasse", StreetNumber: "1", Zip: "8001", City: "Zürich", Country: "CH",
		VATNumber: ptr("CHE-109.322.551"), Email: ptr("rechnung@muster.ch")}
	buyer := store.Party{Name: "Société Romande SA", Street: "Rue du Lac", StreetNumber: "12", Zip: "1003", City: "Lausanne", Country: "CH"}
	bill := &swissqr.Bill{IBAN: *inv.Payment.IBAN, Creditor: addr(seller),
		Amount: inv.Payable(), Currency: "CHF", Debtor: ptr(addr(buyer)),
		ReferenceType: "QRR", Reference: *inv.Payment.Reference, Message: "Rechnung 2026-001"}
	return Document{Invoice: inv, Seller: seller, Buyer: buyer, BankName: ptr("Zürcher Kantonalbank"), Bill: bill, Created: time.Unix(0, 0)}
}

func addr(p store.Party) swissqr.Address {
	return swissqr.Address{Name: p.Name, Street: p.Street, Number: p.StreetNumber, Zip: p.Zip, City: p.City, Country: p.Country}
}

var pageObject = regexp.MustCompile(`/Type /Page\b`)

func TestRender(t *testing.T) {
	tests := []struct {
		name  string
		doc   func() Document
		pages int
	}{
		{"de with QR bill", func() Document { return sample("de", 3) }, 2},
		{"fr", func() Document { return sample("fr", 3) }, 2},
		{"it", func() Document { return sample("it", 3) }, 2},
		{"en without QR bill", func() Document { d := sample("en", 3); d.Bill = nil; return d }, 1},
		{"long invoice breaks pages", func() Document { return sample("de", 80) }, 6},
		{"draft", func() Document { d := sample("de", 2); d.Draft = true; return d }, 2},
		{"credit note, no VAT", func() Document {
			d := sample("de", 2)
			d.Invoice.Kind, d.Invoice.VATMode, d.Bill = "credit_note", invoicecalc.None, nil
			d.Invoice.CreditedInvoice = &store.InvoiceRef{Number: "2026-001"}
			return d
		}, 1},
		{"blank debtor", func() Document { d := sample("de", 1); d.Bill.Debtor = nil; return d }, 2},
		{"revolut without QR bill", func() Document { return withRevolut(sample("fr", 3), false) }, 1},
		{"revolut and QR bill", func() Document { return withRevolut(sample("it", 3), true) }, 2},
		{"revolut at the page bottom moves to a new page", func() Document { return withRevolut(sample("de", 6), false) }, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := Render(tt.doc())
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.HasPrefix(out, []byte("%PDF-")) {
				t.Fatal("not a PDF")
			}
			if got := len(pageObject.FindAll(out, -1)); got != tt.pages {
				t.Fatalf("%d pages, want %d", got, tt.pages)
			}
		})
	}
}

func pngOf(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := range w {
		img.Set(x, h/2, color.RGBA{200, 0, 0, 255})
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func TestLogo(t *testing.T) {
	d := sample("de", 1)
	plain, err := Render(d)
	if err != nil {
		t.Fatal(err)
	}
	d.Logo = pngOf(400, 100)
	withLogo, err := Render(d)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(plain, []byte("/Subtype /Image")) || !bytes.Contains(withLogo, []byte("/Subtype /Image")) {
		t.Fatal("the logo is not embedded exactly when set")
	}
	if CheckLogo([]byte("<svg/>")) == nil || CheckLogo(d.Logo) != nil {
		t.Fatal("CheckLogo")
	}
	for _, tt := range []struct{ w, h, room, wantW, wantH float64 }{
		{1000, 400, 100, 45, 18},                        // 2.5 : 1, as every logo saved before: as it always was
		{3000, 600, 100, 75, 15},                        // 5 : 1 wordmark: as wide as the box allows
		{3000, 600, 60, 60, 12},                         // long details beside it: only as far as they leave free
		{3000, 600, 10, 45, 9},                          // never narrower than the old box
		{1600, 400, 100, 72, 18},                        // 4 : 1: limited by the height before the width
		{1000, 1000, 100, 18, 18},                       // square: limited by the height
		{64, 64, 100, 64 * mmPerPixel, 64 * mmPerPixel}, // small: never upscaled past 96 dpi
	} {
		if w, h := logoSize(tt.w, tt.h, tt.room); math.Abs(w-tt.wantW) > 1e-9 || math.Abs(h-tt.wantH) > 1e-9 {
			t.Errorf("logoSize(%v, %v, %v) = %v × %v", tt.w, tt.h, tt.room, w, h)
		}
	}
}

func withRevolut(d Document, qrBill bool) Document {
	d.Invoice.Payment.RevolutURL = ptr("https://revolut.me/muster")
	if !qrBill {
		d.Bill, d.Invoice.Payment.QRBill = nil, false
	}
	return d
}

func TestRevolutLink(t *testing.T) {
	for _, tt := range []struct {
		name string
		doc  Document
		want bool
	}{
		{"chosen", withRevolut(sample("en", 1), true), true},
		{"not chosen", sample("en", 1), false},
	} {
		out, err := Render(tt.doc)
		if err != nil {
			t.Fatal(err)
		}
		if got := bytes.Contains(out, []byte("(https://revolut.me/muster)")); got != tt.want {
			t.Errorf("%s: link annotation %v, want %v", tt.name, got, tt.want)
		}
	}
}

func TestRenderRefusesUnknownLanguage(t *testing.T) {
	if _, err := Render(sample("xx", 1)); err == nil {
		t.Fatal("rendered without labels")
	}
}
