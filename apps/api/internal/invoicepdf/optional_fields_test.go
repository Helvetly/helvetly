package invoicepdf

import (
	"bytes"
	"testing"

	"helvetly.com/api/internal/dunningcalc"
)

func TestOptionalClientAndContractNumbers(t *testing.T) {
	tests := []struct {
		name               string
		display, contract  *string
		invoice, reminder  []string // printed
		notInvoice, notRem []string // not printed
	}{
		{"defaults print the client's number, no contract", nil, nil,
			[]string{"Kundennummer: 7"}, []string{"Kundennummer"}, []string{"Vertragsnummer"}, nil},
		{"blank prints no client number", ptr(""), nil, nil, nil, []string{"Kundennummer"}, []string{"Kundennummer"}},
		{"own text replaces the number", ptr("K-0815"), nil,
			[]string{"Kundennummer: K-0815"}, []string{"Kundennummer", "K-0815"}, []string{"Kundennummer: 7"}, nil},
		{"contract number after the reference", nil, ptr("C23-25-CP2302"),
			[]string{"Ihre Referenz: PO-4711", "Vertragsnummer: C23-25-CP2302"}, nil, nil, []string{"Vertragsnummer"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := sample("de", 1)
			d.Invoice.ClientNumberDisplay, d.Invoice.ContractReference = tt.display, tt.contract
			n := Notice{Words: ReminderWords("de", 1, 3, false), SentOn: "2026-12-20", Rate: 500, InterestFrom: "2026-12-16",
				Amounts: dunningcalc.Notice(d.Invoice.Payable(), 2000, 500, "2026-12-16", "2026-12-20", "CHF")}
			out, err := RenderReminder(d, n)
			if err != nil {
				t.Fatal(err)
			}
			check := func(doc string, text []byte, shown, hidden []string) {
				for _, s := range shown {
					if !shows(text, s) {
						t.Errorf("%s: %q not printed", doc, s)
					}
				}
				for _, s := range hidden {
					if shows(text, s) {
						t.Errorf("%s: %q printed", doc, s)
					}
				}
			}
			invoice := pageText(t, d)
			check("invoice", invoice, tt.invoice, tt.notInvoice)
			check("reminder", bytes.Join(inflate(out), nil), tt.reminder, tt.notRem)
			if tt.contract != nil && bytes.Index(invoice, unicodePDFLiteral("Vertragsnummer")) < bytes.Index(invoice, unicodePDFLiteral("Ihre Referenz")) {
				t.Error("the contract number comes before the reference")
			}
		})
	}
	for lang, label := range map[string]string{"de": "Vertragsnummer", "fr": "N° de contrat", "it": "N. contratto", "en": "Contract no."} {
		d := sample(lang, 1)
		d.Invoice.ContractReference = ptr("C-1")
		if !shows(pageText(t, d), label+": C-1") {
			t.Errorf("%s: %q not printed", lang, label)
		}
	}
}
