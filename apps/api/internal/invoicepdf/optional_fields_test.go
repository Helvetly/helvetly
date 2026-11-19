package invoicepdf

import (
	"bytes"
	"testing"

	"helvetly.com/api/internal/dunningcalc"
)

// inOrder reports whether every s is printed, each after the one before it.
func inOrder(text []byte, ss ...string) bool {
	at := -1
	for _, s := range ss {
		i := bytes.Index(text[at+1:], unicodePDFLiteral(s))
		if i < 0 {
			return false
		}
		at += 1 + i
	}
	return true
}

func TestOptionalClientAndContractNumbers(t *testing.T) {
	tests := []struct {
		name               string
		display, contract  *string
		invoice            []string // printed, in this order, before the bank block
		reminder           []string // printed
		notInvoice, notRem []string // not printed
	}{
		{"defaults print the client's number, no contract", nil, nil,
			[]string{"Vertragsangaben:", "Kundennummer:", "7"}, []string{"Kundennummer"}, []string{"Vertragsnummer"}, nil},
		{"blank prints no client number and no contract block", ptr(""), nil, nil, nil,
			[]string{"Kundennummer", "Vertragsangaben"}, []string{"Kundennummer"}},
		{"own text replaces the number", ptr("K-0815"), nil,
			[]string{"Vertragsangaben:", "Kundennummer:", "K-0815"}, []string{"Kundennummer", "K-0815"}, nil, nil},
		{"contract number after the client number", nil, ptr("C23-25-CP2302"),
			[]string{"Vertragsangaben:", "Kundennummer:", "7", "Vertragsnummer:", "C23-25-CP2302"}, nil, nil, []string{"Vertragsnummer"}},
		{"contract number alone", ptr(""), ptr("C-9"),
			[]string{"Vertragsangaben:", "Vertragsnummer:", "C-9"}, nil, []string{"Kundennummer"}, nil},
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
			invoice := pageText(t, d)
			// the numbers stand below the header's reference, above the bank block
			if tt.invoice != nil && !inOrder(invoice, append(append([]string{"Ihre Referenz: PO-4711"}, tt.invoice...), "Bank- und Zahlungsangaben:")...) {
				t.Errorf("invoice: %q not printed in order between the reference and the bank block", tt.invoice)
			}
			reminder := bytes.Join(inflate(out), nil)
			for _, s := range tt.reminder {
				if !shows(reminder, s) {
					t.Errorf("reminder: %q not printed", s)
				}
			}
			for _, s := range tt.notInvoice {
				if shows(invoice, s) {
					t.Errorf("invoice: %q printed", s)
				}
			}
			for _, s := range tt.notRem {
				if shows(reminder, s) {
					t.Errorf("reminder: %q printed", s)
				}
			}
		})
	}
}

func TestDetailBlocksAllLanguages(t *testing.T) {
	for lang, want := range map[string][]string{
		"de": {"Vertragsangaben:", "Kundennummer:", "7", "Vertragsnummer:", "C-1",
			"Bank- und Zahlungsangaben:", "Bank:", "Zürcher Kantonalbank", "SWIFT / BIC:", "ZKBKCHZZ80A",
			"IBAN:", "CH44 3199 9123 0008 8901 2", "Zahlungsreferenz:", "00 00000 00000 00000 02026 00000"},
		"fr": {"Données contractuelles:", "N° client:", "7", "N° de contrat:", "C-1",
			"Coordonnées bancaires et de paiement:", "Banque:", "Zürcher Kantonalbank", "SWIFT / BIC:", "ZKBKCHZZ80A",
			"IBAN:", "CH44 3199 9123 0008 8901 2", "Référence de paiement:", "00 00000 00000 00000 02026 00000"},
		"it": {"Dati contrattuali:", "N. cliente:", "7", "N. contratto:", "C-1",
			"Coordinate bancarie e di pagamento:", "Banca:", "Zürcher Kantonalbank", "SWIFT / BIC:", "ZKBKCHZZ80A",
			"IBAN:", "CH44 3199 9123 0008 8901 2", "Riferimento di pagamento:", "00 00000 00000 00000 02026 00000"},
		"en": {"Contract details:", "Client number:", "7", "Contract number:", "C-1",
			"Bank and payment details:", "Bank name:", "Zürcher Kantonalbank", "SWIFT / BIC:", "ZKBKCHZZ80A",
			"IBAN:", "CH44 3199 9123 0008 8901 2", "Payment reference:", "00 00000 00000 00000 02026 00000"},
	} {
		d := sample(lang, 1)
		d.Invoice.ContractReference, d.BIC = ptr("C-1"), ptr("ZKBKCHZZ80A")
		if text := pageText(t, d); !inOrder(text, want...) {
			t.Errorf("%s: blocks not printed as %q", lang, want)
		}
	}
}

func TestDetailBlocksOmitEmptyRows(t *testing.T) {
	tests := []struct {
		name       string
		doc        func() Document
		want, omit []string
	}{
		{"no bank name, BIC or reference", func() Document {
			d := sample("en", 1)
			d.BankName, d.Invoice.Payment.Reference = nil, nil
			return d
		}, []string{"Bank and payment details:", "IBAN:", "CH44 3199 9123 0008 8901 2"}, []string{"Bank name:", "SWIFT / BIC:", "Payment reference:"}},
		{"empty bank name and BIC", func() Document {
			d := sample("en", 1)
			d.BankName, d.BIC = ptr(""), ptr("")
			return d
		}, []string{"IBAN:"}, []string{"Bank name:", "SWIFT / BIC:"}},
		{"nothing to show: no blocks", func() Document {
			d := sample("en", 1)
			d.Invoice.ClientNumberDisplay, d.BankName, d.Invoice.Payment.IBAN, d.Invoice.Payment.Reference = ptr(""), nil, nil, nil
			return d
		}, nil, []string{"Contract details:", "Bank and payment details:", "IBAN:"}},
		{"self-billed: contract block only", func() Document {
			d := sample("en", 1)
			d.Invoice.Kind, d.Bill = "self_billed", nil
			return d
		}, []string{"Contract details:", "Client number:"}, []string{"Bank and payment details:", "IBAN:"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			text := pageText(t, tt.doc())
			if !inOrder(text, tt.want...) {
				t.Errorf("%q not printed in order", tt.want)
			}
			for _, s := range tt.omit {
				if shows(text, s) {
					t.Errorf("%q printed", s)
				}
			}
		})
	}
}

func TestDetailBlockStaysWithItsHeading(t *testing.T) {
	for n := 60; n <= 75; n++ { // line counts that put the blocks at every height near a page bottom
		d := sample("en", n)
		d.Invoice.ContractReference, d.BIC = ptr("C-1"), ptr("ZKBKCHZZ80A")
		for _, block := range [][2]string{{"Contract details:", "C-1"}, {"Bank and payment details:", "00 00000 00000 00000 02026 00000"}} {
			found := false
			for _, page := range streams(t, d) {
				if bytes.Contains(page, unicodePDFLiteral(block[0])) {
					found = true
					if !bytes.Contains(page, unicodePDFLiteral(block[1])) {
						t.Errorf("%d lines: %q split from its last row", n, block[0])
					}
				}
			}
			if !found {
				t.Errorf("%d lines: %q not printed", n, block[0])
			}
		}
	}
}
