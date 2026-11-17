package einvoice

import (
	"fmt"
	"math/big"
	"slices"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// RO e-Factura: CIUS-RO 1.0.1 on UBL 2.1, checked by ANAF's Schematron package ro16931-ubl-1.0.9 (BR-RO-*).
const roCIUSID = "urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1"

// ROError lists why a document cannot be an RO e-Factura yet; each reason names what to complete.
type ROError struct{ Reasons []string }

func (e *ROError) Error() string { return "einvoice: CIUS-RO: " + strings.Join(e.Reasons, "; ") }

// roCounties: ISO 3166-2:RO, as BR-RO-110/111 accept it (RO-B is Bucharest, whose city must be a sector).
var roCounties = []string{"RO-AB", "RO-AG", "RO-AR", "RO-B", "RO-BC", "RO-BH", "RO-BN", "RO-BR", "RO-BT", "RO-BV", "RO-BZ",
	"RO-CJ", "RO-CL", "RO-CS", "RO-CT", "RO-CV", "RO-DB", "RO-DJ", "RO-GJ", "RO-GL", "RO-GR", "RO-HD", "RO-HR", "RO-IF",
	"RO-IL", "RO-IS", "RO-MH", "RO-MM", "RO-MS", "RO-NT", "RO-OT", "RO-PH", "RO-SB", "RO-SJ", "RO-SM", "RO-SV", "RO-TL",
	"RO-TM", "RO-TR", "RO-VL", "RO-VN", "RO-VS"}

// roSector: a Bucharest city written as "Sector 3" or "SECTOR3" becomes the SECTOR-RO code BR-RO-100/101 require.
func roSector(city string) (string, bool) {
	s := strings.ToUpper(strings.ReplaceAll(city, " ", ""))
	return s, len(s) == 7 && strings.HasPrefix(s, "SECTOR") && s[6] >= '1' && s[6] <= '6'
}

// roCheck: what CIUS-RO needs beyond EN 16931, refused with every reason at once rather than a file ANAF rejects.
func roCheck(d doc) error {
	inv := d.inv
	var why []string
	add := func(cond bool, format string, a ...any) {
		if cond {
			why = append(why, fmt.Sprintf(format, a...))
		}
	}
	// BR-RO-020: 380, 384 (and 389, 751) for an invoice, 381 for a credit note.
	add(!slices.Contains([]string{"380", "384", "381"}, d.typeCode),
		"e-Factura takes invoices, corrected invoices and credit notes only, not this document type (%s)", d.typeCode)
	add(!strings.HasPrefix(strings.ToUpper(deref(inv.Seller.VATNumber)), "RO"),
		"the seller needs a Romanian VAT number (RO…) on the issued document")
	add(inv.Currency != "RON" && inv.TaxCurrencyRate == nil,
		"a %s document needs the RON exchange rate of its issue date to state its VAT in RON (BR-RO-030)", inv.Currency)
	add(deref(inv.Buyer.VATNumber) == "" && deref(inv.Buyer.RegistrationNumber) == "",
		"the buyer needs a VAT or registration number (BR-RO-120)")
	for _, p := range []struct {
		role  string
		party store.Party
	}{{"seller", *inv.Seller}, {"buyer", *inv.Buyer}} {
		add(strings.TrimSpace(p.party.Street) == "" || strings.TrimSpace(p.party.City) == "",
			"the %s's street and city are required", p.role)
		if p.party.Country != "RO" {
			continue
		}
		region := deref(p.party.Region)
		add(!slices.Contains(roCounties, region), "the %s's Romanian address needs its county as an ISO 3166-2:RO code, e.g. RO-CJ", p.role)
		if _, ok := roSector(p.party.City); region == "RO-B" && !ok {
			why = append(why, fmt.Sprintf("the %s's Bucharest address needs its sector as the city, e.g. Sector 3", p.role))
		}
	}
	add(utf8.RuneCountInString(d.note()) > 300, "the intro, note and footer together may have at most 300 characters (BR-RO-L302)")
	for _, l := range d.lines {
		name, desc := roItem(l.name)
		add(utf8.RuneCountInString(name) > 100 || utf8.RuneCountInString(desc) > 200,
			"line %s: e-Factura allows a first line of at most 100 characters and 200 in all (BR-RO-L1024, L212)", l.id)
	}
	if len(why) > 0 {
		return &ROError{why}
	}
	return nil
}

// roItem: a line's first line is its name (BT-153); the whole text, when longer, its description (BT-154).
func roItem(text string) (name, description string) {
	name, _, multi := strings.Cut(text, "\n")
	if multi {
		description = text
	}
	return name, description
}

// ronVAT: the VAT total in RON (BT-111) at rate RON per unit, rounded half away from zero to the ban.
func ronVAT(vat invoicecalc.Money, rate string) (invoicecalc.Money, error) {
	r, ok := new(big.Rat).SetString(rate)
	if !ok || r.Sign() <= 0 {
		return 0, fmt.Errorf("einvoice: bad RON rate %q", rate)
	}
	cents := new(big.Rat).Mul(new(big.Rat).SetInt64(int64(vat)), r)
	q, m := new(big.Int).QuoRem(cents.Num(), cents.Denom(), new(big.Int))
	if new(big.Int).Mul(new(big.Int).Abs(m), big.NewInt(2)).Cmp(cents.Denom()) >= 0 {
		q.Add(q, big.NewInt(int64(cents.Sign())))
	}
	if !q.IsInt64() {
		return 0, &ROError{[]string{"the converted RON VAT is outside the supported amount range: check the exchange rate"}}
	}
	return invoicecalc.Money(q.Int64()), nil
}
