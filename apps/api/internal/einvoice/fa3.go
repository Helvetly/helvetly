package einvoice

import (
	"encoding/xml"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// FA3Namespace is the KSeF structured invoice "FA (3)" (schema 1-0E), in force since 2026-02-01.
const FA3Namespace = "http://crd.gov.pl/wzor/2025/06/25/13775/"

var (
	ErrFA3SellerNIP = errors.New("einvoice: FA(3) needs a Polish seller with a valid NIP recorded at issue")
	ErrFA3Currency  = errors.New("einvoice: FA(3) needs the VAT in PLN")
	ErrFA3VAT       = errors.New("einvoice: a VAT rate or category has no FA(3) equivalent")
	ErrFA3Kind      = errors.New("einvoice: this document type is not exported as FA(3) yet")
)

// FA3 renders an issued invoice, credit note or correction as the KSeF FA(3) structure. orig is the document a
// correction refers to (nil for others). The XML is built from the issued snapshots, like UBL/CII.
func FA3(inv store.Invoice, orig *store.Invoice, now time.Time) ([]byte, error) {
	d, err := build(inv)
	if err != nil {
		return nil, err
	}
	nip, ok := polishNIP(deref(inv.Seller.VATNumber))
	if inv.Seller.Country != "PL" || !ok {
		return nil, ErrFA3SellerNIP
	}
	// shortcut: no NBP rate is stored with an invoice, so only PLN documents are exported; store the rate to allow others.
	if inv.Currency != "PLN" {
		return nil, ErrFA3Currency
	}
	kind := "VAT"
	switch inv.Kind {
	case "invoice", "partial":
	case "credit_note", "corrected", "debit_note":
		kind = "KOR"
	default: // shortcut: prepayment (ZAL) and final (ROZ) invoices need FA(3)'s order and advance blocks; not mapped yet.
		return nil, ErrFA3Kind
	}
	for _, a := range d.allowances {
		if a.reason == "Prepayment" {
			return nil, ErrFA3Kind
		}
	}
	if kind == "KOR" && (inv.CreditedInvoice == nil || orig == nil) {
		return nil, ErrUnsupported
	}
	sign := invoicecalc.Money(1)
	if inv.Kind == "credit_note" { // stored positive; FA(3) shows a correction as the change
		sign = -1
	}
	// A corrected invoice replaces the original in full, while a KOR states only the difference (P_13_x, P_14_x,
	// P_15): the original is subtracted and its lines are listed first as the state before (StanPrzed).
	var before *doc
	if inv.Kind == "corrected" {
		b, err := build(*orig)
		if err != nil {
			return nil, err
		}
		if orig.Currency != inv.Currency || len(orig.Prepayments) > 0 {
			return nil, ErrFA3Kind
		}
		before = &b
	}
	total := sign * inv.Total
	if before != nil {
		total -= orig.Total
	}
	fa := fa3Fa{KodWaluty: inv.Currency, P1: inv.IssueDate, P2: deref(inv.Number), P15: total.String(),
		RodzajFaktury: kind}
	if start, end, ok := d.period(); ok && start != end {
		fa.OkresFa = &fa3Okres{Od: start, Do: end}
	} else if ok {
		fa.P6 = start
	}
	sums := map[string][2]invoicecalc.Money{} // P_12 code → net, VAT; groups sharing a code (zw with two reasons) add up
	for _, g := range d.groups {
		field, err := fa3Field(g.Category, g.Rate, inv.Buyer.Country)
		if err != nil {
			return nil, err
		}
		s := sums[field]
		sums[field] = [2]invoicecalc.Money{s[0] + sign*g.TaxableAmount, s[1] + sign*g.VATAmount}
	}
	if before != nil {
		for _, g := range before.groups {
			field, err := fa3Field(g.Category, g.Rate, orig.Buyer.Country)
			if err != nil {
				return nil, err
			}
			s := sums[field]
			sums[field] = [2]invoicecalc.Money{s[0] - g.TaxableAmount, s[1] - g.VATAmount}
		}
	}
	set := func(field string, net, vat *string) {
		if s, ok := sums[field]; ok {
			*net = s[0].String()
			if vat != nil {
				*vat = s[1].String()
			}
		}
	}
	set("23", &fa.P131, &fa.P141)
	set("8", &fa.P132, &fa.P142)
	set("5", &fa.P133, &fa.P143)
	set("0 KR", &fa.P1361, nil)
	set("0 WDT", &fa.P1362, nil)
	set("0 EX", &fa.P1363, nil)
	set("zw", &fa.P137, nil)
	set("np I", &fa.P138, nil)
	set("np II", &fa.P139, nil)
	set("oo", &fa.P1310, nil)
	_, reverse := sums["oo"]
	fa.Adnotacje = fa3Adnotacje{P16: 2, P17: 2, P18: 2, P18A: 2, P22N: 1, P23: 2, PMarzyN: 1}
	if reverse {
		fa.Adnotacje.P18 = 1
	}
	if fa.P137 != "" {
		basis := exemptionBasis(inv.Lines)
		if basis == "" && before != nil {
			basis = exemptionBasis(orig.Lines)
		}
		if basis == "" {
			return nil, fmt.Errorf("%w: exempt lines need their exemption reason", ErrFA3VAT)
		}
		fa.Adnotacje.Zwolnienie = fa3Zwolnienie{P19: 1, P19A: basis}
	} else {
		fa.Adnotacje.Zwolnienie = fa3Zwolnienie{P19N: 1}
	}
	if kind == "KOR" {
		// shortcut: the original's KSeF number is not stored until KSeF submission exists, so NrKSeFN marks it unknown.
		fa.Korekta = &fa3Korekta{Data: orig.IssueDate, Nr: inv.CreditedInvoice.Number, NrKSeFN: 1}
	}
	for _, a := range d.allowances { // the invoice discount is already in the totals; FA(3) lines carry no document allowance
		fa.Opis = append(fa.Opis, fa3KV{Klucz: "Rabat", Wartosc: (sign * a.amount).String() + " " + inv.Currency})
	}
	if before != nil {
		fa.Wiersze = fa3Lines(*before, 1, 0, true)
	}
	fa.Wiersze = append(fa.Wiersze, fa3Lines(d, sign, len(fa.Wiersze), false)...)
	if inv.Kind != "credit_note" {
		p := fa3Platnosc{Termin: &fa3Termin{Termin: inv.DueDate}}
		if acct := iban(inv.Payment.IBAN); acct != "" {
			p.Forma, p.Rachunek = "6", &fa3Rachunek{NrRB: acct}
		}
		fa.Platnosc = &p
	}
	out := fa3Faktura{Xmlns: FA3Namespace,
		Naglowek: fa3Naglowek{Kod: fa3Kod{System: "FA (3)", Wersja: "1-0E", Value: "FA"}, Wariant: 3,
			Data: now.UTC().Truncate(time.Second).Format(time.RFC3339), SystemInfo: "Helvetly"},
		Podmiot1: fa3Podmiot1{Dane: fa3Dane1{NIP: nip, Nazwa: inv.Seller.Name}, Adres: fa3Address(*inv.Seller)},
		Podmiot2: fa3Podmiot2{Dane: buyerID(*inv.Buyer), Adres: fa3Address(*inv.Buyer), JST: 2, GV: 2},
		Fa:       fa,
	}
	body, err := xml.MarshalIndent(out, "", "  ")
	if err != nil {
		return nil, err
	}
	return append([]byte(xml.Header), body...), nil
}

// fa3Lines: d's lines as FaWiersz numbered from after+1; stanPrzed marks them as the state before a correction.
func fa3Lines(d doc, sign invoicecalc.Money, after int, stanPrzed bool) []fa3Wiersz {
	out := make([]fa3Wiersz, 0, len(d.lines))
	for i, l := range d.lines {
		field, _ := fa3Field(l.category, l.rate, d.inv.Buyer.Country)
		w := fa3Wiersz{Nr: after + i + 1, P7: l.name, P8A: unitName(d.inv.Lines[i].Unit), P8B: l.qty.String(), P12: field}
		if stanPrzed {
			w.StanPrzed = 1
		}
		if d.inv.VATMode == invoicecalc.Inclusive {
			w.P9B, w.P11A = d.inv.Lines[i].UnitPrice.String(), (sign * d.inv.Lines[i].Amount).String()
		} else {
			w.P9A, w.P11 = d.inv.Lines[i].UnitPrice.String(), (sign * l.net).String()
			if l.allowance != 0 {
				w.P10 = l.allowance.String()
			}
		}
		out = append(out, w)
	}
	return out
}

// fa3Field: the FA(3) rate code (P_12) of a VAT group; it also names the P_13/P_14 field the group's amounts go to.
// Reverse charge is domestic ("oo") for a Polish buyer and a service taxed abroad ("np II", art. 28b) otherwise.
func fa3Field(category string, rate invoicecalc.Percent, buyerCountry string) (string, error) {
	switch category {
	case "S":
		if r := rate.String(); slices.Contains([]string{"23", "8", "5"}, r) {
			return r, nil
		}
	case "Z":
		return "0 KR", nil
	case "K":
		return "0 WDT", nil
	case "G":
		return "0 EX", nil
	case "E":
		return "zw", nil
	case "O":
		return "np I", nil
	case "AE":
		if buyerCountry == "PL" {
			return "oo", nil
		}
		return "np II", nil
	}
	return "", fmt.Errorf("%w: %s %s%%", ErrFA3VAT, category, rate)
}

func exemptionBasis(lines []store.InvoiceLine) string {
	for _, l := range lines {
		if l.VATCategory == "E" {
			if r := strings.TrimSpace(deref(l.VATExemptionReason)); r != "" {
				return r
			}
		}
	}
	return ""
}

// polishNIP: the ten digits of a Polish NIP ("PL" prefix, dashes and spaces allowed), with its check digit.
func polishNIP(v string) (string, bool) {
	v = strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(v)), "PL")
	digits := strings.Map(func(r rune) rune {
		if r == '-' || r == ' ' {
			return -1
		}
		return r
	}, v)
	if len(digits) != 10 || strings.Trim(digits, "0123456789") != "" || digits[0] == '0' {
		return "", false
	}
	sum := 0
	for i, w := range []int{6, 5, 7, 2, 3, 4, 5, 6, 7} {
		sum += w * int(digits[i]-'0')
	}
	return digits, sum%11 == int(digits[9]-'0')
}

var euCodes = []string{"AT", "BE", "BG", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "EL", "HR", "HU", "IE", "IT", "LV",
	"LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "XI"}

// buyerID: a Polish NIP, an EU VAT number (FA(3) wants the code and the number apart), another tax id, or none.
func buyerID(p store.Party) fa3Dane2 {
	d := fa3Dane2{Nazwa: p.Name}
	vat := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(deref(p.VATNumber)), " ", ""))
	code := p.Country
	if code == "GR" {
		code = "EL"
	}
	switch {
	case vat == "":
		d.BrakID = 1
	case p.Country == "PL":
		if nip, ok := polishNIP(vat); ok {
			d.NIP = nip
		} else {
			d.KodKraju, d.NrID = "PL", vat
		}
	case slices.Contains(euCodes, code):
		d.KodUE, d.NrVatUE = code, strings.TrimPrefix(vat, code)
	default:
		d.KodKraju, d.NrID = p.Country, vat
	}
	return d
}

func fa3Address(p store.Party) fa3Adres {
	line := street(p)
	if apt := strings.TrimSpace(deref(p.Apt)); apt != "" {
		line += "/" + apt
	}
	return fa3Adres{KodKraju: p.Country, L1: line, L2: strings.TrimSpace(p.Zip + " " + p.City)}
}

// unitName: FA(3) takes the unit as text (P_8A); none is "szt." (piece).
func unitName(unit *string) string {
	if u := strings.TrimSpace(deref(unit)); u != "" {
		return u
	}
	return "szt."
}

type fa3Faktura struct {
	XMLName  xml.Name    `xml:"Faktura"`
	Xmlns    string      `xml:"xmlns,attr"`
	Naglowek fa3Naglowek `xml:"Naglowek"`
	Podmiot1 fa3Podmiot1 `xml:"Podmiot1"`
	Podmiot2 fa3Podmiot2 `xml:"Podmiot2"`
	Fa       fa3Fa       `xml:"Fa"`
}

type fa3Naglowek struct {
	Kod        fa3Kod `xml:"KodFormularza"`
	Wariant    int    `xml:"WariantFormularza"`
	Data       string `xml:"DataWytworzeniaFa"`
	SystemInfo string `xml:"SystemInfo"`
}

type fa3Kod struct {
	System string `xml:"kodSystemowy,attr"`
	Wersja string `xml:"wersjaSchemy,attr"`
	Value  string `xml:",chardata"`
}

type fa3Podmiot1 struct {
	Dane  fa3Dane1 `xml:"DaneIdentyfikacyjne"`
	Adres fa3Adres `xml:"Adres"`
}

type fa3Dane1 struct {
	NIP   string `xml:"NIP"`
	Nazwa string `xml:"Nazwa"`
}

type fa3Podmiot2 struct {
	Dane  fa3Dane2 `xml:"DaneIdentyfikacyjne"`
	Adres fa3Adres `xml:"Adres"`
	JST   int      `xml:"JST"`
	GV    int      `xml:"GV"`
}

type fa3Dane2 struct {
	NIP      string `xml:"NIP,omitempty"`
	KodUE    string `xml:"KodUE,omitempty"`
	NrVatUE  string `xml:"NrVatUE,omitempty"`
	KodKraju string `xml:"KodKraju,omitempty"`
	NrID     string `xml:"NrID,omitempty"`
	BrakID   int    `xml:"BrakID,omitempty"`
	Nazwa    string `xml:"Nazwa"`
}

type fa3Adres struct {
	KodKraju string `xml:"KodKraju"`
	L1       string `xml:"AdresL1"`
	L2       string `xml:"AdresL2,omitempty"`
}

type fa3Fa struct {
	KodWaluty     string       `xml:"KodWaluty"`
	P1            string       `xml:"P_1"`
	P2            string       `xml:"P_2"`
	P6            string       `xml:"P_6,omitempty"`
	OkresFa       *fa3Okres    `xml:"OkresFa"`
	P131          string       `xml:"P_13_1,omitempty"`
	P141          string       `xml:"P_14_1,omitempty"`
	P132          string       `xml:"P_13_2,omitempty"`
	P142          string       `xml:"P_14_2,omitempty"`
	P133          string       `xml:"P_13_3,omitempty"`
	P143          string       `xml:"P_14_3,omitempty"`
	P1361         string       `xml:"P_13_6_1,omitempty"`
	P1362         string       `xml:"P_13_6_2,omitempty"`
	P1363         string       `xml:"P_13_6_3,omitempty"`
	P137          string       `xml:"P_13_7,omitempty"`
	P138          string       `xml:"P_13_8,omitempty"`
	P139          string       `xml:"P_13_9,omitempty"`
	P1310         string       `xml:"P_13_10,omitempty"`
	P15           string       `xml:"P_15"`
	Adnotacje     fa3Adnotacje `xml:"Adnotacje"`
	RodzajFaktury string       `xml:"RodzajFaktury"`
	Korekta       *fa3Korekta  `xml:"DaneFaKorygowanej"`
	Opis          []fa3KV      `xml:"DodatkowyOpis"`
	Wiersze       []fa3Wiersz  `xml:"FaWiersz"`
	Platnosc      *fa3Platnosc `xml:"Platnosc"`
}

type fa3Okres struct {
	Od string `xml:"P_6_Od"`
	Do string `xml:"P_6_Do"`
}

type fa3Adnotacje struct {
	P16        int           `xml:"P_16"`
	P17        int           `xml:"P_17"`
	P18        int           `xml:"P_18"`
	P18A       int           `xml:"P_18A"`
	Zwolnienie fa3Zwolnienie `xml:"Zwolnienie"`
	P22N       int           `xml:"NoweSrodkiTransportu>P_22N"`
	P23        int           `xml:"P_23"`
	PMarzyN    int           `xml:"PMarzy>P_PMarzyN"`
}

type fa3Zwolnienie struct {
	P19  int    `xml:"P_19,omitempty"`
	P19A string `xml:"P_19A,omitempty"`
	P19N int    `xml:"P_19N,omitempty"`
}

type fa3Korekta struct {
	Data    string `xml:"DataWystFaKorygowanej"`
	Nr      string `xml:"NrFaKorygowanej"`
	NrKSeFN int    `xml:"NrKSeFN"`
}

type fa3KV struct {
	Klucz   string `xml:"Klucz"`
	Wartosc string `xml:"Wartosc"`
}

type fa3Wiersz struct {
	Nr   int    `xml:"NrWierszaFa"`
	P7   string `xml:"P_7"`
	P8A  string `xml:"P_8A"`
	P8B  string `xml:"P_8B"`
	P9A  string `xml:"P_9A,omitempty"`
	P9B  string `xml:"P_9B,omitempty"`
	P10  string `xml:"P_10,omitempty"`
	P11  string `xml:"P_11,omitempty"`
	P11A string `xml:"P_11A,omitempty"`
	P12  string `xml:"P_12"`
	// StanPrzed: 1 on a corrected invoice's lines as they were before the correction
	StanPrzed int `xml:"StanPrzed,omitempty"`
}

type fa3Platnosc struct {
	Termin   *fa3Termin   `xml:"TerminPlatnosci"`
	Forma    string       `xml:"FormaPlatnosci,omitempty"`
	Rachunek *fa3Rachunek `xml:"RachunekBankowy"`
}

type fa3Termin struct {
	Termin string `xml:"Termin"`
}

type fa3Rachunek struct {
	NrRB string `xml:"NrRB"`
}
