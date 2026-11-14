package einvoice

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"flag"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/eaddress"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

var update = flag.Bool("update", false, "rewrite the golden files in testdata")

type lineSpec struct {
	desc      string
	qty       invoicecalc.Quantity
	price     invoicecalc.Money
	discount  invoicecalc.Percent
	cat       string
	rate      invoicecalc.Percent
	code, why *string
	unit      *string
}

// fixture builds an issued invoice whose totals come from invoicecalc, as issuing does.
func fixture(kind, mode string, discount invoicecalc.Percent, specs ...lineSpec) store.Invoice {
	calc := make([]invoicecalc.Line, len(specs))
	for i, s := range specs {
		calc[i] = invoicecalc.Line{Quantity: s.qty, UnitPrice: s.price, Discount: s.discount, Category: s.cat, Rate: s.rate}
	}
	t := invoicecalc.Compute(mode, "CHF", calc, discount)
	lines := make([]store.InvoiceLine, len(specs))
	for i, s := range specs {
		lines[i] = store.InvoiceLine{Position: i + 1, Description: s.desc, Quantity: s.qty, Unit: s.unit, UnitPrice: s.price,
			DiscountPercent: s.discount, VATCategory: s.cat, VATRate: s.rate, Amount: t.Amounts[i],
			VATExemptionCode: s.code, VATExemptionReason: s.why}
	}
	return store.Invoice{
		ID: "inv-1", Kind: kind, Number: ptr("2026-0042"), Status: "open", IssueDate: "2026-11-07", DueDate: "2026-12-07",
		Currency: "CHF", VATMode: mode, Reference: ptr("PO-77"), Lines: lines, DiscountPercent: discount,
		Subtotal: t.Subtotal, DiscountAmount: t.DiscountAmount, NetTotal: t.NetTotal, VATBreakdown: t.Breakdown,
		VATTotal: t.VATTotal, Total: t.Total, RoundingAmount: t.RoundingAmount, PayableTotal: t.Payable(),
		Payment: store.InvoicePaymentInfo{IBAN: ptr("CH93 0076 2011 6238 5295 7"), ReferenceType: "QRR",
			Reference: ptr("210000000003139471430009017")},
		Seller: &store.Party{Name: "Helvetly AG", Street: "Bahnhofstrasse", StreetNumber: "1", Zip: "8001", City: "Zürich",
			ElectronicAddress: &eaddress.Address{Scheme: "0088", ID: "7300010000001"}, Phone: ptr("+41 44 123 45 67"), Country: "CH", VATNumber: ptr("CHE-123.456.789 MWST"), Email: ptr("billing@helvetly.example")},
		Buyer: &store.Party{Name: "Muster GmbH", Street: "Hauptstraße", StreetNumber: "5", Apt: ptr("3. OG"), Zip: "10115",
			ElectronicAddress: &eaddress.Address{Scheme: "0088", ID: "7300010000018"}, City: "Berlin", Country: "DE", VATNumber: ptr("DE123456789"), Email: ptr("ap@muster.example")},
	}
}

// simple: CHF 1'081.00 = 10 h × 100.00 at 8.1 %.
func simple() store.Invoice {
	return fixture("invoice", invoicecalc.Exclusive, 0,
		lineSpec{desc: "Consulting", qty: 10_000, price: 10_000, cat: "S", rate: 810, unit: ptr("h")})
}

// mixed: line and document discounts, plus exempt and zero-rated supplies (O cannot be mixed with them).
func mixed() store.Invoice {
	return fixture("invoice", invoicecalc.Exclusive, 1000,
		lineSpec{desc: "Workshop", qty: 2_000, price: 50_000, discount: 1000, cat: "S", rate: 810, unit: ptr("day")},
		lineSpec{desc: "Training course", qty: 1_000, price: 30_000, cat: "E", code: ptr("VATEX-EU-132"), why: ptr("Art. 21 MWSTG")},
		lineSpec{desc: "Zero-rated supply", qty: 1_000, price: 9_998, cat: "Z"})
}

func creditNote() store.Invoice {
	inv := simple()
	inv.Kind, inv.Number = "credit_note", ptr("CN-2026-0003")
	inv.CreditedInvoice = &store.InvoiceRef{ID: "inv-0", Number: "2026-0042"}
	return inv
}

func inclusive() store.Invoice {
	return fixture("invoice", invoicecalc.Inclusive, 500,
		lineSpec{desc: "Box A", qty: 3_000, price: 3_333, cat: "S", rate: 810},
		lineSpec{desc: "Box B", qty: 1_500, price: 1_999, cat: "S", rate: 810},
		lineSpec{desc: "Book", qty: 1_000, price: 2_590, cat: "S", rate: 260})
}

// final: a final invoice with a prepayment deducted per VAT group, as invoicecalc.Deduct does.
func final() store.Invoice {
	inv := simple()
	prepaid := []invoicecalc.Group{{Category: "S", Rate: 810, TaxableAmount: 30_000, VATAmount: 2_430}}
	t, gross := invoicecalc.Deduct(invoicecalc.Totals{Subtotal: inv.Subtotal, NetTotal: inv.NetTotal,
		Breakdown: inv.VATBreakdown, VATTotal: inv.VATTotal, Total: inv.Total}, [][]invoicecalc.Group{prepaid}, "CHF")
	inv.NetTotal, inv.VATBreakdown, inv.VATTotal, inv.Total, inv.RoundingAmount = t.NetTotal, t.Breakdown, t.VATTotal, t.Total, t.RoundingAmount
	inv.PayableTotal, inv.PrepaidTotal = t.Payable(), gross
	inv.Prepayments = []store.PrepaymentRef{{ID: "pre-1", Number: ptr("2026-0040"), VATBreakdown: prepaid}}
	return inv
}

// dated: a service period and notes (a blank note is left out).
func dated() store.Invoice {
	inv := simple()
	inv.ServiceDate, inv.ServiceDateEnd = ptr("2026-10-01"), ptr("2026-10-31")
	inv.Intro, inv.Note, inv.Footer = ptr("Thank you for your order."), ptr(" "), ptr("Payable within 30 days.")
	return inv
}

func mustUBL(t *testing.T, inv store.Invoice, profile string) string {
	t.Helper()
	out, err := UBL(inv, profile)
	if err != nil {
		t.Fatalf("UBL: %v", err)
	}
	wellFormed(t, out)
	return compact(out)
}

func mustCII(t *testing.T, inv store.Invoice) string {
	t.Helper()
	out, err := CII(inv)
	if err != nil {
		t.Fatalf("CII: %v", err)
	}
	wellFormed(t, out)
	return compact(out)
}

var betweenTags = regexp.MustCompile(`>\s+<`)

// compact drops the indentation so a test can look for adjacent elements.
func compact(b []byte) string { return betweenTags.ReplaceAllString(string(b), "><") }

func wellFormed(t *testing.T, b []byte) {
	t.Helper()
	d := xml.NewDecoder(bytes.NewReader(b))
	for {
		if _, err := d.Token(); err != nil {
			if err.Error() == "EOF" {
				return
			}
			t.Fatalf("not well-formed XML: %v", err)
		}
	}
}

func contains(t *testing.T, doc string, parts ...string) {
	t.Helper()
	for _, p := range parts {
		if !strings.Contains(doc, p) {
			t.Errorf("missing %q", p)
		}
	}
}

func TestUBLRequiredElements(t *testing.T) {
	for _, tc := range []struct{ profile, customization string }{
		{"xrechnung", "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"},
		{"peppol", "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0"},
	} {
		t.Run(tc.profile, func(t *testing.T) {
			doc := mustUBL(t, simple(), tc.profile)
			contains(t, doc,
				`<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"`,
				"<cbc:CustomizationID>"+tc.customization+"</cbc:CustomizationID>",
				"<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>",
				"<cbc:ID>2026-0042</cbc:ID>", "<cbc:IssueDate>2026-11-07</cbc:IssueDate>",
				"<cbc:DueDate>2026-12-07</cbc:DueDate>", "<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>",
				"<cbc:DocumentCurrencyCode>CHF</cbc:DocumentCurrencyCode>", "<cbc:BuyerReference>PO-77</cbc:BuyerReference>",
				"<cac:OrderReference>", "<cbc:CompanyID>CHE-123.456.789 MWST</cbc:CompanyID>",
				"<cbc:CompanyID>DE123456789</cbc:CompanyID>", "<cbc:RegistrationName>Muster GmbH</cbc:RegistrationName>",
				`<cbc:EndpointID schemeID="0088">7300010000018</cbc:EndpointID>`,
				"<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>", "<cbc:PaymentID>210000000003139471430009017</cbc:PaymentID>",
				"<cbc:ID>CH9300762011623852957</cbc:ID>",
				`<cbc:TaxAmount currencyID="CHF">81.00</cbc:TaxAmount>`,
				`<cbc:InvoicedQuantity unitCode="HUR">10</cbc:InvoicedQuantity>`,
				`<cbc:LineExtensionAmount currencyID="CHF">1000.00</cbc:LineExtensionAmount>`,
				"<cbc:Name>Consulting</cbc:Name>", "<cbc:Percent>8.1</cbc:Percent>",
				`<cbc:PayableAmount currencyID="CHF">1081.00</cbc:PayableAmount>`)
		})
	}
}

func TestBuyerReferenceFallback(t *testing.T) {
	inv := simple()
	inv.Reference = nil
	doc := mustUBL(t, inv, "xrechnung")
	contains(t, doc, "<cbc:BuyerReference>n/a</cbc:BuyerReference>")
	if strings.Contains(doc, "<cac:OrderReference>") {
		t.Error("OrderReference without a reference")
	}
	contains(t, mustCII(t, inv), "<ram:BuyerReference>n/a</ram:BuyerReference>")
}

func TestCIIRequiredElements(t *testing.T) {
	doc := mustCII(t, simple())
	contains(t, doc,
		`<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"`,
		"<ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID>",
		"<ram:ID>2026-0042</ram:ID>", "<ram:TypeCode>380</ram:TypeCode>",
		`<udt:DateTimeString format="102">20261107</udt:DateTimeString>`,
		`<udt:DateTimeString format="102">20261207</udt:DateTimeString>`,
		"<ram:BuyerReference>PO-77</ram:BuyerReference>", "<ram:IssuerAssignedID>PO-77</ram:IssuerAssignedID>",
		`<ram:ID schemeID="VA">CHE-123.456.789 MWST</ram:ID>`, `<ram:URIID schemeID="0088">7300010000018</ram:URIID>`,
		"<ram:PaymentReference>210000000003139471430009017</ram:PaymentReference>",
		"<ram:InvoiceCurrencyCode>CHF</ram:InvoiceCurrencyCode>", "<ram:TypeCode>58</ram:TypeCode>",
		"<ram:IBANID>CH9300762011623852957</ram:IBANID>",
		`<ram:BilledQuantity unitCode="HUR">10</ram:BilledQuantity>`, "<ram:LineTotalAmount>1000.00</ram:LineTotalAmount>",
		"<ram:CalculatedAmount>81.00</ram:CalculatedAmount>", "<ram:BasisAmount>1000.00</ram:BasisAmount>",
		"<ram:RateApplicablePercent>8.1</ram:RateApplicablePercent>",
		`<ram:TaxTotalAmount currencyID="CHF">81.00</ram:TaxTotalAmount>`,
		"<ram:GrandTotalAmount>1081.00</ram:GrandTotalAmount>", "<ram:DuePayableAmount>1081.00</ram:DuePayableAmount>")
}

func TestCreditNoteUsesCreditNoteRoot(t *testing.T) {
	doc := mustUBL(t, creditNote(), "xrechnung")
	contains(t, doc,
		`<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"`,
		"<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>",
		"<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>2026-0042</cbc:ID>",
		`<cbc:CreditedQuantity unitCode="HUR">10</cbc:CreditedQuantity>`, "<cac:CreditNoteLine>",
		"<cbc:PaymentDueDate>2026-12-07</cbc:PaymentDueDate>",
		`<cbc:PayableAmount currencyID="CHF">1081.00</cbc:PayableAmount>`)
	for _, bad := range []string{"<cbc:InvoiceTypeCode>", "<cac:InvoiceLine>", "<cbc:DueDate>", ">-"} {
		if strings.Contains(doc, bad) {
			t.Errorf("credit note contains %q", bad)
		}
	}
	cii := mustCII(t, creditNote())
	contains(t, cii, "<ram:TypeCode>381</ram:TypeCode>",
		"<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>2026-0042</ram:IssuerAssignedID>")
}

func TestExemptionReason(t *testing.T) {
	doc := mustUBL(t, mixed(), "xrechnung")
	contains(t, doc,
		"<cbc:ID>E</cbc:ID><cbc:Percent>0</cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-EU-132</cbc:TaxExemptionReasonCode>"+
			"<cbc:TaxExemptionReason>Art. 21 MWSTG</cbc:TaxExemptionReason>")
	cii := mustCII(t, mixed())
	contains(t, cii, "<ram:ExemptionReason>Art. 21 MWSTG</ram:ExemptionReason>",
		"<ram:ExemptionReasonCode>VATEX-EU-132</ram:ExemptionReasonCode>")
	// S and Z carry no exemption; a free-text exemption reason does not require a VATEX code.
	inv := mixed()
	inv.Lines[1].VATExemptionCode = nil
	doc = mustUBL(t, inv, "xrechnung")
	contains(t, doc, "<cbc:TaxExemptionReason>Art. 21 MWSTG</cbc:TaxExemptionReason>")
	if strings.Contains(doc, "<cbc:TaxExemptionReasonCode>") {
		t.Errorf("want the free-text exemption reason without a code:\n%s", doc)
	}
}

// totals is the part of either syntax the test reads back.
type totals struct {
	Lines     []string `xml:"InvoiceLine>LineExtensionAmount"`
	CNLines   []string `xml:"CreditNoteLine>LineExtensionAmount"`
	LineTotal string   `xml:"LegalMonetaryTotal>LineExtensionAmount"`
	Allow     string   `xml:"LegalMonetaryTotal>AllowanceTotalAmount"`
	Exclusive string   `xml:"LegalMonetaryTotal>TaxExclusiveAmount"`
	Inclusive string   `xml:"LegalMonetaryTotal>TaxInclusiveAmount"`
	Rounding  string   `xml:"LegalMonetaryTotal>PayableRoundingAmount"`
	Payable   string   `xml:"LegalMonetaryTotal>PayableAmount"`
	VAT       string   `xml:"TaxTotal>TaxAmount"`
}

type ciiTotals struct {
	Lines []string `xml:"SupplyChainTradeTransaction>IncludedSupplyChainTradeLineItem>SpecifiedLineTradeSettlement>SpecifiedTradeSettlementLineMonetarySummation>LineTotalAmount"`
	Sum   struct {
		LineTotal string `xml:"LineTotalAmount"`
		Allow     string `xml:"AllowanceTotalAmount"`
		Basis     string `xml:"TaxBasisTotalAmount"`
		VAT       string `xml:"TaxTotalAmount"`
		Rounding  string `xml:"RoundingAmount"`
		Grand     string `xml:"GrandTotalAmount"`
		Due       string `xml:"DuePayableAmount"`
	} `xml:"SupplyChainTradeTransaction>ApplicableHeaderTradeSettlement>SpecifiedTradeSettlementHeaderMonetarySummation"`
}

func money(t *testing.T, s string) invoicecalc.Money {
	t.Helper()
	if s == "" {
		return 0
	}
	neg := strings.HasPrefix(s, "-")
	m, ok := invoicecalc.ParseMoney(strings.TrimPrefix(s, "-"))
	if !ok {
		t.Fatalf("bad amount %q", s)
	}
	if neg {
		return -m
	}
	return m
}

func sum(t *testing.T, list []string) (s invoicecalc.Money) {
	for _, v := range list {
		s += money(t, v)
	}
	return s
}

func TestTotalsMatchInvoice(t *testing.T) {
	for name, inv := range map[string]store.Invoice{"simple": simple(), "mixed": mixed(), "inclusive": inclusive(),
		"final": final(), "credit": creditNote()} {
		t.Run(name, func(t *testing.T) {
			var u totals
			if err := xml.Unmarshal([]byte(mustUBL(t, inv, "peppol")), &u); err != nil {
				t.Fatal(err)
			}
			lines := sum(t, append(u.Lines, u.CNLines...))
			if lines != money(t, u.LineTotal) || lines-money(t, u.Allow) != inv.NetTotal || money(t, u.Exclusive) != inv.NetTotal {
				t.Errorf("UBL net: lines %v total %s allowances %s, want net %v", lines, u.LineTotal, u.Allow, inv.NetTotal)
			}
			if money(t, u.VAT) != inv.VATTotal || money(t, u.Inclusive) != inv.Total ||
				money(t, u.Rounding) != inv.RoundingAmount || money(t, u.Payable) != inv.Payable() {
				t.Errorf("UBL totals %+v, want vat %v total %v rounding %v payable %v", u, inv.VATTotal, inv.Total, inv.RoundingAmount, inv.Payable())
			}
			var c ciiTotals
			if err := xml.Unmarshal([]byte(mustCII(t, inv)), &c); err != nil {
				t.Fatal(err)
			}
			lines = sum(t, c.Lines)
			if lines != money(t, c.Sum.LineTotal) || lines-money(t, c.Sum.Allow) != inv.NetTotal || money(t, c.Sum.Basis) != inv.NetTotal ||
				money(t, c.Sum.VAT) != inv.VATTotal || money(t, c.Sum.Grand) != inv.Total ||
				money(t, c.Sum.Rounding) != inv.RoundingAmount || money(t, c.Sum.Due) != inv.Payable() {
				t.Errorf("CII totals %+v (lines %v), want net %v vat %v total %v payable %v", c.Sum, lines, inv.NetTotal, inv.VATTotal, inv.Total, inv.Payable())
			}
		})
	}
}

func TestRefusesWhatHasNoXML(t *testing.T) {
	draft := simple()
	draft.Status = "draft"
	proforma := simple()
	proforma.Kind = "proforma"
	selfBilled := simple()
	selfBilled.Kind = "self_billed"
	broken := simple()
	broken.NetTotal++
	for name, inv := range map[string]store.Invoice{"draft": draft, "proforma": proforma, "self_billed": selfBilled} {
		if _, err := UBL(inv, "xrechnung"); !errors.Is(err, ErrUnsupported) {
			t.Errorf("%s UBL: %v", name, err)
		}
		if _, err := CII(inv); !errors.Is(err, ErrUnsupported) {
			t.Errorf("%s CII: %v", name, err)
		}
	}
	if _, err := UBL(broken, "xrechnung"); err == nil || errors.Is(err, ErrUnsupported) {
		t.Errorf("totals mismatch: %v", err)
	}
	if _, err := UBL(simple(), "zugferd"); err == nil {
		t.Error("unknown profile accepted")
	}
}

func TestGoldenFiles(t *testing.T) {
	cases := map[string]func() ([]byte, error){
		"simple-xrechnung-ubl.xml": func() ([]byte, error) { return UBL(simple(), "xrechnung") },
		"simple-peppol.xml":        func() ([]byte, error) { return UBL(simple(), "peppol") },
		"simple-xrechnung-cii.xml": func() ([]byte, error) { return CII(simple()) },
		"mixed-xrechnung-ubl.xml":  func() ([]byte, error) { return UBL(mixed(), "xrechnung") },
		"mixed-xrechnung-cii.xml":  func() ([]byte, error) { return CII(mixed()) },
		"dated-xrechnung-ubl.xml":  func() ([]byte, error) { return UBL(dated(), "xrechnung") },
		"dated-xrechnung-cii.xml":  func() ([]byte, error) { return CII(dated()) },
		"final-peppol.xml":         func() ([]byte, error) { return UBL(final(), "peppol") },
		"credit-xrechnung-ubl.xml": func() ([]byte, error) { return UBL(creditNote(), "xrechnung") },
		"credit-xrechnung-cii.xml": func() ([]byte, error) { return CII(creditNote()) },
	}
	for name, render := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := render()
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join("testdata", name)
			if *update {
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("%v (run with -update to create it)", err)
			}
			if !bytes.Equal(got, want) {
				t.Errorf("%s differs from the golden file; run with -update after checking the diff:\n%s", name, got)
			}
		})
	}
}

// TestKoSIT validates the XRechnung output with the KoSIT validator when HELVETLY_TEST_KOSIT points to its jar;
// the jar's folder must hold the unpacked XRechnung configuration (scenarios.xml). Peppol needs its own configuration.
func officialFixtures() map[string]store.Invoice {
	outside := outsideVAT()
	outside.Seller.RegistrationNumber = ptr("HRB 12345")
	outsideDiscount := fixture("invoice", invoicecalc.None, 500,
		lineSpec{desc: "Membership", qty: 1000, price: 10000, cat: "O"})
	outsideDiscount.Seller.RegistrationNumber = ptr("HRB 12345")
	public := simple() // to a German public body: its Leitweg-ID is the buyer reference (BT-10)
	public.Reference = ptr("04011000-1234512345-06")
	return map[string]store.Invoice{"simple": simple(), "mixed": mixed(), "final": final(), "credit": creditNote(),
		"dated": dated(), "inclusive": inclusive(), "small-inclusive": smallInclusive(),
		"outside": outside, "outside-discount": outsideDiscount, "leitweg": public}
}

func TestKoSIT(t *testing.T) {
	validateOfficialXML(t, "HELVETLY_TEST_KOSIT", "xrechnung", true)
}

func TestPeppolKoSIT(t *testing.T) {
	validateOfficialXML(t, "HELVETLY_TEST_PEPPOL_KOSIT", "peppol", false)
}

func validateOfficialXML(t *testing.T, env, profile string, includeCII bool) {
	t.Helper()
	jar := os.Getenv(env)
	if jar == "" {
		t.Log(env + " not set: official validation not run")
		return
	}
	if _, err := exec.LookPath("java"); err != nil {
		t.Fatalf("validator java: %v", err)
	}
	dir := t.TempDir()
	var files []string
	for name, inv := range officialFixtures() {
		outputs := map[string]string{"-ubl.xml": mustUBL(t, inv, profile)}
		if includeCII {
			outputs["-cii.xml"] = mustCII(t, inv)
		}
		for suffix, body := range outputs {
			f := filepath.Join(dir, name+suffix)
			if err := os.WriteFile(f, []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}
			files = append(files, f)
		}
	}
	conf := filepath.Dir(jar)
	args := append([]string{"-jar", jar, "-s", filepath.Join(conf, "scenarios.xml"), "-r", conf, "-o", dir}, files...)
	if out, err := exec.Command("java", args...).CombinedOutput(); err != nil {
		t.Fatalf("KoSIT validator: %v\n%s", err, out)
	}
}

// fakeAuth signs every request in and writes errors with the real auth conventions.
type fakeAuth struct{ *auth.Service }

func (fakeAuth) SignedIn(h func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { h(w, r, store.Session{}) }
}

func TestHandler(t *testing.T) {
	docs := map[string]store.Invoice{"inv-1": simple(), "draft": func() store.Invoice { i := simple(); i.Status = "draft"; return i }(),
		"proforma":      func() store.Invoice { i := simple(); i.Kind = "proforma"; return i }(),
		"mixed-outside": mixedOutsideVAT(), "outside": outsideVAT(), "ro": roInvoice()}
	s := &Service{auth: fakeAuth{&auth.Service{}},
		load: func(_ context.Context, _ store.Session, id string) (store.Invoice, error) {
			if inv, ok := docs[id]; ok {
				return inv, nil
			}
			return store.Invoice{}, store.ErrNotFound
		},
	}
	mux := http.NewServeMux()
	s.Register(mux)
	for _, tc := range []struct {
		phone  string
		path   string
		status int
		body   string
	}{
		{"", "/api/v1/invoices/inv-1/einvoice?format=xrechnung-ubl", 200, "<cbc:InvoiceTypeCode>380"},
		{"", "/api/v1/invoices/inv-1/einvoice?format=peppol", 200, "<cbc:InvoiceTypeCode>380"},
		{"", "/api/v1/invoices/inv-1/einvoice?format=xrechnung-cii", 200, "<rsm:CrossIndustryInvoice"},
		{"", "/api/v1/invoices/inv-1/einvoice", 400, "invalid_request"},
		{"", "/api/v1/invoices/inv-1/einvoice?format=zugferd", 400, "invalid_request"},
		{"", "/api/v1/invoices/nope/einvoice?format=peppol", 404, "not_found"},
		{"", "/api/v1/invoices/draft/einvoice?format=peppol", 409, "invalid_state"},
		{"", "/api/v1/invoices/proforma/einvoice?format=xrechnung-cii", 409, "invalid_state"},
		{"none", "/api/v1/invoices/inv-1/einvoice?format=xrechnung-ubl", 409, "einvoice_seller_contact_missing"},
		{"none", "/api/v1/invoices/inv-1/einvoice?format=xrechnung-cii", 409, "einvoice_seller_contact_missing"},
		{"none", "/api/v1/invoices/inv-1/einvoice?format=peppol", 200, "<cbc:InvoiceTypeCode>380"},
		{"", "/api/v1/invoices/mixed-outside/einvoice?format=xrechnung-ubl", 409, "einvoice_vat_categories_incompatible"},
		{"", "/api/v1/invoices/mixed-outside/einvoice?format=xrechnung-cii", 409, "einvoice_vat_categories_incompatible"},
		{"", "/api/v1/invoices/mixed-outside/einvoice?format=peppol", 409, "einvoice_vat_categories_incompatible"},
		{"", "/api/v1/invoices/outside/einvoice?format=xrechnung-ubl", 409, "einvoice_outside_scope_unsupported"},
		{"", "/api/v1/invoices/outside/einvoice?format=xrechnung-cii", 409, "einvoice_outside_scope_unsupported"},
		{"", "/api/v1/invoices/ro/einvoice?format=ro-cius", 200, "CIUS-RO:1.0.1"},
		{"", "/api/v1/invoices/inv-1/einvoice?format=ro-cius", 409, `"code":"einvoice_cius_ro_incomplete"`},
		{"", "/api/v1/invoices/inv-1/einvoice?format=ro-cius", 409, `"reasons":["the seller needs a Romanian VAT number`},
	} {
		if tc.phone == "none" {
			docs["inv-1"].Seller.Phone = nil
		} else {
			docs["inv-1"].Seller.Phone = ptr("+41 44 123 45 67")
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.body) {
			t.Errorf("%s: %d %s, want %d with %q", tc.path, w.Code, w.Body.String(), tc.status, tc.body)
			continue
		}
		if tc.status != 200 {
			continue
		}
		h := w.Header()
		if h.Get("Content-Type") != "application/xml; charset=utf-8" || h.Get("X-Helvetly-Preview") != "true" ||
			h.Get("Content-Disposition") != `attachment; filename="2026-0042.xml"` {
			t.Errorf("%s headers: %v", tc.path, h)
		}
	}
}

func TestSellerContact(t *testing.T) {
	doc := mustUBL(t, simple(), "xrechnung")
	contains(t, doc, "<cac:Contact><cbc:Name>Helvetly AG</cbc:Name><cbc:Telephone>+41 44 123 45 67</cbc:Telephone>"+
		"<cbc:ElectronicMail>billing@helvetly.example</cbc:ElectronicMail></cac:Contact>")
	contains(t, mustCII(t, simple()), "<ram:DefinedTradeContact><ram:PersonName>Helvetly AG</ram:PersonName>"+
		"<ram:TelephoneUniversalCommunication><ram:CompleteNumber>+41 44 123 45 67</ram:CompleteNumber>")

	noPhone := simple()
	noPhone.Seller.Phone = nil
	if _, err := UBL(noPhone, "xrechnung"); !errors.Is(err, ErrSellerContact) {
		t.Errorf("UBL without historical phone: %v", err)
	}
	if _, err := CII(noPhone); !errors.Is(err, ErrSellerContact) {
		t.Errorf("CII without historical phone: %v", err)
	}
	noEmail := simple()
	noEmail.Seller.Email = nil
	if _, err := UBL(noEmail, "xrechnung"); !errors.Is(err, ErrSellerContact) {
		t.Errorf("UBL without historical email: %v", err)
	}
	// Peppol does not require the seller contact.
	if _, err := UBL(noEmail, "peppol"); err != nil {
		t.Errorf("Peppol without contact: %v", err)
	}
}

func TestDatesAndNotes(t *testing.T) {
	inv := dated()
	doc := mustUBL(t, inv, "xrechnung")
	contains(t, doc, "<cbc:Note>Thank you for your order.&#xA;&#xA;Payable within 30 days.</cbc:Note>",
		"<cac:InvoicePeriod><cbc:StartDate>2026-10-01</cbc:StartDate><cbc:EndDate>2026-10-31</cbc:EndDate></cac:InvoicePeriod>",
		"<cac:Delivery><cbc:ActualDeliveryDate>2026-10-01</cbc:ActualDeliveryDate></cac:Delivery>")
	cii := mustCII(t, inv)
	contains(t, cii, "<ram:IncludedNote><ram:Content>Thank you for your order.&#xA;&#xA;Payable within 30 days.</ram:Content></ram:IncludedNote>",
		`<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">20261001</udt:DateTimeString>`,
		`<ram:BillingSpecifiedPeriod><ram:StartDateTime><udt:DateTimeString format="102">20261001</udt:DateTimeString></ram:StartDateTime>`+
			`<ram:EndDateTime><udt:DateTimeString format="102">20261031</udt:DateTimeString></ram:EndDateTime>`)

	// A single service date is BT-72 only; no notes or dates leave the elements out.
	inv.ServiceDateEnd, inv.Intro, inv.Footer = nil, nil, nil
	doc = mustUBL(t, inv, "peppol")
	contains(t, doc, "<cbc:ActualDeliveryDate>2026-10-01</cbc:ActualDeliveryDate>")
	for _, bad := range []string{"<cac:InvoicePeriod>", "<cbc:Note>"} {
		if strings.Contains(doc, bad) {
			t.Errorf("contains %q", bad)
		}
	}
	plain := mustCII(t, simple())
	for _, bad := range []string{"<ram:IncludedNote>", "<ram:BillingSpecifiedPeriod>", "<ram:ActualDeliverySupplyChainEvent>"} {
		if strings.Contains(plain, bad) {
			t.Errorf("CII contains %q", bad)
		}
	}
}

func TestLeitwegIDIsTheBuyerReference(t *testing.T) {
	inv := officialFixtures()["leitweg"]
	contains(t, mustUBL(t, inv, "xrechnung"), "<cbc:BuyerReference>04011000-1234512345-06</cbc:BuyerReference>")
	contains(t, mustCII(t, inv), "<ram:BuyerReference>04011000-1234512345-06</ram:BuyerReference>")
}
