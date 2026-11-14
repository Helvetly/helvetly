package einvoice

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/xsdtest"
)

const ksefDir = "../ksef/testdata"

var fa3Now = time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)

// polish: a PLN invoice of a Polish seller (NIP 525-000-12-33) to a Polish business (NIP 701-000-45-69).
func polish(kind, mode string, discount invoicecalc.Percent, specs ...lineSpec) store.Invoice {
	inv := fixture(kind, mode, discount, specs...)
	calc := make([]invoicecalc.Line, len(specs))
	for i, s := range specs {
		calc[i] = invoicecalc.Line{Quantity: s.qty, UnitPrice: s.price, Discount: s.discount, Category: s.cat, Rate: s.rate}
	}
	t := invoicecalc.Compute(mode, "PLN", calc, discount)
	for i := range inv.Lines {
		inv.Lines[i].Amount = t.Amounts[i]
	}
	inv.Currency, inv.Subtotal, inv.DiscountAmount, inv.NetTotal = "PLN", t.Subtotal, t.DiscountAmount, t.NetTotal
	inv.VATBreakdown, inv.VATTotal, inv.Total, inv.RoundingAmount, inv.PayableTotal = t.Breakdown, t.VATTotal, t.Total, t.RoundingAmount, t.Payable()
	inv.Number = ptr("FV/2026/11/0042")
	inv.Payment = store.InvoicePaymentInfo{IBAN: ptr("PL61 1090 1014 0000 0712 1981 2874"), ReferenceType: "NON"}
	inv.Seller = &store.Party{Name: "Helvetly Polska sp. z o.o.", Street: "Marszałkowska", StreetNumber: "10", Apt: ptr("4"),
		Zip: "00-001", City: "Warszawa", Country: "PL", VATNumber: ptr("PL 525-000-12-33")}
	inv.Buyer = &store.Party{Name: "Kowalski S.A.", Street: "Długa", StreetNumber: "5", Zip: "80-001", City: "Gdańsk",
		Country: "PL", VATNumber: ptr("7010004569")}
	return inv
}

func standardPL() store.Invoice {
	return polish("invoice", invoicecalc.Exclusive, 500,
		lineSpec{desc: "Doradztwo", qty: 10_000, price: 20_000, discount: 1000, cat: "S", rate: 2300, unit: ptr("h")},
		lineSpec{desc: "Książka", qty: 2_000, price: 4_999, cat: "S", rate: 800},
		lineSpec{desc: "Szkolenie", qty: 1_000, price: 30_000, cat: "E", code: ptr("VATEX-EU-132"), why: ptr("art. 43 ust. 1 pkt 29 ustawy o VAT")})
}

func TestFA3PinnedSchemaAndSpec(t *testing.T) {
	if files := xsdtest.Pinned(t, ksefDir); len(files) != 6 {
		t.Fatalf("SHA256SUMS lists %d files, want 6", len(files))
	}
}

func TestFA3IsValidAgainstTheOfficialSchema(t *testing.T) {
	euBuyer := &store.Party{Name: "Muster GmbH", Street: "Hauptstraße", StreetNumber: "5", Zip: "10115", City: "Berlin",
		Country: "DE", VATNumber: ptr("DE123456789")}
	rc := polish("invoice", invoicecalc.Exclusive, 0, lineSpec{desc: "Software", qty: 1_000, price: 100_000, cat: "AE"})
	rcEU := rc
	rcEU.Buyer = euBuyer
	private := standardPL()
	private.Buyer = &store.Party{Name: "Jan Nowak", Street: "Krótka", StreetNumber: "1", Zip: "30-001", City: "Kraków", Country: "PL"}
	gross := polish("invoice", invoicecalc.Inclusive, 0, lineSpec{desc: "Pudełko", qty: 3_000, price: 3_333, cat: "S", rate: 2300})
	period := standardPL()
	period.ServiceDate, period.ServiceDateEnd = ptr("2026-10-01"), ptr("2026-10-31")
	credit := standardPL()
	credit.Kind, credit.Number = "credit_note", ptr("KOR/2026/11/0003")
	credit.CreditedInvoice = &store.InvoiceRef{ID: "inv-0", Number: "FV/2026/11/0042"}
	export := polish("invoice", invoicecalc.Exclusive, 0,
		lineSpec{desc: "Towar", qty: 1_000, price: 50_000, cat: "G"}, lineSpec{desc: "WDT", qty: 1_000, price: 10_000, cat: "K"})

	cases := []struct {
		name     string
		inv      store.Invoice
		credited *store.Invoice
		want     []string
	}{
		{"rates, discount and exempt line", standardPL(), nil, []string{"<P_13_1>", "<P_14_1>", "<P_13_2>", "<P_13_7>",
			"<P_19>1</P_19>", "<P_19A>art. 43 ust. 1 pkt 29 ustawy o VAT</P_19A>", "<RodzajFaktury>VAT</RodzajFaktury>",
			"<NIP>5250001233</NIP>", "<NIP>7010004569</NIP>", "<Klucz>Rabat</Klucz>", "<NrRB>PL61109010140000071219812874</NrRB>"}},
		{"reverse charge to a Polish buyer", rc, nil, []string{"<P_13_10>1000.00</P_13_10>", "<P_18>1</P_18>", "<P_12>oo</P_12>"}},
		{"service taxed in the buyer's EU country", rcEU, nil, []string{"<KodUE>DE</KodUE>", "<NrVatUE>123456789</NrVatUE>",
			"<P_13_9>1000.00</P_13_9>", "<P_12>np II</P_12>", "<P_18>2</P_18>"}},
		{"consumer without a tax id", private, nil, []string{"<BrakID>1</BrakID>"}},
		{"gross prices", gross, nil, []string{"<P_9B>33.33</P_9B>", "<P_11A>99.99</P_11A>"}},
		{"service period", period, nil, []string{"<P_6_Od>2026-10-01</P_6_Od>", "<P_6_Do>2026-10-31</P_6_Do>"}},
		{"credit note", credit, ptr(standardPL()), []string{"<RodzajFaktury>KOR</RodzajFaktury>", "<DataWystFaKorygowanej>2026-11-07</DataWystFaKorygowanej>",
			"<NrFaKorygowanej>FV/2026/11/0042</NrFaKorygowanej>", "<NrKSeFN>1</NrKSeFN>", "<P_15>-"}},
		{"export and intra-EU supply", export, nil, []string{"<P_13_6_3>500.00</P_13_6_3>", "<P_13_6_2>100.00</P_13_6_2>",
			"<P_12>0 EX</P_12>", "<P_12>0 WDT</P_12>"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			doc, err := FA3(c.inv, c.credited, fa3Now)
			if err != nil {
				t.Fatal(err)
			}
			wellFormed(t, doc)
			contains(t, string(doc), c.want...)
			xsdtest.Valid(t, ksefDir+"/fa3", "xsd/schemat.xsd", "fa3.xml", doc)
		})
	}
}

func TestFA3TotalsMatchTheInvoice(t *testing.T) {
	inv := standardPL()
	raw, err := FA3(inv, nil, fa3Now)
	if err != nil {
		t.Fatal(err)
	}
	doc := string(raw)
	var vat23, vat8 invoicecalc.Money
	for _, g := range inv.VATBreakdown {
		switch g.Rate {
		case 2300:
			vat23 = g.VATAmount
		case 800:
			vat8 = g.VATAmount
		}
	}
	contains(t, doc, "<P_14_1>"+vat23.String()+"</P_14_1>", "<P_14_2>"+vat8.String()+"</P_14_2>",
		"<P_15>"+inv.Total.String()+"</P_15>")
}

func TestFA3Refuses(t *testing.T) {
	swiss := simple() // a Swiss seller in CHF
	eur := standardPL()
	eur.Currency = "EUR"
	swissRate := polish("invoice", invoicecalc.Exclusive, 0, lineSpec{desc: "x", qty: 1_000, price: 100, cat: "S", rate: 810})
	noReason := polish("invoice", invoicecalc.Exclusive, 0, lineSpec{desc: "x", qty: 1_000, price: 100, cat: "E"})
	prepayment := standardPL()
	prepayment.Kind = "prepayment"
	final := polish("invoice", invoicecalc.Exclusive, 0, lineSpec{desc: "x", qty: 1_000, price: 100_000, cat: "S", rate: 2300})
	prepaid := []invoicecalc.Group{{Category: "S", Rate: 2300, TaxableAmount: 30_000, VATAmount: 6_900}}
	totals, _ := invoicecalc.Deduct(invoicecalc.Totals{Subtotal: final.Subtotal, NetTotal: final.NetTotal,
		Breakdown: final.VATBreakdown, VATTotal: final.VATTotal, Total: final.Total}, [][]invoicecalc.Group{prepaid}, "PLN")
	final.NetTotal, final.VATBreakdown, final.VATTotal, final.Total = totals.NetTotal, totals.Breakdown, totals.VATTotal, totals.Total
	final.Prepayments = []store.PrepaymentRef{{ID: "pre", VATBreakdown: prepaid}}
	badNIP := standardPL()
	badNIP.Seller.VATNumber = ptr("5250001234")
	for name, c := range map[string]struct {
		inv  store.Invoice
		want error
	}{
		"Swiss seller":        {swiss, ErrFA3SellerNIP},
		"wrong NIP check":     {badNIP, ErrFA3SellerNIP},
		"not in PLN":          {eur, ErrFA3Currency},
		"rate unknown in PL":  {swissRate, ErrFA3VAT},
		"exempt, no reason":   {noReason, ErrFA3VAT},
		"prepayment invoice":  {prepayment, ErrFA3Kind},
		"final, prepaid":      {final, ErrFA3Kind},
		"credit, no original": {func() store.Invoice { i := standardPL(); i.Kind = "credit_note"; return i }(), ErrUnsupported},
	} {
		if _, err := FA3(c.inv, nil, fa3Now); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}
}

func TestPolishNIP(t *testing.T) {
	for in, want := range map[string]string{"5250001233": "5250001233", "PL 525-000-12-33": "5250001233",
		"pl5250001233": "5250001233", "5250001234": "", "0250001233": "", "52500012": "", "": ""} {
		if got, ok := polishNIP(in); (want == "") == ok || (ok && got != want) {
			t.Errorf("polishNIP(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
}

func TestFA3Handler(t *testing.T) {
	credit := standardPL()
	credit.Kind, credit.Number = "credit_note", ptr("KOR/2026/11/0003")
	credit.CreditedInvoice = &store.InvoiceRef{ID: "pl", Number: "FV/2026/11/0042"}
	orphan := credit
	orphan.CreditedInvoice = &store.InvoiceRef{ID: "gone", Number: "FV/2026/11/0001"}
	docs := map[string]store.Invoice{"pl": standardPL(), "credit": credit, "orphan": orphan, "swiss": simple()}
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
		id     string
		status int
		body   string
	}{
		{"pl", 200, "<RodzajFaktury>VAT</RodzajFaktury>"},
		// the corrected invoice's issue date comes from the original document
		{"credit", 200, "<DataWystFaKorygowanej>" + docs["pl"].IssueDate + "</DataWystFaKorygowanej>"},
		{"orphan", 404, "not_found"},
		{"swiss", 409, "einvoice_seller_nip_missing"},
	} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/invoices/"+tc.id+"/einvoice?format=ksef-fa3", nil))
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.body) {
			t.Errorf("%s: %d %s, want %d with %q", tc.id, w.Code, w.Body.String(), tc.status, tc.body)
		}
	}
}

// FA(3) is archived like the EN 16931 formats: the first export's bytes, with its own serializer version.
func TestFA3IsArchived(t *testing.T) {
	e := newArchiveEnvWith(t, standardPL())
	first := e.get(context.Background(), FormatFA3)
	if first.Code != 200 {
		t.Fatalf("first: %d %s", first.Code, first.Body.String())
	}
	second := e.get(context.Background(), FormatFA3)
	if second.Code != 200 || second.Body.String() != first.Body.String() || e.files.puts != 1 {
		t.Fatalf("archive not reused: %d, %d stored", second.Code, e.files.puts)
	}
	if v := first.Header().Get("X-Helvetly-XML-Version"); v != "helvetly-ksef-fa3-2" {
		t.Fatalf("serializer version %q", v)
	}
}

// A corrected invoice replaces the original; in FA(3) a KOR states only the difference (P_13_x, P_14_x: "kwota
// różnicy", P_15: "korekta kwoty"), so the full new totals would count the original's VAT twice.
func TestFA3CorrectedInvoiceStatesTheDifference(t *testing.T) {
	orig := standardPL()
	corrected := polish("corrected", invoicecalc.Exclusive, 500,
		lineSpec{desc: "Doradztwo", qty: 12_000, price: 20_000, discount: 1000, cat: "S", rate: 2300, unit: ptr("h")},
		lineSpec{desc: "Książka", qty: 2_000, price: 4_999, cat: "S", rate: 800})
	corrected.Number = ptr("FV/2026/11/0050")
	corrected.CreditedInvoice = &store.InvoiceRef{ID: "inv-0", Number: deref(orig.Number)}
	group := func(inv store.Invoice, rate invoicecalc.Percent) invoicecalc.Group {
		for _, g := range inv.VATBreakdown {
			if g.Category == "S" && g.Rate == rate || rate == 0 && g.Category == "E" {
				return g
			}
		}
		return invoicecalc.Group{}
	}
	raw, err := FA3(corrected, &orig, fa3Now)
	if err != nil {
		t.Fatal(err)
	}
	doc := string(raw)
	contains(t, doc, "<RodzajFaktury>KOR</RodzajFaktury>",
		"<P_13_1>"+(group(corrected, 2300).TaxableAmount-group(orig, 2300).TaxableAmount).String()+"</P_13_1>",
		"<P_14_1>"+(group(corrected, 2300).VATAmount-group(orig, 2300).VATAmount).String()+"</P_14_1>",
		"<P_13_2>0.00</P_13_2>",
		"<P_13_7>"+(-group(orig, 0).TaxableAmount).String()+"</P_13_7>",
		"<P_15>"+(corrected.Total-orig.Total).String()+"</P_15>",
		"<StanPrzed>1</StanPrzed>")
	if n := strings.Count(doc, "<FaWiersz>"); n != len(orig.Lines)+len(corrected.Lines) {
		t.Errorf("%d lines, want the original's %d before and the correction's %d after", n, len(orig.Lines), len(corrected.Lines))
	}
	xsdtest.Valid(t, ksefDir+"/fa3", "xsd/schemat.xsd", "fa3.xml", raw)
}
