// Package vatcalc turns a period's sales and purchases, already in CHF, into the figures (Ziffern) of the Swiss
// VAT return (ESTV form 0550, MWST-Info 15 §1.4): the effective method and the net tax rate method (Saldosteuersatz,
// MWSTG art. 37). Pure and exact: money in minor units, rates in hundredths of a percent (docs/vat-return-contract.md).
package vatcalc

import (
	"math/big"

	"helvetly.com/api/internal/invoicecalc"
)

type (
	Money   = invoicecalc.Money
	Percent = invoicecalc.Percent
	Group   = invoicecalc.Group
)

const (
	Effective  = "effective"
	NetTaxRate = "net_tax_rate"

	// Statutory rates from 2024-01-01 and before (ESTV); a supply's date, not its invoice date, decides which.
	rateChange = "2024-01-01"
	// AcquisitionRate is the standard rate used for acquisition tax (Bezugsteuer) on services from abroad.
	AcquisitionRate Percent = 810
)

// NetRate is one approved net tax rate (Saldosteuersatz) and the activity it is for; the first is the default.
type NetRate struct {
	Label string  `json:"label"`
	Rate  Percent `json:"rate"`
}

type Settings struct {
	Method string
	Rates  []NetRate
}

// Sale is one document's VAT groups in CHF, signed: credit notes and reversed originals are negative.
type Sale struct {
	Ref        string
	SupplyDate string // YYYY-MM-DD: the end of the service period, the service date or the issue date
	Groups     []Group
}

// Purchase is one booked expense in CHF.
type Purchase struct {
	Ref               string
	SupplyDate        string
	Box               string // "400" materials and services, "405" investments and other costs
	DeductibleVAT     Money  // Swiss input tax claimed on the supplier's invoice
	ReverseCharge     bool   // a service from a supplier abroad: acquisition tax (MWSTG art. 45)
	Net               Money  // the acquisition tax base
	DeductiblePercent Percent
}

// Line is one Ziffer. A rate line has a base, a rate and the tax the form computes from them; any other line an amount.
type Line struct {
	Ziffer  string  `json:"ziffer"`
	LabelDE string  `json:"label_de"`
	LabelEN string  `json:"label_en"`
	Kind    string  `json:"kind"` // amount | rate | total
	Amount  Money   `json:"amount"`
	Base    Money   `json:"base"`
	Rate    Percent `json:"rate"`
	Tax     Money   `json:"tax"`
	Sources int     `json:"sources"` // documents behind the figure
	Tracked bool    `json:"tracked"` // false: Helvetly has no data for it, so it is always 0
}

type Warning struct {
	Code    string   `json:"code"`
	Message string   `json:"message"`
	Refs    []string `json:"refs"`
}

type Return struct {
	Method   string    `json:"method"`
	Lines    []Line    `json:"lines"`
	Warnings []Warning `json:"warnings"`
}

// Line returns the line with that Ziffer, or a zero Line.
func (r Return) Line(ziffer string) Line {
	for _, l := range r.Lines {
		if l.Ziffer == ziffer {
			return l
		}
	}
	return Line{}
}

type label struct{ de, en string }

var labels = map[string]label{
	"200":  {"Total der vereinbarten bzw. vereinnahmten Entgelte", "Total agreed or received consideration"},
	"205":  {"In Ziffer 200 enthaltene Entgelte aus von der Steuer ausgenommenen Leistungen, für die optiert wird", "Exempt supplies taxed by option, included in 200"},
	"220":  {"Von der Steuer befreite Leistungen (u.a. Exporte)", "Tax-free supplies (e.g. exports)"},
	"221":  {"Leistungen im Ausland (Ort der Leistung im Ausland)", "Supplies abroad (place of supply abroad)"},
	"225":  {"Übertragung im Meldeverfahren", "Transfers under the notification procedure"},
	"230":  {"Von der Steuer ausgenommene Inlandleistungen, für die nicht optiert wird", "Exempt domestic supplies without option"},
	"235":  {"Entgeltsminderungen wie Skonti, Rabatte usw.", "Reductions of consideration (discounts, rebates)"},
	"280":  {"Diverses", "Miscellaneous"},
	"289":  {"Abzüge (Total Ziffern 220 bis 280)", "Deductions (total of 220 to 280)"},
	"299":  {"Steuerbarer Gesamtumsatz (Ziffer 200 abzüglich Ziffer 289)", "Taxable turnover (200 less 289)"},
	"302":  {"Normalsatz 7,7 % (Leistungen bis 31.12.2023)", "Standard rate 7.7% (supplies until 2023-12-31)"},
	"303":  {"Normalsatz 8,1 % (Leistungen ab 01.01.2024)", "Standard rate 8.1% (supplies from 2024-01-01)"},
	"312":  {"Reduzierter Satz 2,5 % (Leistungen bis 31.12.2023)", "Reduced rate 2.5% (supplies until 2023-12-31)"},
	"313":  {"Reduzierter Satz 2,6 % (Leistungen ab 01.01.2024)", "Reduced rate 2.6% (supplies from 2024-01-01)"},
	"342":  {"Beherbergungssatz 3,7 % (Leistungen bis 31.12.2023)", "Accommodation rate 3.7% (supplies until 2023-12-31)"},
	"343":  {"Beherbergungssatz 3,8 % (Leistungen ab 01.01.2024)", "Accommodation rate 3.8% (supplies from 2024-01-01)"},
	"323":  {"1. Saldosteuersatz (Leistungen ab 01.01.2024)", "First net tax rate (supplies from 2024-01-01)"},
	"333":  {"2. Saldosteuersatz (Leistungen ab 01.01.2024)", "Second net tax rate (supplies from 2024-01-01)"},
	"323+": {"Weiterer Saldosteuersatz (Beiblatt)", "Further net tax rate (supplementary sheet)"},
	"383":  {"Bezugsteuer (Leistungen ab 01.01.2024)", "Acquisition tax (supplies from 2024-01-01)"},
	"399":  {"Total geschuldete Steuer", "Total tax due"},
	"400":  {"Vorsteuer auf Material- und Dienstleistungsaufwand", "Input tax on materials and services"},
	"405":  {"Vorsteuer auf Investitionen und übrigem Betriebsaufwand", "Input tax on investments and other operating costs"},
	"410":  {"Einlageentsteuerung", "Subsequent input tax deduction"},
	"415":  {"Vorsteuerkorrekturen: gemischte Verwendung, Eigenverbrauch", "Input tax corrections: mixed use, own use"},
	"420":  {"Vorsteuerkürzungen: Nicht-Entgelte wie Subventionen", "Input tax reductions: non-consideration such as subsidies"},
	"479":  {"Total Vorsteuer", "Total input tax"},
	"500":  {"Zu bezahlender Betrag", "Amount payable"},
	"510":  {"Guthaben der steuerpflichtigen Person", "Credit balance of the taxable person"},
	"900":  {"Subventionen, Tourismusabgaben u. ä. (Art. 18 Abs. 2 Bst. a–c)", "Subsidies, tourism levies and similar (art. 18 para. 2 a–c)"},
	"910":  {"Spenden, Dividenden, Schadenersatz u. ä. (Art. 18 Abs. 2 Bst. d–l)", "Donations, dividends, damages and similar (art. 18 para. 2 d–l)"},
}

// statutory maps a Swiss VAT rate to its rate line and whether it is a rate from 2024 on.
var statutory = map[Percent]struct {
	ziffer string
	since  bool
}{810: {"303", true}, 260: {"313", true}, 380: {"343", true}, 770: {"302", false}, 250: {"312", false}, 370: {"342", false}}

// exemptBox is the deduction line of each non-standard EN 16931 category; O (outside the scope) is no turnover.
var exemptBox = map[string]string{"Z": "220", "G": "220", "K": "220", "AE": "221", "E": "230"}

// Untracked figures: Helvetly records nothing that feeds them, so they stay 0 and say so.
var untracked = map[string]bool{"205": true, "225": true, "235": true, "280": true, "410": true, "415": true, "420": true, "900": true, "910": true}

type builder struct {
	lines    map[string]*Line
	warnings map[string]*Warning
	order    []string
}

func (b *builder) line(ziffer, kind string) *Line {
	if l, ok := b.lines[ziffer]; ok {
		return l
	}
	lb := labels[ziffer]
	l := &Line{Ziffer: ziffer, LabelDE: lb.de, LabelEN: lb.en, Kind: kind, Tracked: !untracked[ziffer]}
	b.lines[ziffer] = l
	return l
}

func (b *builder) warn(code, msg, ref string) {
	w, ok := b.warnings[code]
	if !ok {
		w = &Warning{Code: code, Message: msg, Refs: []string{}}
		b.warnings[code] = w
		b.order = append(b.order, code)
	}
	if ref != "" && (len(w.Refs) == 0 || w.Refs[len(w.Refs)-1] != ref) {
		w.Refs = append(w.Refs, ref)
	}
}

// Compute builds the return of one period.
func Compute(s Settings, sales []Sale, purchases []Purchase) Return {
	b := &builder{lines: map[string]*Line{}, warnings: map[string]*Warning{}}
	sss := s.Method == NetTaxRate
	rateLines := effectiveRateLines
	if sss {
		rateLines = netRateLines(b, s.Rates)
	}
	for _, z := range rateLines {
		b.line(z, "rate")
	}
	if !sss {
		for r, st := range statutory {
			b.lines[st.ziffer].Rate = r
		}
	}
	for _, sale := range sales {
		for _, g := range sale.Groups {
			amount := g.TaxableAmount
			if sss {
				amount += g.VATAmount // the net tax rate applies to turnover including VAT (art. 37 para. 2)
			}
			if g.Category == "O" {
				b.warn("outside_scope", "Lines outside the scope of VAT (category O) are not turnover and are left out.", sale.Ref)
				continue
			}
			b.line("200", "amount").add(amount)
			if box, ok := exemptBox[g.Category]; ok {
				b.line(box, "amount").add(amount)
				continue
			}
			b.taxable(sss, sale, g, amount)
		}
	}
	for _, p := range purchases {
		b.purchase(sss, p)
	}
	return b.finish(sss, rateLines)
}

var effectiveRateLines = []string{"302", "303", "312", "313", "342", "343"}

func netRateLines(b *builder, rates []NetRate) []string {
	out := []string{"323", "333"}
	for i := 2; i < len(rates); i++ {
		out = append(out, "323+"+rates[i].Label)
	}
	for i, z := range out {
		l := b.line(z, "rate")
		if i >= 2 { // reported on the supplementary sheet, which has no Ziffer of its own
			lb := labels["323+"]
			l.Ziffer, l.LabelDE, l.LabelEN = "", lb.de+": "+rates[i].Label, lb.en+": "+rates[i].Label
		}
		if i < len(rates) {
			l.Rate = rates[i].Rate
		}
	}
	if len(rates) > 1 {
		b.warn("net_rate_split", "Several net tax rates are set: all taxable turnover is shown at the first one. Split it by activity before filing.", "")
	}
	return out
}

func (l *Line) add(m Money) {
	l.Amount += m
	l.Sources++
}

func (b *builder) taxable(sss bool, sale Sale, g Group, amount Money) {
	before := sale.SupplyDate < rateChange
	if sss {
		if before {
			b.warn("net_rate_before_2024", "Supplies before 2024 need the net tax rates of that time and are not on a rate line.", sale.Ref)
			return
		}
		l := b.lines["323"]
		l.Base += amount
		l.Sources++
		return
	}
	st, ok := statutory[g.Rate]
	if g.Category != "S" || !ok {
		b.warn("unknown_rate", "Lines with a rate that is not a Swiss VAT rate are in Ziffer 200 but on no rate line.", sale.Ref)
		return
	}
	if st.since == before {
		b.warn("rate_date_mismatch", "The VAT rate does not match the date of supply: check the rate or the service date.", sale.Ref)
	}
	l := b.lines[st.ziffer]
	l.Base += amount
	l.Sources++
}

func (b *builder) purchase(sss bool, p Purchase) {
	if p.ReverseCharge {
		if p.SupplyDate < rateChange {
			b.warn("acquisition_before_2024", "Acquisition tax on services before 2024 is at the former rates and is not included.", p.Ref)
			return
		}
		l := b.line("383", "rate")
		l.Rate = AcquisitionRate
		l.Base += p.Net
		l.Sources++
		if !sss { // deductible like any input tax, to the extent the service is used for taxable supplies
			if share := invoicecalc.Share(invoicecalc.Share(p.Net, AcquisitionRate), p.DeductiblePercent); share != 0 {
				b.line(p.Box, "amount").add(share)
			}
		}
		return
	}
	if sss || p.DeductibleVAT == 0 {
		return // under the net tax rate method input tax is in the rate; nothing to deduct
	}
	b.line(p.Box, "amount").add(p.DeductibleVAT)
}

func (b *builder) finish(sss bool, rateLines []string) Return {
	b.line("383", "rate").Rate = AcquisitionRate
	var tax Money
	for _, z := range append(rateLines, "383") {
		l := b.lines[z]
		l.Tax = invoicecalc.Share(l.Base, l.Rate)
		tax += l.Tax
	}
	amount := func(z string) Money { return b.line(z, "amount").Amount }
	deductions := amount("220") + amount("221") + amount("225") + amount("230") + amount("235") + amount("280")
	b.line("289", "total").Amount = deductions
	b.line("299", "total").Amount = amount("200") - deductions
	b.line("399", "total").Amount = tax
	order := []string{"200", "205", "220", "221", "225", "230", "235", "280", "289", "299"}
	order = append(order, rateLines...)
	order = append(order, "383", "399")
	var input Money
	if !sss {
		input = amount("400") + amount("405") + amount("410") + amount("415") - amount("420")
		b.line("479", "total").Amount = input
		order = append(order, "400", "405", "410", "415", "420", "479")
	}
	b.line("500", "total").Amount = max(tax-input, 0)
	b.line("510", "total").Amount = max(input-tax, 0)
	order = append(order, "500", "510", "900", "910")
	r := Return{Method: Effective, Lines: make([]Line, 0, len(order)), Warnings: make([]Warning, 0, len(b.order))}
	if sss {
		r.Method = NetTaxRate
	}
	for _, z := range order {
		r.Lines = append(r.Lines, *b.line(z, "amount"))
	}
	for _, c := range b.order {
		r.Warnings = append(r.Warnings, *b.warnings[c])
	}
	return r
}

// Portion is the part of a document's VAT groups that a payment of paid out of payable covers (received basis,
// MWSTG art. 40 para. 1 b): each amount × paid / payable, rounded half away from zero to the minor unit.
func Portion(groups []Group, paid, payable Money) []Group {
	if payable == 0 {
		return nil
	}
	out := make([]Group, len(groups))
	for i, g := range groups {
		g.TaxableAmount = scale(g.TaxableAmount, paid, payable)
		g.VATAmount = scale(g.VATAmount, paid, payable)
		out[i] = g
	}
	return out
}

func scale(m, num, den Money) Money {
	n := new(big.Int).Mul(big.NewInt(int64(m)), big.NewInt(int64(num)))
	d := big.NewInt(int64(den))
	if d.Sign() < 0 {
		n.Neg(n)
		d.Neg(d)
	}
	q, r := new(big.Int).QuoRem(n, d, new(big.Int))
	if new(big.Int).Mul(new(big.Int).Abs(r), big.NewInt(2)).Cmp(d) >= 0 {
		q.Add(q, big.NewInt(int64(n.Sign())))
	}
	return Money(q.Int64())
}
