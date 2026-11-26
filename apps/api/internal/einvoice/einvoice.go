// Package einvoice renders an issued invoice as EN 16931 XML: XRechnung (UBL and CII) and Peppol BIS
// Billing 3 (UBL), built from the stored document so it matches the PDF (docs/invoices-contract.md "E-invoice XML").
package einvoice

import (
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"helvetly.com/api/internal/eaddress"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/store"
)

const (
	en16931ID     = "urn:cen.eu:en16931:2017" // BT-24 of the Factur-X / ZUGFeRD EN 16931 profile
	xrechnungID   = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
	peppolID      = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0"
	peppolProcess = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0" // BT-23, also used by XRechnung
)

// ErrUnsupported: the document has no e-invoice (a draft, a proforma, a self-billed invoice or one without snapshots).
var ErrUnsupported = errors.New("einvoice: only issued receivable invoices and credit notes have XML")

var (
	ErrVATCategories   = errors.New("einvoice: outside-scope VAT cannot be combined with other VAT categories")
	ErrOutsideScope    = errors.New("einvoice: outside-scope XML needs the seller's recorded registration number")
	ErrEndpointMissing = errors.New("einvoice: Peppol requires seller and buyer electronic endpoint identifiers")
)

type groupKey struct {
	category string
	rate     invoicecalc.Percent
}

type line struct {
	id, name, unitCode string
	qty                invoicecalc.Quantity
	price              invoicecalc.Money    // BT-146 net price
	priceBase          invoicecalc.Quantity // BT-149; zero means one unit
	allowance          invoicecalc.Money    // BT-136, the line discount
	net                invoicecalc.Money    // BT-131
	category           string
	rate               invoicecalc.Percent
}

// allowance is a document-level allowance (BG-20): the invoice discount or a deducted prepayment, per VAT group.
type allowance struct {
	amount   invoicecalc.Money
	reason   string
	category string
	rate     invoicecalc.Percent
}

type group struct {
	invoicecalc.Group
	code, reason string // BT-121, BT-120
}

type doc struct {
	inv        store.Invoice
	typeCode   string
	lines      []line
	allowances []allowance
	groups     []group
	lineTotal  invoicecalc.Money // BT-106
	allowTotal invoicecalc.Money // BT-107
}

// Contact is the seller contact (BG-6) frozen in the issued seller snapshot.
type Contact struct{ Phone, Email string }

// ErrSellerContact: XRechnung requires the seller's phone and email (BR-DE-5, BR-DE-7).
var ErrSellerContact = errors.New("einvoice: XRechnung needs the seller's recorded phone and email")

// Legacy documents without the required snapshot fail closed; current settings cannot recover history.
func (d doc) sellerContact(required bool) (*Contact, error) {
	c := Contact{Phone: deref(d.inv.Seller.Phone), Email: deref(d.inv.Seller.Email)}
	if required && (c.Phone == "" || c.Email == "") {
		return nil, ErrSellerContact
	}
	if c.Phone == "" && c.Email == "" {
		return nil, nil
	}
	return &c, nil
}

// note is BT-22: the public intro and footer share the single note Peppol permits (R002).
func (d doc) note() string {
	var parts []string
	for _, p := range []*string{d.inv.Intro, d.inv.Footer} {
		if t := strings.TrimSpace(deref(p)); t != "" {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, "\n\n")
}

// period is BT-73/74, set when the service has a start and an end date.
func (d doc) period() (start, end string, ok bool) {
	if d.inv.ServiceDate == nil || d.inv.ServiceDateEnd == nil {
		return "", "", false
	}
	return *d.inv.ServiceDate, *d.inv.ServiceDateEnd, true
}

func (d doc) creditNote() bool { return d.inv.Kind == "credit_note" }

// buyerReference is BT-10, mandatory in XRechnung.
func (d doc) buyerReference() string {
	if r := deref(d.inv.Reference); r != "" {
		return r
	}
	return "n/a"
}

// build maps the stored document onto EN 16931 terms and checks that they add up to its stored totals.
func build(inv store.Invoice) (doc, error) {
	if inv.Status == "draft" || inv.Number == nil || inv.Seller == nil || inv.Buyer == nil ||
		!(invoices.Receivable(inv.Kind) || inv.Kind == "credit_note") {
		return doc{}, ErrUnsupported
	}
	for _, g := range inv.VATBreakdown {
		if g.Category == "O" {
			if len(inv.VATBreakdown) != 1 {
				return doc{}, ErrVATCategories
			}
			if strings.TrimSpace(deref(inv.Seller.RegistrationNumber)) == "" {
				return doc{}, ErrOutsideScope
			}
		}
	}
	d := doc{inv: inv, typeCode: invoices.TypeCode(inv.Kind)}
	prepaid := map[groupKey]invoicecalc.Money{}
	for _, p := range inv.Prepayments {
		for _, g := range p.VATBreakdown {
			prepaid[groupKey{g.Category, g.Rate}] += g.TaxableAmount
		}
	}
	members := map[groupKey][]int{}
	for i, l := range inv.Lines {
		k := groupKey{l.VATCategory, l.VATRate}
		if inv.VATMode == invoicecalc.None {
			k = groupKey{"O", 0}
		}
		members[k] = append(members[k], i)
		ln := line{id: strconv.Itoa(i + 1), name: l.Description, unitCode: unitCode(l.Unit), qty: l.Quantity,
			price: l.UnitPrice, net: l.Amount, category: k.category, rate: k.rate}
		if inv.VATMode != invoicecalc.Inclusive {
			ln.allowance = mulDiv(int64(l.Quantity), int64(l.UnitPrice), 1000) - l.Amount
		}
		d.lines = append(d.lines, ln)
	}
	for _, g := range inv.VATBreakdown {
		k := groupKey{g.Category, g.Rate}
		before := g.TaxableAmount + prepaid[k] // the group's net before prepayments were deducted
		if inv.VATMode == invoicecalc.Inclusive {
			d.spreadNet(members[k], before)
		}
		var lines invoicecalc.Money
		for _, i := range members[k] {
			lines += d.lines[i].net
		}
		discount := lines - before
		if discount < 0 {
			return doc{}, fmt.Errorf("einvoice: VAT group %s %s exceeds its lines", g.Category, g.Rate)
		}
		d.addAllowance(discount, "Discount", k)
		d.addAllowance(prepaid[k], "Prepayment", k)
		d.groups = append(d.groups, exemption(group{Group: g}, inv.Lines, members[k]))
	}
	for _, l := range d.lines {
		d.lineTotal += l.net
	}
	var taxable, vat invoicecalc.Money
	for _, g := range d.groups {
		taxable += g.TaxableAmount
		vat += g.VATAmount
	}
	if d.lineTotal-d.allowTotal != inv.NetTotal || taxable != inv.NetTotal || vat != inv.VATTotal || inv.NetTotal+inv.VATTotal != inv.Total {
		return doc{}, fmt.Errorf("einvoice: totals of %s do not add up (lines %s, allowances %s, net %s, vat %s)",
			deref(inv.Number), d.lineTotal, d.allowTotal, inv.NetTotal, inv.VATTotal)
	}
	return d, nil
}

func (d doc) outsideVAT() bool { return len(d.groups) == 1 && d.groups[0].Category == "O" }

func (d doc) xmlParty(p store.Party) store.Party {
	if d.outsideVAT() {
		p.VATNumber = nil
	}
	return p
}

func (d doc) requireEndpoints() error {
	for _, p := range []*store.Party{d.inv.Seller, d.inv.Buyer} {
		if p.ElectronicAddress == nil {
			return ErrEndpointMissing
		}
		if _, err := eaddress.Normalise(*p.ElectronicAddress); err != nil {
			return ErrEndpointMissing
		}
	}
	return nil
}

func (d *doc) addAllowance(amount invoicecalc.Money, reason string, k groupKey) {
	if amount == 0 {
		return
	}
	d.allowances = append(d.allowances, allowance{amount: amount, reason: reason, category: k.category, rate: k.rate})
	d.allowTotal += amount
}

// spreadNet allocates the discounted group net by gross line amounts. Using each line's full quantity as the
// price base (BT-149) preserves its exact net amount without rounding a derived per-unit price (R120).
func (d *doc) spreadNet(idx []int, net invoicecalc.Money) {
	var gross invoicecalc.Money
	for _, i := range idx {
		gross += d.inv.Lines[i].Amount
	}
	left := net
	for n, i := range idx {
		share := left
		if n < len(idx)-1 && gross != 0 {
			share = mulDiv(int64(net), int64(d.inv.Lines[i].Amount), int64(gross))
		}
		left -= share
		d.lines[i].net = share
		if d.lines[i].qty != 0 {
			d.lines[i].price, d.lines[i].priceBase = share, d.lines[i].qty
		}
	}
}

// exemption: every category but S and Z names the first code and reason of its lines; O defaults to VATEX-EU-O.
func exemption(g group, lines []store.InvoiceLine, idx []int) group {
	if g.Category == "S" || g.Category == "Z" {
		return g
	}
	for _, i := range idx {
		if g.code == "" {
			g.code = deref(lines[i].VATExemptionCode)
		}
		if g.reason == "" {
			g.reason = deref(lines[i].VATExemptionReason)
		}
	}
	if g.Category == "O" && g.code == "" {
		g.code = "VATEX-EU-O"
	}
	return g
}

// percent is the VAT rate as printed (BT-119, BT-152); category O has none.
func percent(category string, rate invoicecalc.Percent) string {
	if category == "O" {
		return ""
	}
	return rate.String()
}

// unitCode maps the free-text unit to UN/ECE Recommendation 20; anything unknown is "one" (C62).
func unitCode(unit *string) string {
	switch strings.ToLower(strings.TrimSuffix(strings.TrimSpace(deref(unit)), ".")) {
	case "h", "hr", "hrs", "hour", "hours", "std", "stunde", "stunden", "heure", "heures":
		return "HUR"
	case "d", "day", "days", "tag", "tage", "jour", "jours":
		return "DAY"
	case "month", "months", "monat", "monate", "mois":
		return "MON"
	case "km":
		return "KMT"
	case "kg":
		return "KGM"
	case "m":
		return "MTR"
	}
	return "C62"
}

// mulDiv = round(a × b / c), half away from zero, without overflow.
func mulDiv(a, b, c int64) invoicecalc.Money {
	n := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	n.Mul(n, big.NewInt(2))
	den := big.NewInt(2 * c)
	if n.Sign() < 0 {
		n.Sub(n, big.NewInt(c))
	} else {
		n.Add(n, big.NewInt(c))
	}
	return invoicecalc.Money(n.Quo(n, den).Int64())
}

func iban(s *string) string { return strings.ReplaceAll(deref(s), " ", "") }

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func street(p store.Party) string { return strings.TrimSpace(p.Street + " " + p.StreetNumber) }
