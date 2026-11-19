package invoicepdf

import (
	"bytes"
	"testing"

	"helvetly.com/api/internal/dunningcalc"
)

func TestOptionalClientAndContractNumbers(t *testing.T) {
	const bank = "Bankverbindung: Zürcher Kantonalbank, IBAN CH44 3199 9123 0008 8901 2"
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
		{"contract number with the payment details", nil, ptr("C23-25-CP2302"),
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
			// the numbers stand in the payment details at the bottom, above the bank details, not in the header
			at := func(s string) int { return bytes.Index(invoice, unicodePDFLiteral(s)) }
			for _, line := range tt.invoice {
				if line != "Ihre Referenz: PO-4711" && (at(line) < at("Ihre Referenz: PO-4711") || at(line) > at(bank)) {
					t.Errorf("%q is not printed with the payment details", line)
				}
			}
		})
	}
	for lang, want := range map[string][]string{
		"de": {"Kundennummer: 7", "Vertragsnummer: C-1", "Bankverbindung: Zürcher Kantonalbank, IBAN CH44 3199 9123 0008 8901 2, BIC ZKBKCHZZ80A"},
		"fr": {"N° client: 7", "N° de contrat: C-1", "Coordonnées bancaires: Zürcher Kantonalbank, IBAN CH44 3199 9123 0008 8901 2, BIC ZKBKCHZZ80A"},
		"it": {"N. cliente: 7", "N. contratto: C-1", "Coordinate bancarie: Zürcher Kantonalbank, IBAN CH44 3199 9123 0008 8901 2, BIC ZKBKCHZZ80A"},
		"en": {"Client number: 7", "Contract no.: C-1", "Bank details: Zürcher Kantonalbank, IBAN CH44 3199 9123 0008 8901 2, BIC ZKBKCHZZ80A"},
	} {
		d := sample(lang, 1)
		d.Invoice.ContractReference, d.BIC = ptr("C-1"), ptr("ZKBKCHZZ80A")
		text := pageText(t, d)
		for i, s := range want {
			if !shows(text, s) {
				t.Errorf("%s: %q not printed", lang, s)
			} else if i > 0 && bytes.Index(text, unicodePDFLiteral(s)) < bytes.Index(text, unicodePDFLiteral(want[i-1])) {
				t.Errorf("%s: %q before %q", lang, s, want[i-1])
			}
		}
	}
}
