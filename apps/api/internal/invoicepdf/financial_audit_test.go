package invoicepdf

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
	"unicode/utf16"

	"helvetly.com/api/internal/pdffont/pdffonttest"
)

// PDF Unicode strings use UTF-16BE; these names cannot be represented in the old Windows-1252 font.
func unicodePDFLiteral(s string) []byte {
	var text []byte
	for _, code := range utf16.Encode([]rune(s)) {
		text = binary.BigEndian.AppendUint16(text, code)
	}
	return []byte("(" + strings.ReplaceAll(pdfEscape.Replace(string(text)), "\r", `\r`) + ")")
}

func TestEuropeanNamesSurvivePDF(t *testing.T) {
	d := sample("en", 1)
	d.Seller.Name = "Łódź Consulting"
	d.Buyer.Name = "Žluťoučký Șerban"
	d.Bill.Creditor.Name = d.Seller.Name
	d.Bill.Debtor.Name = d.Buyer.Name
	text := pageText(t, d)
	for _, name := range []string{d.Seller.Name, d.Buyer.Name} {
		if !bytes.Contains(text, unicodePDFLiteral(name)) {
			t.Errorf("European party name %q was lost in the PDF", name)
		}
	}
}

// unicodeDocument: an invoice whose parties, intro and lines are in every script of pdffonttest.Samples.
func unicodeDocument() Document {
	d := sample("en", len(pdffonttest.Samples))
	d.Buyer.Name, d.Buyer.City = "Łukasz Wróbel 株式会社", "Τhessaloníki Москва"
	d.Invoice.Intro = ptr(pdffonttest.All())
	for i, s := range pdffonttest.Samples {
		d.Invoice.Lines[i].Description = s.Name + ": " + s.Text
	}
	return d
}

func TestAnyScriptInInvoiceAndReminder(t *testing.T) {
	d := unicodeDocument()
	out, err := Render(d)
	if err != nil {
		t.Fatal(err)
	}
	pdffonttest.Fonts(t, out)
	text := pageText(t, d)
	for _, s := range pdffonttest.Samples[:4] { // Liberation Sans draws each of these lines in one piece
		if !bytes.Contains(text, unicodePDFLiteral(s.Name+": "+s.Text)) {
			t.Errorf("%s line missing", s.Name)
		}
	}
	reminder, err := RenderReminder(d, Notice{Words: ReminderWords("en", 1, 3, false), SentOn: "2026-12-20", Title: "Payment reminder"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(reminder, []byte("/BaseFont /utf8notosanssc")) {
		t.Error("the reminder lost the buyer's CJK name")
	}
}

func TestQRVisibleMessageMatchesEncodedMessage(t *testing.T) {
	d := sample("en", 1)
	d.Bill.Message = "Invoice " + strings.Repeat("A", 130) + " OMITTED"
	text := pageText(t, d)
	word := unicodePDFLiteral("OMITTED")
	if bytes.Contains(text, []byte("OMITTED")) || bytes.Contains(text, word[1:len(word)-1]) {
		t.Fatal("the readable QR slip prints text beyond the encoded 140-character message")
	}
}

func TestForeignSellerDoesNotPrintSwissTaxBasis(t *testing.T) {
	d := sample("en", 1)
	d.Seller.Country, d.Bill = "DE", nil
	d.Invoice.VATBreakdown[0].Category = "E"
	text := pageText(t, d)
	if shows(text, "Exempt from VAT (Art. 21 Swiss VAT Act).") {
		t.Fatal("a German seller's document asserts a Swiss exemption basis")
	}
}
