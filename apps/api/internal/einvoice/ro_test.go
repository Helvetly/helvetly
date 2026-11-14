package einvoice

import (
	"errors"
	"strings"
	"testing"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// roInvoice: EUR 1'081.00 from a seller registered for VAT in Romania to a company in Cluj.
func roInvoice() store.Invoice {
	inv := simple()
	inv.Currency, inv.TaxCurrencyRate = "EUR", ptr("4.9771")
	inv.Seller.VATNumber = ptr("RO18547290")
	inv.Buyer = &store.Party{Name: "Client SRL", Street: "Strada Memorandumului", StreetNumber: "28", Zip: "400114",
		City: "Cluj-Napoca", Country: "RO", Region: ptr("RO-CJ"), VATNumber: ptr("RO14399840")}
	return inv
}

// roBucharest: a RON invoice to a Bucharest buyer whose city is its sector.
func roBucharest() store.Invoice {
	inv := roInvoice()
	inv.Currency, inv.TaxCurrencyRate = "RON", nil
	inv.Buyer.City, inv.Buyer.Region = "Sector 3", ptr("RO-B")
	return inv
}

func roCreditNote() store.Invoice {
	inv := roInvoice()
	inv.Kind, inv.Number = "credit_note", ptr("CN-2026-0003")
	inv.CreditedInvoice = &store.InvoiceRef{ID: "inv-0", Number: "2026-0042"}
	return inv
}

func TestCIUSROElements(t *testing.T) {
	doc := mustUBL(t, roInvoice(), "ro_cius")
	contains(t, doc,
		"<cbc:CustomizationID>"+roCIUSID+"</cbc:CustomizationID>",
		"<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode><cbc:TaxCurrencyCode>RON</cbc:TaxCurrencyCode>",
		// 81.00 EUR × 4.9771 = 403.1451 RON
		`<cac:TaxTotal><cbc:TaxAmount currencyID="RON">403.15</cbc:TaxAmount></cac:TaxTotal>`,
		`<cbc:TaxAmount currencyID="EUR">81.00</cbc:TaxAmount>`,
		"<cbc:PostalZone>400114</cbc:PostalZone><cbc:CountrySubentity>RO-CJ</cbc:CountrySubentity>",
		"<cbc:CompanyID>RO18547290</cbc:CompanyID>")

	ron := mustUBL(t, roBucharest(), "ro_cius")
	contains(t, ron, "<cbc:CityName>SECTOR3</cbc:CityName>", "<cbc:CountrySubentity>RO-B</cbc:CountrySubentity>")
	if strings.Contains(ron, "TaxCurrencyCode") || strings.Count(ron, "<cac:TaxTotal>") != 1 {
		t.Error("a RON invoice states its VAT once, without a tax currency")
	}

	cn := mustUBL(t, roCreditNote(), "ro_cius")
	contains(t, cn, "<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>", `<cbc:TaxAmount currencyID="RON">403.15</cbc:TaxAmount>`)
}

func TestCIUSROItemNameAndDescription(t *testing.T) {
	inv := roInvoice()
	inv.Lines[0].Description = "Website hosting\nMonthly plan with backups"
	doc := mustUBL(t, inv, "ro_cius")
	contains(t, doc, "<cac:Item><cbc:Description>Website hosting&#xA;Monthly plan with backups</cbc:Description><cbc:Name>Website hosting</cbc:Name>")
	if other := mustUBL(t, inv, "xrechnung"); strings.Contains(other, "<cbc:Description>") {
		t.Error("only CIUS-RO splits a line's text into name and description")
	}
}

func TestCIUSRORefusesWhatANAFRejects(t *testing.T) {
	long := strings.Repeat("x", 101)
	for _, tc := range []struct {
		name   string
		change func(*store.Invoice)
		reason string
	}{
		{"partial invoice", func(i *store.Invoice) { i.Kind = "partial" }, "document type (326)"},
		{"seller without a Romanian VAT number", func(i *store.Invoice) { i.Seller.VATNumber = ptr("CHE-123.456.789 MWST") }, "Romanian VAT number"},
		{"EUR without its RON rate", func(i *store.Invoice) { i.TaxCurrencyRate = nil }, "RON exchange rate"},
		{"buyer without identifiers", func(i *store.Invoice) { i.Buyer.VATNumber = nil }, "VAT or registration number"},
		{"Romanian buyer without county", func(i *store.Invoice) { i.Buyer.Region = nil }, "county"},
		{"Bucharest buyer without sector", func(i *store.Invoice) { i.Buyer.Region = ptr("RO-B") }, "sector"},
		{"buyer without street", func(i *store.Invoice) { i.Buyer.Street = "" }, "street and city"},
		{"notes over 300", func(i *store.Invoice) { i.Note = ptr(strings.Repeat("n", 301)) }, "300 characters"},
		{"line name over 100", func(i *store.Invoice) { i.Lines[0].Description = long }, "line 1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			inv := roInvoice()
			tc.change(&inv)
			out, err := UBL(inv, "ro_cius")
			var ro *ROError
			if !errors.As(err, &ro) || len(out) != 0 || !strings.Contains(strings.Join(ro.Reasons, "|"), tc.reason) {
				t.Fatalf("got %v and %d bytes, want a refusal naming %q", err, len(out), tc.reason)
			}
		})
	}
}

func TestRONVATRoundsHalfAwayFromZero(t *testing.T) {
	for _, tc := range []struct {
		vat  invoicecalc.Money
		rate string
		want invoicecalc.Money
	}{
		{8100, "4.9771", 40315},     // 403.1451
		{100, "4.975", 498},         // 4.975 rounds up
		{-100, "4.975", -498},       // and down, away from zero
		{12345, "1", 12345},         // a rate of 1 keeps the amount
		{1, "0.000001", 0},          // below half a ban
		{99999, "5.012345", 501229}, // 999.99 × 5.012345 = 5012.2948
	} {
		got, err := ronVAT(tc.vat, tc.rate)
		if err != nil || got != tc.want {
			t.Errorf("ronVAT(%v, %s) = %v, %v; want %v", tc.vat, tc.rate, got, err, tc.want)
		}
	}
	if _, err := ronVAT(100, "0"); err == nil {
		t.Error("a zero rate must be refused")
	}
}
