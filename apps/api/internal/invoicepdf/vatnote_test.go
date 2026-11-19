package invoicepdf

import (
	"testing"

	"helvetly.com/api/internal/invoicecalc"
)

func TestVATNoteAndPaymentBlock(t *testing.T) {
	noVAT := func(language, country string) Document {
		d := sample(language, 1)
		d.Invoice.VATMode, d.Invoice.VATBreakdown, d.Seller.Country, d.Seller.VATNumber = invoicecalc.None, nil, country, nil
		return d
	}
	for _, tt := range []struct {
		name    string
		doc     Document
		want    []string
		mustNot []string
	}{
		{"swiss, not registered", noVAT("en", "CH"), []string{"Due date: 05.12.2026"}, []string{"Not subject to VAT.", "§ 19 UStG", "Payable by 05.12.2026."}},
		{"liechtenstein, not registered", noVAT("de", "LI"), nil, []string{"§ 19 UStG", "Nicht mehrwertsteuerpflichtig."}},
		{"german small business", noVAT("de", "DE"), []string{"Gemäß § 19 UStG wird keine Umsatzsteuer berechnet."}, nil},
		{"german small business, english", noVAT("en", "DE"), []string{"No VAT is charged under § 19 UStG (small business)."}, nil},
		{"registered, exempt line keeps its note", sample("en", 3), []string{"Exempt from VAT (Art. 21 Swiss VAT Act).", "Payment reference:", "00 00000 00000 00000 02026 00000"}, []string{"Payable by 05.12.2026."}},
		{"bank details stay", sample("de", 1), []string{"Zahlbar bis: 05.12.2026", "Bank- und Zahlungsangaben:", "Zürcher Kantonalbank", "CH44 3199 9123 0008 8901 2"}, []string{"Zahlbar bis 05.12.2026."}},
	} {
		text := pageText(t, tt.doc)
		for _, s := range tt.want {
			if !shows(text, s) {
				t.Errorf("%s: %q missing", tt.name, s)
			}
		}
		for _, s := range tt.mustNot {
			if shows(text, s) {
				t.Errorf("%s: %q printed", tt.name, s)
			}
		}
	}
}
