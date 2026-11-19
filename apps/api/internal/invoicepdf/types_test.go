package invoicepdf

import (
	"bytes"
	"compress/zlib"
	"io"
	"regexp"
	"strings"
	"testing"

	"codeberg.org/go-pdf/fpdf"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

var streamBody = regexp.MustCompile(`(?s)stream\n(.*?)\nendstream`)

// pageText: the decompressed content streams of a rendered PDF.
func pageText(t *testing.T, d Document) []byte {
	t.Helper()
	return bytes.Join(streams(t, d), nil)
}

// streams returns the decompressed streams in file order.
func streams(t *testing.T, d Document) [][]byte {
	t.Helper()
	out, err := Render(d)
	if err != nil {
		t.Fatal(err)
	}
	return inflate(out)
}

// inflate returns the decompressed streams of a PDF in file order.
func inflate(out []byte) [][]byte {
	var all [][]byte
	for _, m := range streamBody.FindAllSubmatch(out, -1) {
		zr, err := zlib.NewReader(bytes.NewReader(m[1]))
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(zr)
		all = append(all, b)
	}
	return all
}

var cp1252 = fpdf.New("P", "mm", "A4", "").UnicodeTranslatorFromDescriptor("")
var pdfEscape = strings.NewReplacer(`\`, `\\`, `(`, `\(`, `)`, `\)`)

// shows accepts PDF literal strings in the embedded Unicode font or the original core font.
func shows(text []byte, s string) bool {
	return bytes.Contains(text, unicodePDFLiteral(s)) || bytes.Contains(text, []byte("("+pdfEscape.Replace(cp1252(s))+")"))
}

func TestTitlesAllKindsAllLanguages(t *testing.T) {
	want := map[string][]string{ // kinds in order, then final
		"de": {"Rechnung", "Teilrechnung", "Anzahlungsrechnung", "Belastungsanzeige", "Korrigierte Rechnung", "Gutschrift",
			"Proforma-Rechnung", "Gutschrift (Selbstfakturierung)", "Schlussrechnung"},
		"fr": {"Facture", "Facture partielle", "Facture d'acompte", "Note de débit", "Facture rectificative", "Note de crédit",
			"Facture pro forma", "Autofacture", "Facture finale"},
		"it": {"Fattura", "Fattura parziale", "Fattura d'acconto", "Nota di debito", "Fattura rettificativa", "Nota di credito",
			"Fattura proforma", "Autofattura", "Fattura finale"},
		"en": {"Invoice", "Partial invoice", "Prepayment invoice", "Debit note", "Corrected invoice", "Credit note",
			"Proforma invoice", "Self-billed invoice", "Final invoice"},
	}
	kinds := []string{"invoice", "partial", "prepayment", "debit_note", "corrected", "credit_note", "proforma", "self_billed"}
	for lang, titles := range want {
		for i, kind := range kinds {
			if got := Title(lang, kind); got != titles[i] {
				t.Errorf("Title(%s, %s) = %q, want %q", lang, kind, got, titles[i])
			}
			d := sample(lang, 1)
			d.Invoice.Kind, d.Bill = kind, nil
			if text := pageText(t, d); !shows(text, titles[i]+" 2026-001") {
				t.Errorf("%s %s: title not printed", lang, kind)
			}
		}
		final := store.Invoice{Kind: "invoice", Language: lang, Prepayments: []store.PrepaymentRef{{ID: "inv_p"}}}
		if got := TitleFor(final); got != titles[8] {
			t.Errorf("TitleFor(final, %s) = %q, want %q", lang, got, titles[8])
		}
		if got := TitleFor(store.Invoice{Kind: "partial", Language: lang}); got != titles[1] {
			t.Errorf("TitleFor(partial, %s) = %q", lang, got)
		}
	}
	if text := pageText(t, func() Document { d := sample("fr", 1); d.Invoice.Kind, d.Bill = "debit_note", nil; return d }()); bytes.Contains(text, []byte("débit")) {
		t.Error("UTF-8 bytes in the PDF text, want a PDF font encoding")
	}
}

func TestPrecedingReference(t *testing.T) {
	tests := []struct{ lang, kind, want string }{
		{"de", "credit_note", "Gutschrift zu Rechnung 2026-0012"},
		{"de", "debit_note", "Belastungsanzeige zu Rechnung 2026-0012"},
		{"de", "corrected", "Ersetzt Rechnung 2026-0012"},
		{"fr", "credit_note", "Note de crédit pour la facture 2026-0012"},
		{"fr", "debit_note", "Note de débit pour la facture 2026-0012"},
		{"fr", "corrected", "Remplace la facture 2026-0012"},
		{"it", "credit_note", "Nota di credito per la fattura 2026-0012"},
		{"it", "debit_note", "Nota di debito per la fattura 2026-0012"},
		{"it", "corrected", "Sostituisce la fattura 2026-0012"},
		{"en", "credit_note", "Credit note for invoice 2026-0012"},
		{"en", "debit_note", "Debit note for invoice 2026-0012"},
		{"en", "corrected", "Replaces invoice 2026-0012"},
	}
	for _, tt := range tests {
		d := sample(tt.lang, 1)
		d.Invoice.Kind, d.Bill = tt.kind, nil
		d.Invoice.CreditedInvoice = &store.InvoiceRef{ID: "inv_o", Number: "2026-0012"}
		if !shows(pageText(t, d), tt.want) {
			t.Errorf("%s %s: %q not printed", tt.lang, tt.kind, tt.want)
		}
	}
}

func TestFinalShowsPrepaymentTable(t *testing.T) {
	d := sample("de", 1) // 15 h × 150.00, 10 % line discount, 5 % document discount, 8.1 %, then 1'000.00 + 81.00 prepaid
	d.Invoice.Prepayments = []store.PrepaymentRef{{ID: "inv_p", Number: ptr("2026-0003"), PayableTotal: 108100, Status: "paid",
		VATBreakdown: []invoicecalc.Group{{Category: "S", Rate: 810, TaxableAmount: 100000, VATAmount: 8100}}}}
	d.Invoice.PrepaidTotal = 108100
	text := pageText(t, d)
	for _, want := range []string{"Schlussrechnung 2026-001", "Anzahlungsrechnung 2026-0003", "CHF -1'000.00", "Restbetrag"} {
		if !shows(text, want) {
			t.Errorf("%q not printed", want)
		}
	}
	if shows(text, "Anzahlungsrechnung 2026-001") {
		t.Error("the final invoice is titled as a prepayment")
	}
}

func TestSelfBilledMention(t *testing.T) {
	for lang, want := range map[string]string{"de": "Gutschrift (Selbstfakturierung)", "fr": "Autofacturation",
		"it": "Autofatturazione", "en": "Self-billing"} {
		d := sample(lang, 1)
		d.Invoice.Kind, d.Bill = "self_billed", nil
		text := pageText(t, d)
		if !shows(text, want) {
			t.Errorf("%s: mention %q missing", lang, want)
		}
		// the buyer bills: it fills the first party column, the seller the one it is billed to
		if !shows(text, "Société Romande SA") || !shows(text, "Muster Beratung GmbH") || !partiesInOrder(streams(t, d)[0], "Société Romande SA", "Muster Beratung GmbH") {
			t.Errorf("%s: parties not swapped", lang)
		}
		if shows(text, "rechnung@muster.ch") || shows(text, "Bank- und Zahlungsangaben:") || shows(text, "CH44 3199 9123 0008 8901 2") {
			t.Errorf("%s: seller contact or payment terms printed on a self-billed invoice", lang)
		}
	}
}

func TestProformaNoticeNoQR(t *testing.T) {
	for lang, want := range map[string]string{"de": "Keine MWST-Rechnung", "fr": "Ceci n'est pas une facture TVA",
		"it": "Non è una fattura IVA", "en": "Not a VAT invoice"} {
		d := sample(lang, 1)
		d.Invoice.Kind, d.Bill, d.Invoice.Payment.QRBill = "proforma", nil, false
		out, err := Render(d)
		if err != nil {
			t.Fatal(err)
		}
		if n := len(pageObject.FindAll(out, -1)); n != 1 {
			t.Errorf("%s: %d pages, want 1", lang, n)
		}
		if !shows(pageText(t, d), want) {
			t.Errorf("%s: notice %q missing", lang, want)
		}
	}
	d := sample("de", 1)
	if shows(pageText(t, d), "Keine MWST-Rechnung") {
		t.Error("notice on a plain invoice")
	}
}

func TestQuote(t *testing.T) {
	for lang, want := range map[string][2]string{"de": {"Offerte", "Gültig bis"}, "fr": {"Offre", "Valable jusqu'au"},
		"it": {"Offerta", "Valida fino al"}, "en": {"Quote", "Valid until"}} {
		d := sample(lang, 2)
		d.Invoice.Kind, d.Bill = "quote", nil
		text := pageText(t, d)
		if !shows(text, want[0]+" 2026-001") || !shows(text, want[1]+": 05.12.2026") {
			t.Errorf("%s: no %q or %q", lang, want[0], want[1])
		}
		if due := languages[lang].DueDate; shows(text, due+": 05.12.2026") {
			t.Errorf("%s: a quote shows %q", lang, due)
		}
	}
}

// partiesInOrder: first is drawn before second in the page's content stream (the billing party's column comes first).
func partiesInOrder(page []byte, first, second string) bool {
	at := func(s string) int {
		if i := bytes.Index(page, unicodePDFLiteral(s)); i >= 0 {
			return i
		}
		return bytes.Index(page, []byte("("+pdfEscape.Replace(cp1252(s))+")"))
	}
	a, b := at(first), at(second)
	return a >= 0 && b >= 0 && a < b
}

func TestLineColumnsNameTheCurrency(t *testing.T) {
	for lang, want := range map[string][2]string{"de": {"Preis CHF", "Betrag CHF"}, "fr": {"Prix CHF", "Montant CHF"},
		"it": {"Prezzo CHF", "Importo CHF"}, "en": {"Price CHF", "Amount CHF"}} {
		for _, kind := range []string{"invoice", "quote"} {
			d := sample(lang, 1)
			d.Invoice.Kind = kind
			text := pageText(t, d)
			if !shows(text, want[0]) || !shows(text, want[1]) || !shows(text, "150.00") || shows(text, "CHF 150.00") {
				t.Errorf("%s %s: want headers %q, %q and bare line amounts", lang, kind, want[0], want[1])
			}
		}
		d := sample(lang, 1)
		d.Invoice.Currency = "EUR"
		if text := pageText(t, d); !shows(text, want[0][:len(want[0])-3]+"EUR") {
			t.Errorf("%s: headers ignore the invoice currency", lang)
		}
	}
}
