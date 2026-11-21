package imports

import (
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
)

// receiptReading is receipt reading v2 as the model answers it and, once checkReceipt has run, as the form gets it:
// text trimmed, codes upper case, dates and decimals valid (else null), the category resolved to one of the
// workspace's, and each part's confidence lowered to low (with a message in issues) where the figures disagree.
type receiptReading struct {
	Supplier struct {
		Name      *string `json:"name"`
		VATNumber *string `json:"vat_number"`
		Country   *string `json:"country"`
		IBAN      *string `json:"iban"`
	} `json:"supplier"`
	Document struct {
		Type          *string `json:"type"`
		Number        *string `json:"number"`
		Date          *string `json:"date"`
		DueDate       *string `json:"due_date"`
		ServicePeriod struct {
			From *string `json:"from"`
			To   *string `json:"to"`
		} `json:"service_period"`
	} `json:"document"`
	Description *string `json:"description"`
	Currency    *string `json:"currency"`
	Totals      struct {
		Net   *string `json:"net"`
		VAT   *string `json:"vat"`
		Gross *string `json:"gross"`
	} `json:"totals"`
	VATBreakdown []receiptBand `json:"vat_breakdown"`
	Items        []receiptItem `json:"items"`
	Payment      struct {
		Status string  `json:"status"`
		Method *string `json:"method"`
		PaidOn *string `json:"paid_on"`
	} `json:"payment"`
	ReverseCharge bool                 `json:"reverse_charge"`
	Category      *receiptCategoryPick `json:"category"`
	Confidence    map[string]string    `json:"confidence"`
	Issues        map[string]string    `json:"issues"`
}

type receiptBand struct {
	Rate  *string `json:"rate"`
	Net   *string `json:"net"`
	VAT   *string `json:"vat"`
	Gross *string `json:"gross"`
}

type receiptItem struct {
	Date        *string `json:"date"`
	Description *string `json:"description"`
	Quantity    *string `json:"quantity"`
	UnitPrice   *string `json:"unit_price"`
	Amount      *string `json:"amount"`
	VATRate     *string `json:"vat_rate"`
	Category    *string `json:"category"`    // the model's key
	CategoryID  *string `json:"category_id"` // the workspace's category it names
}

// receiptCategoryPick: the model's key, confidence (0–1) and reason; checkReceipt adds the category it names.
type receiptCategoryPick struct {
	Key        *string `json:"key"`
	Confidence float64 `json:"confidence"`
	Reason     *string `json:"reason"`
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Account    string  `json:"account_code"`
	Preset     *string `json:"preset"` // the catalogue entry the category still is, for showing its name translated
}

const receiptMaxItems = 200

var (
	receiptCountry  = regexp.MustCompile(`^[A-Z]{2}$`)
	receiptCurrency = regexp.MustCompile(`^[A-Z]{3}$`)
	receiptMethods  = []string{"card", "cash", "bank_transfer", "twint", "other"}
)

// checkReceipt reads the model's record and checks it. The figures are checked against each other: the totals'
// net and VAT add up to the gross, each band's too, the bands to the gross total, the items to the gross or net
// total, and a Swiss supplier's rates are Swiss ones. A disagreement keeps the figures but sets the part's
// confidence to low with a message: the person checks it, nothing is silently dropped.
func checkReceipt(raw json.RawMessage, categories []receiptCategory) (receiptReading, error) {
	var r receiptReading
	if json.Unmarshal(raw, &r) != nil {
		return r, auth.Error(http.StatusBadGateway, "receipt_unreadable", "The AI model's answer could not be read. Try again or enter the details yourself.", nil)
	}
	confidence, issues := map[string]string{}, map[string]string{}
	for _, g := range receiptGroups {
		confidence[g] = "medium"
		if l := r.Confidence[g]; l == "high" || l == "low" {
			confidence[g] = l
		}
	}
	low := func(group, message string) {
		confidence[group] = "low"
		if issues[group] == "" {
			issues[group] = message
		}
	}

	r.Supplier.Name, r.Supplier.VATNumber, r.Description = trimmed(r.Supplier.Name), trimmed(r.Supplier.VATNumber), trimmed(r.Description)
	r.Supplier.IBAN = trimmed(r.Supplier.IBAN)
	if r.Supplier.IBAN != nil {
		iban := strings.ToUpper(strings.ReplaceAll(*r.Supplier.IBAN, " ", ""))
		r.Supplier.IBAN = &iban
	}
	r.Supplier.Country = codeOf(r.Supplier.Country, receiptCountry)
	r.Currency = codeOf(r.Currency, receiptCurrency)
	r.Document.Number = trimmed(r.Document.Number)
	if t := trimmed(r.Document.Type); t == nil || !slices.Contains([]string{"receipt", "invoice", "credit_note"}, *t) {
		r.Document.Type = nil
	}
	for group, dates := range map[string][]**string{
		"document": {&r.Document.Date, &r.Document.DueDate, &r.Document.ServicePeriod.From, &r.Document.ServicePeriod.To},
		"payment":  {&r.Payment.PaidOn},
	} {
		for _, d := range dates {
			if *d = trimmed(*d); *d != nil {
				if _, err := time.Parse(time.DateOnly, **d); err != nil {
					*d = nil
					low(group, "A date could not be read; check it.")
				}
			}
		}
	}
	if !slices.Contains([]string{"paid", "unpaid"}, r.Payment.Status) {
		r.Payment.Status = "unknown"
	}
	if m := trimmed(r.Payment.Method); m == nil || !slices.Contains(receiptMethods, *m) {
		r.Payment.Method = nil
	}

	// Totals: a gross the document leaves out is its net plus VAT (arithmetic, not a guess).
	net, netOK := money(&r.Totals.Net, "totals", low)
	vat, vatOK := money(&r.Totals.VAT, "totals", low)
	gross, grossOK := money(&r.Totals.Gross, "totals", low)
	if !grossOK && netOK && vatOK {
		gross, grossOK = net+vat, true
		r.Totals.Gross = ptr((net + vat).String())
	}
	if netOK && vatOK && grossOK && !near(net+vat, gross, 2) {
		low("totals", "The net and VAT totals do not add up to the gross total.")
	}

	if r.VATBreakdown == nil {
		r.VATBreakdown = []receiptBand{}
	}
	var bandsGross invoicecalc.Money
	bandsComplete := len(r.VATBreakdown) > 0
	for i := range r.VATBreakdown {
		b := &r.VATBreakdown[i]
		rate, rateOK := percent(&b.Rate)
		bn, bnOK := money(&b.Net, "vat_breakdown", low)
		bv, bvOK := money(&b.VAT, "vat_breakdown", low)
		bg, bgOK := money(&b.Gross, "vat_breakdown", low)
		if !bgOK && bnOK && bvOK {
			bg, bgOK = bn+bv, true
			b.Gross = ptr((bn + bv).String())
		}
		switch {
		case !rateOK:
			low("vat_breakdown", "A VAT band has no readable rate; check the amounts.")
		case !swissRate(value(r.Supplier.Country), r.Document.Date, rate):
			low("vat_breakdown", "Swiss VAT is 8.1, 2.6 or 3.8 % (7.7, 2.5 or 3.7 % before 2024), or 0.")
		}
		if bnOK && bvOK && bgOK && !near(bn+bv, bg, 2) {
			low("vat_breakdown", "A VAT band's net and VAT do not add up to its gross.")
		}
		bandsGross += bg
		bandsComplete = bandsComplete && bgOK
	}
	if bandsComplete && grossOK && !near(bandsGross, gross, max(2, len(r.VATBreakdown))) {
		low("vat_breakdown", "The VAT breakdown does not add up to the gross total.")
	}

	switch {
	case r.ReverseCharge:
		issues["reverse_charge"] = "This receipt says the recipient owes the VAT (reverse charge), which the form cannot record yet; enter the amounts yourself."
	case len(r.VATBreakdown) == 0 && grossOK: // no rate shown is never a default rate
		low("vat_breakdown", "The receipt shows no VAT rate, so no amount was filled in; enter it yourself.")
	}

	if r.Items == nil {
		r.Items = []receiptItem{}
	}
	if len(r.Items) > receiptMaxItems {
		r.Items = r.Items[:receiptMaxItems]
		low("items", "The document lists more items than can be shown; only the first 200 are.")
	}
	var itemsSum invoicecalc.Money
	itemsComplete := len(r.Items) > 0
	for i := range r.Items {
		it := &r.Items[i]
		it.Description = trimmed(it.Description)
		if it.Date = trimmed(it.Date); it.Date != nil {
			if _, err := time.Parse(time.DateOnly, *it.Date); err != nil {
				it.Date = nil
				low("items", "A date could not be read; check it.")
			}
		}
		if q := trimmed(it.Quantity); q != nil {
			if n, ok := invoicecalc.ParseQuantity(*q); ok {
				it.Quantity = ptr(n.String())
			} else {
				it.Quantity = nil
			}
		}
		_, _ = money(&it.UnitPrice, "items", low)
		amount, ok := money(&it.Amount, "items", low)
		itemsSum += amount
		itemsComplete = itemsComplete && ok
		if _, ok := percent(&it.VATRate); !ok {
			it.VATRate = nil
		}
		it.CategoryID = nil
		if c := findCategory(categories, trimmed(it.Category)); c != nil {
			it.Category, it.CategoryID = &c.Key, &c.ID
		} else {
			it.Category = nil
		}
	}
	tolerance := max(2, len(r.Items))
	if itemsComplete && (grossOK || netOK) && !(grossOK && near(itemsSum, gross, tolerance)) && !(netOK && near(itemsSum, net, tolerance)) {
		low("items", "The line items do not add up to the total.")
	}

	if pick := r.Category; pick != nil {
		key := trimmed(pick.Key)
		c := findCategory(categories, key)
		switch {
		case c != nil:
			pick.Key, pick.ID, pick.Name, pick.Account, pick.Preset = &c.Key, c.ID, c.Name, c.AccountCode, c.Preset
			pick.Confidence, pick.Reason = min(1, max(0, pick.Confidence)), trimmed(pick.Reason)
		case key != nil:
			issues["category"] = "The suggested category is not one of this workspace's; choose one."
			r.Category = nil
		default:
			r.Category = nil
		}
	}
	r.Confidence, r.Issues = confidence, issues
	return r, nil
}

func findCategory(list []receiptCategory, key *string) *receiptCategory {
	if key == nil {
		return nil
	}
	for i, c := range list {
		if strings.EqualFold(c.Key, *key) || c.ID == *key {
			return &list[i]
		}
	}
	return nil
}

// trimmed trims a string; blank is null.
func trimmed(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}

// codeOf upper-cases a code and keeps it only when it has the pattern's form.
func codeOf(s *string, pattern *regexp.Regexp) *string {
	if s = trimmed(s); s == nil {
		return nil
	}
	c := strings.ToUpper(*s)
	if !pattern.MatchString(c) {
		return nil
	}
	return &c
}

// money writes an amount in its canonical form ("108.10"); one that cannot be read is null and lowers its group.
func money(s **string, group string, low func(group, message string)) (invoicecalc.Money, bool) {
	if *s = trimmed(*s); *s == nil {
		return 0, false
	}
	m, ok := invoicecalc.ParseMoney(**s)
	if !ok {
		*s = nil
		low(group, "An amount could not be read; check it.")
		return 0, false
	}
	*s = ptr(m.String())
	return m, true
}

// percent writes a rate in its short form ("8.1"); one that cannot be read is null.
func percent(s **string) (invoicecalc.Percent, bool) {
	if *s = trimmed(*s); *s == nil {
		return 0, false
	}
	p, ok := invoicecalc.ParsePercent(strings.TrimSuffix(**s, "%"))
	if !ok {
		*s = nil
		return 0, false
	}
	*s = ptr(p.String())
	return p, true
}

// near: a and b differ by at most the given cents (one rounding per summand).
func near(a, b invoicecalc.Money, cents int) bool {
	d := a - b
	return d <= invoicecalc.Money(cents) && -d <= invoicecalc.Money(cents)
}

func ptr[T any](v T) *T { return &v }
