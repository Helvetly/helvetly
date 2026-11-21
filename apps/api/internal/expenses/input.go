package expenses

import (
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// parser reads JSON values field by field, collecting one message per invalid field ("lines.0.amount").
type parser struct{ invalid map[string]string }

func newParser() *parser { return &parser{invalid: map[string]string{}} }

func (p *parser) fail(key, msg string) {
	if p.invalid[key] == "" {
		p.invalid[key] = msg
	}
}

func isNull(raw json.RawMessage) bool { return string(raw) == "null" }

// text: trimmed, blank meaning nil, at most max characters, then normalised (when normalise is set).
func (p *parser) text(key string, raw json.RawMessage, max int, normalise func(string) (string, string)) *string {
	if isNull(raw) {
		return nil
	}
	var v string
	if json.Unmarshal(raw, &v) != nil {
		p.fail(key, "Enter text.")
		return nil
	}
	if v = strings.TrimSpace(strings.ReplaceAll(v, "\r\n", "\n")); v == "" {
		return nil
	}
	if utf8.RuneCountInString(v) > max {
		p.fail(key, fmt.Sprintf("Use at most %d characters.", max))
		return nil
	}
	if normalise != nil {
		var msg string
		if v, msg = normalise(v); msg != "" {
			p.fail(key, msg)
			return nil
		}
	}
	return &v
}

func (p *parser) required(key string, raw json.RawMessage, max int, normalise func(string) (string, string), msg string) string {
	v := p.text(key, raw, max, normalise)
	if v == nil {
		p.fail(key, msg)
		return ""
	}
	return *v
}

func oneOf(values ...string) func(string) (string, string) {
	return func(v string) (string, string) {
		if !slices.Contains(values, v) {
			return "", "Choose one of " + strings.Join(values, ", ") + "."
		}
		return v, ""
	}
}

func date(v string) (string, string) {
	if _, err := time.Parse(time.DateOnly, v); err != nil {
		return "", "Enter a date as YYYY-MM-DD."
	}
	return v, ""
}

// decimal reads a JSON string ("12.50") or number (read from its literal, never as a float).
func (p *parser) decimal(key string, raw json.RawMessage, parse func(string) (int64, bool), msg string) (int64, bool) {
	s := string(raw)
	if u, err := strconv.Unquote(s); err == nil {
		s = u
	}
	n, ok := parse(s)
	if !ok {
		p.fail(key, msg)
	}
	return n, ok
}

func parseMoney(s string) (int64, bool) {
	m, ok := invoicecalc.ParseMoney(s)
	return int64(m), ok
}

func parseQuantity(s string) (int64, bool) {
	n, ok := invoicecalc.ParseQuantity(s)
	return int64(n), ok && n > 0 && n <= 1_000_000_000_000
}

func parsePercent(s string) (int64, bool) {
	r, ok := invoicecalc.ParsePercent(s)
	return int64(r), ok
}

func parseRate(s string) (int64, bool) {
	r, ok := invoicecalc.ParseRate(s)
	return int64(r), ok && r <= 1_000_000*invoicecalc.RateOne
}

const (
	maxLines  = 20
	maxAmount = 10_000_000_000                    // 100'000'000.00 per line
	maxTotal  = invoicecalc.Money(99_999_999_999) // 999'999'999.99
)

var (
	inputKeys = []string{"supplier_name", "supplier_vat_number", "supplier_country", "reference", "description", "category_id", "document_date",
		"due_date", "currency", "amount_mode", "lines", "input_tax", "deductible_percent", "exchange_rate", "exchange_rate_date",
		"exchange_rate_source", "payment_status", "paid_on", "payment_method", "paid_by_member_id", "reimbursed_on", "note",
		"receipt_missing_reason", "reverse_charge", "input_tax_box", "entry_mode"}
	// What a booked expense still takes; a void one takes only its note.
	bookedKeys = []string{"payment_status", "paid_on", "payment_method", "paid_by_member_id", "reimbursed_on", "note"}
	lineKeys   = []string{"description", "amount", "vat_rate", "category_id", "quantity", "unit_price"}

	paymentMethods = []string{"bank_transfer", "cash", "card", "twint", "other"}
	rateSources    = []string{"estv_monthly", "estv_daily", "bank", "manual"}
)

// refs are the ids an input names, checked against the database by the caller.
type refs struct {
	categoryID, memberID *string
	category, member     bool // the key was present
	lines                bool // the lines were given: check their categories
}

// categoriesOf: the categories the expense names, its own and its lines'.
func categoriesOf(e store.Expense) []string {
	var ids []string
	if e.CategoryID != nil {
		ids = append(ids, *e.CategoryID)
	}
	for _, l := range e.Lines {
		if l.CategoryID != nil {
			ids = append(ids, *l.CategoryID)
		}
	}
	return ids
}

// applyInput sets the ExpenseInput fields present in body on e, then normalises what depends on what. It
// returns the category and member ids to check; today is the workspace's civil date.
func applyInput(e *store.Expense, body map[string]json.RawMessage, d store.WorkspaceDefaults, today string) (refs, error) {
	r, invalid, err := checkInput(e, body, d, today)
	if err == nil && len(invalid) > 0 {
		err = validationFailed(invalid)
	}
	return r, err
}

// CheckCreate applies the create rules to an ExpenseInput: the new draft (without its category and member, which
// the caller checks against the database), and a message per invalid field. The error is a malformed input (an
// unknown field). AI import uses it to review a record before creating it.
func CheckCreate(body map[string]json.RawMessage, d store.WorkspaceDefaults, user store.User, today string) (store.Expense, map[string]string, error) {
	e := newDraft(d, user)
	_, invalid, err := checkInput(&e, body, d, today)
	return e, invalid, err
}

// checkInput is applyInput's work: the per-field messages, or an error for a malformed input.
func checkInput(e *store.Expense, body map[string]json.RawMessage, d store.WorkspaceDefaults, today string) (refs, map[string]string, error) {
	var r refs
	for _, k := range slices.Sorted(maps.Keys(body)) {
		if !slices.Contains(inputKeys, k) {
			return r, nil, badRequest(fmt.Sprintf("Unknown field %q.", k))
		}
	}
	if e.Status != "draft" {
		allowed := bookedKeys
		if e.Status == "void" {
			allowed = []string{"note"}
		}
		for k := range body {
			if !slices.Contains(allowed, k) {
				return r, nil, errLocked
			}
		}
	}
	p := newParser()
	_, percentGiven := body["deductible_percent"]
	_, inputTaxGiven := body["input_tax"]
	for _, k := range inputKeys {
		raw, ok := body[k]
		if !ok || k == "lines" {
			continue
		}
		switch k {
		case "supplier_name":
			e.SupplierName = p.text(k, raw, 200, nil)
		case "supplier_vat_number":
			e.SupplierVATNumber = p.text(k, raw, 30, clients.NormaliseVATNumber)
		case "supplier_country":
			e.SupplierCountry = p.required(k, raw, 2, clients.NormaliseCountry, "Choose the supplier's country.")
		case "reference":
			e.Reference = p.text(k, raw, 100, nil)
		case "description":
			e.Description = p.text(k, raw, 500, nil)
		case "category_id":
			r.category, r.categoryID = true, p.text(k, raw, 100, nil)
			e.CategoryID = r.categoryID
		case "document_date":
			e.DocumentDate = p.text(k, raw, 10, date)
		case "due_date":
			e.DueDate = p.text(k, raw, 10, date)
		case "currency":
			e.Currency = p.required(k, raw, 3, clients.NormaliseCurrency, "Choose a currency.")
		case "amount_mode":
			e.AmountMode = p.required(k, raw, 5, oneOf("gross", "net"), "Choose gross or net.")
		case "input_tax":
			e.InputTax = p.required(k, raw, 7, oneOf("full", "partial", "none"), "Choose full, partial or none.")
		case "deductible_percent":
			if n, ok := p.decimal(k, raw, parsePercent, "Enter a percentage from 0 to 100 with at most two decimals."); ok {
				e.DeductiblePercent = invoicecalc.Percent(n)
			}
		case "exchange_rate":
			if n, ok := p.decimal(k, raw, parseRate, "Enter a rate above 0 with at most six decimals."); ok {
				e.ExchangeRate = invoicecalc.Rate(n)
			}
		case "exchange_rate_date":
			e.ExchangeRateDate = p.text(k, raw, 10, date)
		case "exchange_rate_source":
			e.ExchangeRateSource = p.text(k, raw, 20, oneOf(rateSources...))
		case "payment_status":
			e.PaymentStatus = p.required(k, raw, 6, oneOf("unpaid", "paid"), "Choose unpaid or paid.")
		case "paid_on":
			e.PaidOn = p.text(k, raw, 10, date)
		case "payment_method":
			e.PaymentMethod = p.text(k, raw, 20, oneOf(paymentMethods...))
		case "paid_by_member_id":
			r.member, r.memberID = true, p.text(k, raw, 100, nil)
			e.PaidByID = r.memberID
		case "reimbursed_on":
			e.ReimbursedOn = p.text(k, raw, 10, date)
		case "note":
			e.Note = p.text(k, raw, 1000, nil)
		case "receipt_missing_reason":
			e.ReceiptMissingReason = p.text(k, raw, 500, nil)
		case "reverse_charge":
			if err := json.Unmarshal(raw, &e.ReverseCharge); err != nil || isNull(raw) {
				p.fail(k, "Choose true or false.")
			}
		case "input_tax_box":
			e.InputTaxBox = p.text(k, raw, 3, oneOf("400", "405"))
		case "entry_mode":
			e.EntryMode = p.required(k, raw, 8, oneOf("single", "itemised"), "Choose single or itemised.")
		}
	}
	if raw, ok := body["lines"]; ok {
		lines, err := parseLines(p, raw, d)
		if err != nil {
			return r, nil, err
		}
		e.Lines, r.lines = lines, true
	}
	if e.EntryMode == "single" {
		for i, l := range e.Lines {
			if l.CategoryID != nil {
				p.fail(fmt.Sprintf("lines.%d.category_id", i), "Only an itemised expense gives a line its own category.")
			}
		}
	}
	normalise(p, e, body, percentGiven, inputTaxGiven, d, today)
	if len(p.invalid) > 0 {
		return r, p.invalid, nil
	}
	if e.Status == "draft" {
		compute(e, d.Currency)
	}
	if e.Total > maxTotal {
		return r, map[string]string{"lines": "The total cannot exceed 999'999'999.99."}, nil
	}
	return r, nil, nil
}

// normalise keeps the fields consistent with each other: input tax with its percentage, the payment with its
// date, the exchange rate with the currency.
func normalise(p *parser, e *store.Expense, body map[string]json.RawMessage, percentGiven, inputTaxGiven bool,
	d store.WorkspaceDefaults, today string) {
	_, countryGiven := body["supplier_country"]
	switch {
	case countryGiven && !percentGiven && !inputTaxGiven: // a new country sets the default; an explicit choice wins
		e.InputTax, e.DeductiblePercent = "none", 0
		if !ForeignVAT(e.SupplierCountry) && d.VATRegistered {
			e.InputTax, e.DeductiblePercent = "full", invoicecalc.Hundred
		}
	case percentGiven && !inputTaxGiven:
		e.InputTax = map[invoicecalc.Percent]string{0: "none", invoicecalc.Hundred: "full"}[e.DeductiblePercent]
		if e.InputTax == "" {
			e.InputTax = "partial"
		}
	case e.InputTax == "full":
		e.DeductiblePercent = invoicecalc.Hundred
	case e.InputTax == "none":
		e.DeductiblePercent = 0
	}
	switch {
	case e.InputTax == "full" && e.DeductiblePercent != invoicecalc.Hundred, e.InputTax == "none" && e.DeductiblePercent != 0:
		p.fail("deductible_percent", "Full input tax is 100 %, none is 0 %: choose partial for another share.")
	case e.InputTax == "partial" && (e.DeductiblePercent == 0 || e.DeductiblePercent == invoicecalc.Hundred):
		p.fail("deductible_percent", "Enter the deductible share, above 0 and below 100 %.")
	}

	if e.ReverseCharge && !ForeignVAT(e.SupplierCountry) {
		p.fail("reverse_charge", "Acquisition tax applies to services from a supplier abroad.")
	}
	if e.ReimbursedOn != nil && e.PaidByID == nil {
		p.fail("reimbursed_on", "Only an expense a member paid out of pocket is reimbursed.")
	}
	_, paymentStatusGiven := body["payment_status"]
	if !paymentStatusGiven || e.PaymentStatus != "unpaid" {
		if _, ok := body["paid_on"]; ok && e.PaidOn != nil {
			e.PaymentStatus = "paid"
		}
		if e.PaidByID != nil {
			e.PaymentStatus = "paid"
		}
	}
	if e.PaymentStatus == "unpaid" {
		e.PaidOn, e.PaymentMethod, e.PaidByID, e.ReimbursedOn = nil, nil, nil, nil
	} else if e.PaidOn == nil {
		e.PaidOn = e.DocumentDate
		if e.PaidOn == nil || *e.PaidOn > today {
			e.PaidOn = &today
		}
	}
	for _, f := range []struct {
		key string
		v   *string
	}{{"paid_on", e.PaidOn}, {"reimbursed_on", e.ReimbursedOn}} {
		if f.v != nil && *f.v > today {
			p.fail(f.key, "This date cannot be in the future.")
		}
	}
	if e.DueDate != nil && e.DocumentDate != nil && *e.DueDate < *e.DocumentDate {
		p.fail("due_date", "The due date cannot be before the document date.")
	}

	if e.Status == "draft" && e.Currency == d.Currency {
		e.ExchangeRate, e.ExchangeRateDate, e.ExchangeRateSource = invoicecalc.RateOne, nil, nil
	}
}

// parseLines reads the lines array; a line's VAT rate defaults to the workspace's when it is VAT-registered.
func parseLines(p *parser, raw json.RawMessage, d store.WorkspaceDefaults) ([]store.ExpenseLine, error) {
	var items []json.RawMessage
	if isNull(raw) || json.Unmarshal(raw, &items) != nil {
		p.fail("lines", "Enter a list of lines.")
		return nil, nil
	}
	if len(items) > maxLines {
		p.fail("lines", fmt.Sprintf("Use at most %d lines.", maxLines))
		return nil, nil
	}
	lines := make([]store.ExpenseLine, 0, len(items))
	for i, item := range items {
		var m map[string]json.RawMessage
		if err := json.Unmarshal(item, &m); err != nil || m == nil {
			return nil, badRequest(fmt.Sprintf("lines[%d] must be a JSON object.", i))
		}
		for _, k := range slices.Sorted(maps.Keys(m)) {
			if !slices.Contains(lineKeys, k) {
				return nil, badRequest(fmt.Sprintf("Unknown field %q in lines[%d].", k, i))
			}
		}
		key := func(f string) string { return fmt.Sprintf("lines.%d.%s", i, f) }
		l := store.ExpenseLine{ID: auth.NewID("exl"), Position: i + 1}
		if d.VATRegistered {
			l.VATRate = d.DefaultVATRate
		}
		if raw, ok := m["description"]; ok {
			l.Description = p.text(key("description"), raw, 200, nil)
		}
		if raw, ok := m["amount"]; !ok || isNull(raw) {
			p.fail(key("amount"), "Enter an amount.")
		} else if n, ok := p.decimal(key("amount"), raw, parseMoney, "Enter an amount of 0 or more with at most two decimals."); ok {
			if n > maxAmount {
				p.fail(key("amount"), "Enter an amount up to 100'000'000.00.")
			}
			l.Amount = invoicecalc.Money(n)
		}
		if raw, ok := m["vat_rate"]; ok {
			if n, ok := p.decimal(key("vat_rate"), raw, parsePercent, "Enter a VAT rate from 0 to 100 with at most two decimals."); ok {
				l.VATRate = invoicecalc.Percent(n)
			}
		}
		if raw, ok := m["category_id"]; ok {
			l.CategoryID = p.text(key("category_id"), raw, 100, nil)
		}
		if raw, ok := m["quantity"]; ok && !isNull(raw) {
			if n, ok := p.decimal(key("quantity"), raw, parseQuantity, "Enter a quantity above 0 with at most three decimals."); ok {
				q := invoicecalc.Quantity(n)
				l.Quantity = &q
			}
		}
		if raw, ok := m["unit_price"]; ok && !isNull(raw) {
			if n, ok := p.decimal(key("unit_price"), raw, parseMoney, "Enter a price of 0 or more with at most two decimals."); ok {
				if n > maxAmount {
					p.fail(key("unit_price"), "Enter a price up to 100'000'000.00.")
				}
				price := invoicecalc.Money(n)
				l.UnitPrice = &price
			}
		}
		lines = append(lines, l)
	}
	return lines, nil
}

// compute fills the totals, the per-rate breakdown with its deductible input tax, and the base-currency amounts
// (docs/expenses-contract.md, "Computation").
func compute(e *store.Expense, baseCurrency string) {
	mode := invoicecalc.Inclusive
	if e.AmountMode == "net" {
		mode = invoicecalc.Exclusive
	}
	in := make([]invoicecalc.Line, len(e.Lines))
	for i, l := range e.Lines {
		in[i] = invoicecalc.Line{Quantity: 1000, UnitPrice: l.Amount, Category: "O", Rate: l.VATRate}
		if l.VATRate > 0 {
			in[i].Category = "S"
		}
	}
	t := invoicecalc.Compute(mode, "", in, 0) // no cash rounding: an expense is what the receipt says
	e.VATBreakdown, e.DeductibleVAT = []store.ExpenseVAT{}, 0
	for _, g := range t.Breakdown {
		v := store.ExpenseVAT{Rate: g.Rate, TaxableAmount: g.TaxableAmount, VATAmount: g.VATAmount,
			DeductibleAmount: invoicecalc.Share(g.VATAmount, e.DeductiblePercent)}
		e.VATBreakdown = append(e.VATBreakdown, v)
		e.DeductibleVAT += v.DeductibleAmount
	}
	e.NetTotal, e.VATTotal, e.Total = t.NetTotal, t.VATTotal, t.Total
	e.Base.Currency = baseCurrency
	e.Base.Total = invoicecalc.Convert(e.Total, e.ExchangeRate)
	e.Base.VATTotal = invoicecalc.Convert(e.VATTotal, e.ExchangeRate)
	e.Base.NetTotal = e.Base.Total - e.Base.VATTotal
	e.Base.DeductibleVAT = invoicecalc.Convert(e.DeductibleVAT, e.ExchangeRate)
}

// ForeignVAT: VAT charged outside Switzerland and Liechtenstein, which is not reclaimable as Swiss input tax
// (MWSTG Art. 28; it may be refundable in its own country).
func ForeignVAT(country string) bool { return country != "CH" && country != "LI" }

// newDraft is an empty expense with the workspace's defaults.
func newDraft(d store.WorkspaceDefaults, user store.User) store.Expense {
	e := store.Expense{ID: auth.NewID("exp"), Status: "draft", Source: "manual", SupplierCountry: "CH", Currency: d.Currency, AmountMode: "gross", EntryMode: "single",
		InputTax: "none", ExchangeRate: invoicecalc.RateOne, PaymentStatus: "unpaid", Lines: []store.ExpenseLine{},
		CreatedBy: &store.Person{ID: user.ID, Name: user.Name}}
	if d.VATRegistered {
		e.InputTax, e.DeductiblePercent = "full", invoicecalc.Hundred
	}
	return e
}

// bookReasons: why a draft cannot be booked yet, as sentences for the person.
func bookReasons(e store.Expense, today string) []string {
	labels := map[string]string{"supplier_name": "Enter the supplier.", "document_date": "Enter the document date.",
		"category": "Choose a category.", "total": "Enter an amount above 0.",
		"exchange_rate": "Enter the exchange rate with its date and source.",
		"receipt":       "Attach the receipt, or say why there is none (substitute receipt)."}
	reasons := []string{}
	for _, f := range e.MissingFields {
		reasons = append(reasons, labels[f])
	}
	if e.DocumentDate != nil && *e.DocumentDate > today {
		reasons = append(reasons, "The document date cannot be in the future.")
	}
	return reasons
}
