package einvoice

import (
	"encoding/xml"
	"errors"
	"strings"
	"testing"

	"helvetly.com/api/internal/eaddress"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

func mixedOutsideVAT() store.Invoice {
	return fixture("invoice", invoicecalc.Exclusive, 1000,
		lineSpec{desc: "Workshop", qty: 2_000, price: 50_000, discount: 1000, cat: "S", rate: 810},
		lineSpec{desc: "Membership", qty: 1_000, price: 9_998, cat: "O"})
}

func outsideVAT() store.Invoice {
	return fixture("invoice", invoicecalc.None, 0,
		lineSpec{desc: "Membership", qty: 1_000, price: 10_000, cat: "O"})
}

func TestXMLRefusesUnsupportedOutsideVAT(t *testing.T) {
	for _, tc := range []struct {
		name string
		inv  store.Invoice
		want error
	}{
		{"mixed", mixedOutsideVAT(), ErrVATCategories},
		{"outside only", outsideVAT(), ErrOutsideScope},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, render := range []func(store.Invoice) ([]byte, error){
				func(inv store.Invoice) ([]byte, error) { return UBL(inv, "xrechnung") }, CII,
			} {
				out, err := render(tc.inv)
				if !errors.Is(err, tc.want) || len(out) != 0 {
					t.Errorf("XML = %s, error %v; want %v without XML", out, err, tc.want)
				}
			}
		})
	}
}

// The independent amounts are CHF 1.00 gross / 1.081 = CHF 0.93 net and CHF 0.07 VAT.
func smallInclusive() store.Invoice {
	inv := simple()
	inv.VATMode = invoicecalc.Inclusive
	inv.Lines = []store.InvoiceLine{{Position: 1, Description: "Small parts", Quantity: 100_000, UnitPrice: 1,
		VATCategory: "S", VATRate: 810, Amount: 100}}
	inv.Subtotal, inv.DiscountAmount, inv.DiscountPercent = 100, 0, 0
	inv.NetTotal, inv.VATTotal, inv.Total, inv.RoundingAmount, inv.PayableTotal = 93, 7, 100, 0, 100
	inv.VATBreakdown = []invoicecalc.Group{{Category: "S", Rate: 810, TaxableAmount: 93, VATAmount: 7}}
	return inv
}

func TestInclusiveXMLPriceBasePreservesExactLineAmounts(t *testing.T) {
	for _, tc := range []struct {
		name          string
		inv           store.Invoice
		prices, bases []string
		net           string
	}{
		{"small amounts, large quantity", smallInclusive(), []string{"0.93"}, []string{"100"}, "0.93"},
		// Gross 155.88 less 7.79 discount = 148.09; VAT 9.87 leaves 138.22 net.
		{"global discount and mixed rates", inclusive(), []string{"87.87", "26.36", "23.99"}, []string{"3", "1.5", "1"}, "138.22"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var u struct {
				Lines []struct {
					Price string `xml:"Price>PriceAmount"`
					Base  string `xml:"Price>BaseQuantity"`
				} `xml:"InvoiceLine"`
				Net        string   `xml:"LegalMonetaryTotal>TaxExclusiveAmount"`
				Allowances []string `xml:"AllowanceCharge>Amount"`
			}
			if err := xml.Unmarshal([]byte(mustUBL(t, tc.inv, "xrechnung")), &u); err != nil {
				t.Fatal(err)
			}
			var c struct {
				Lines []struct {
					Price string `xml:"SpecifiedLineTradeAgreement>NetPriceProductTradePrice>ChargeAmount"`
					Base  string `xml:"SpecifiedLineTradeAgreement>NetPriceProductTradePrice>BasisQuantity"`
				} `xml:"SupplyChainTradeTransaction>IncludedSupplyChainTradeLineItem"`
			}
			if err := xml.Unmarshal([]byte(mustCII(t, tc.inv)), &c); err != nil {
				t.Fatal(err)
			}
			if len(u.Lines) != len(tc.prices) || len(c.Lines) != len(tc.prices) {
				t.Fatalf("line counts UBL=%d CII=%d, want %d", len(u.Lines), len(c.Lines), len(tc.prices))
			}
			for i := range tc.prices {
				if u.Lines[i].Price != tc.prices[i] || c.Lines[i].Price != tc.prices[i] ||
					u.Lines[i].Base != tc.bases[i] || c.Lines[i].Base != tc.bases[i] {
					t.Errorf("line %d UBL=%+v CII=%+v, want price %s per %s", i+1, u.Lines[i], c.Lines[i], tc.prices[i], tc.bases[i])
				}
			}
			if u.Net != tc.net || len(u.Allowances) != 0 {
				t.Errorf("net=%s allowances=%v; want %s without a second discount", u.Net, u.Allowances, tc.net)
			}
		})
	}
}

func TestPeppolHTTPExportRequiresRealEndpointIdentifiers(t *testing.T) {
	inv := simple()
	inv.Seller.ElectronicAddress = nil
	out, err := formats["peppol"](inv)
	if !errors.Is(err, ErrEndpointMissing) || len(out) != 0 {
		t.Errorf("Peppol HTTP export = %s, %v; want missing endpoints without XML", out, err)
	}
	if out, err := formats["peppol"](store.Invoice{Status: "draft"}); !errors.Is(err, ErrUnsupported) || len(out) != 0 {
		t.Errorf("draft export = %s, %v; want unsupported draft", out, err)
	}
}

func TestXMLUsesOnlyIssuedSellerContact(t *testing.T) {
	inv := simple()
	out, err := UBL(inv, "xrechnung")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "billing@helvetly.example") ||
		!strings.Contains(string(out), "+41 44 123 45 67") {
		t.Fatal("XML did not use the recorded contact")
	}
}

func TestPeppolExportsExplicitElectronicAddresses(t *testing.T) {
	inv := simple()
	inv.Seller.ElectronicAddress = &eaddress.Address{Scheme: "0088", ID: "7300010000001"}
	inv.Buyer.ElectronicAddress = &eaddress.Address{Scheme: "0088", ID: "7300010000018"}
	out, err := formats["peppol"](inv)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `<cbc:EndpointID schemeID="0088">7300010000001</cbc:EndpointID>`) ||
		!strings.Contains(string(out), `<cbc:EndpointID schemeID="0088">7300010000018</cbc:EndpointID>`) ||
		strings.Contains(string(out), `schemeID="EM"`) {
		t.Fatalf("Peppol did not use explicit addresses: %s", out)
	}
}

func TestOutsideVATUsesSeparateSellerRegistration(t *testing.T) {
	inv := outsideVAT()
	inv.Seller.RegistrationNumber = ptr("HRB 12345")
	for _, render := range []func(store.Invoice) ([]byte, error){
		func(i store.Invoice) ([]byte, error) { return UBL(i, "xrechnung") }, CII,
	} {
		out, err := render(inv)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(out), "HRB 12345") || strings.Contains(string(out), "DE123456789") ||
			strings.Contains(string(out), "CHE-123.456.789 MWST") {
			t.Fatalf("outside VAT XML did not separate registration and VAT identifiers: %s", out)
		}
	}
}
