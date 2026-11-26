package invoices

import (
	"encoding/json"
	"fmt"
	"maps"
	"regexp"
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

// parser reads JSON values field by field, collecting a message per invalid field (key as in the request,
// lines as "lines.0.quantity").
type parser struct{ invalid map[string]string }

func newParser() *parser { return &parser{invalid: map[string]string{}} }

func (p *parser) fail(key, msg string) {
	if p.invalid[key] == "" {
		p.invalid[key] = msg
	}
}

func (p *parser) err() error {
	if len(p.invalid) > 0 {
		return validationFailed(p.invalid)
	}
	return nil
}

func isNull(raw json.RawMessage) bool { return string(raw) == "null" }

// MaxDocumentText is the longest intro or footer text of an invoice, quote or default (characters, not bytes);
// the editors count the same way (platform document-parts.tsx).
const MaxDocumentText = 800

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

// required: like text, but blank is refused.
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

// decimal reads a decimal given as a JSON string ("12.50") or number (12.5, read from its literal, never a float).
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
	q, ok := invoicecalc.ParseQuantity(s)
	return int64(q), ok
}

func parsePercent(s string) (int64, bool) {
	r, ok := invoicecalc.ParsePercent(s)
	return int64(r), ok
}

// object decodes a JSON object, refusing keys not in allowed (400, as for unknown top-level fields).
func object(raw json.RawMessage, what string, allowed ...string) (map[string]json.RawMessage, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return nil, badRequest(what + " must be a JSON object.")
	}
	for _, k := range slices.Sorted(maps.Keys(m)) {
		if !slices.Contains(allowed, k) {
			return nil, badRequest(fmt.Sprintf("Unknown field %q in %s.", k, what))
		}
	}
	return m, nil
}

// keepBlank: text, except that a blank string stays "" (a deliberate "none") instead of becoming null.
func (p *parser) keepBlank(key string, raw json.RawMessage, max int) *string {
	v := p.text(key, raw, max, nil)
	if _, failed := p.invalid[key]; v == nil && !failed && !isNull(raw) {
		return new(string)
	}
	return v
}

// ---- invoice input ----

var invoiceKeys = []string{"client_id", "kind", "prepayment_ids", "issue_date", "due_date", "service_date", "service_date_end", "currency", "language",
	"vat_mode", "reference", "client_number_display", "contract_reference", "contract_document_id", "tax_currency_rate", "intro", "footer", "note", "discount_percent", "lines", "payment_methods", "reminders_enabled", "instalments"}

var lineKeys = []string{"description", "quantity", "unit", "unit_price", "discount_percent", "vat_category", "vat_rate",
	"vat_exemption_code", "vat_exemption_reason", "catalogue_price_basis", "catalogue_unit_price", "catalogue_currency"}

const (
	maxDescription = 1201 // a catalogue item's name (200) + "\n" + its description (1000)
	maxLines       = 200
	maxPrepayments = 20
	maxQuantity    = 1_000_000_000                     // 1'000'000 in thousandths
	maxPrice       = 10_000_000_000                    // 100'000'000.00 in cents
	maxPayable     = invoicecalc.Money(99_999_999_999) // 999'999'999.99, the QR bill's limit
)

// applyInput sets the InvoiceInput fields present in body on the draft. Lines are read after vat_mode, so their
// defaults follow it. A credit note keeps its invoice's client, currency and VAT mode; a debit note or a
// correction its client and currency. inv.Kind is the kind being created or the draft's own.
func applyInput(inv *store.Invoice, body map[string]json.RawMessage, set Settings) error {
	invalid, err := checkInput(inv, body, set)
	if err == nil && len(invalid) > 0 {
		err = validationFailed(invalid)
	}
	return err
}

// checkInput is applyInput's create rules: a message per invalid field (none when the draft is valid) and an error
// for a malformed body (unknown fields, a non-object).
func checkInput(inv *store.Invoice, body map[string]json.RawMessage, set Settings) (map[string]string, error) {
	for _, k := range slices.Sorted(maps.Keys(body)) {
		if !slices.Contains(invoiceKeys, k) {
			return nil, badRequest(fmt.Sprintf("Unknown field %q.", k))
		}
	}
	p := newParser()
	markGenerated(inv)
	credit := inv.Kind == "credit_note"
	for _, k := range []string{"client_id", "currency", "vat_mode"} {
		if _, ok := body[k]; ok && (credit || (needsPreceding(inv.Kind) && k != "vat_mode")) {
			p.fail(k, "This document keeps its preceding invoice's client, currency and VAT mode.")
			delete(body, k)
		}
	}
	if _, ok := body["payment_methods"]; ok && credit {
		p.fail("payment_methods", "A credit note has nothing to pay.")
		delete(body, "payment_methods")
	}
	for _, k := range invoiceKeys {
		raw, ok := body[k]
		if !ok || k == "lines" {
			continue
		}
		switch k {
		case "client_id":
			inv.ClientID = p.required(k, raw, 100, nil, "Choose a client.")
		case "kind":
			if v := p.text(k, raw, 20, nil); v == nil || *v != inv.Kind {
				p.fail(k, "Create an invoice, partial, prepayment, proforma or self-billed invoice here; credit notes, "+
					"debit notes and corrections come from an issued invoice. A draft keeps its kind.")
			}
		case "prepayment_ids":
			inv.Prepayments = prepaymentIDs(p, raw, inv.Kind)
		case "issue_date":
			inv.IssueDate = p.required(k, raw, 10, date, "Enter the issue date.")
		case "due_date":
			inv.DueDate = p.required(k, raw, 10, date, "Enter the due date.")
		case "service_date":
			inv.ServiceDate = p.text(k, raw, 10, date)
		case "service_date_end":
			inv.ServiceDateEnd = p.text(k, raw, 10, date)
		case "currency":
			inv.Currency = p.required(k, raw, 3, twoDecimalCurrency, "Choose a currency.")
		case "language":
			inv.Language = p.required(k, raw, 2, oneOf("de", "fr", "it", "en"), "Choose a language.")
		case "vat_mode":
			inv.VATMode = p.required(k, raw, 10, oneOf(invoicecalc.Exclusive, invoicecalc.Inclusive, invoicecalc.None), "Choose a VAT mode.")
		case "reference":
			inv.Reference = p.text(k, raw, 100, nil)
		case "client_number_display":
			inv.ClientNumberDisplay = p.keepBlank(k, raw, 40)
		case "contract_reference":
			inv.ContractReference = p.text(k, raw, 100, nil)
		case "contract_document_id": // resolved against the workspace's documents by resolveContractDocument
			inv.ContractDocument = nil
			if id := p.text(k, raw, 100, nil); id != nil {
				inv.ContractDocument = &store.DocumentRef{ID: *id}
			}
		case "tax_currency_rate":
			inv.TaxCurrencyRate = p.text(k, raw, 19, fxRate)
		case "intro":
			inv.Intro = p.text(k, raw, MaxDocumentText, nil)
		case "footer":
			inv.Footer = p.text(k, raw, MaxDocumentText, nil)
		case "note":
			inv.Note = p.text(k, raw, 1000, nil)
		case "discount_percent":
			if n, ok := p.decimal(k, raw, parsePercent, "Enter a percentage from 0 to 100 with at most two decimals."); ok {
				inv.DiscountPercent = invoicecalc.Percent(n)
			}
		case "payment_methods":
			m, err := object(raw, "payment_methods", "qr_bill", "revolut")
			if err != nil {
				return nil, err
			}
			for key, into := range map[string]*bool{"qr_bill": &inv.PaymentMethods.QRBill, "revolut": &inv.PaymentMethods.Revolut} {
				if v, ok := m[key]; ok && (json.Unmarshal(v, into) != nil || isNull(v)) {
					p.fail(k+"."+key, "Choose true or false.")
				}
			}
		case "reminders_enabled":
			if isNull(raw) || json.Unmarshal(raw, &inv.RemindersEnabled) != nil {
				p.fail(k, "Choose true or false.")
			}
		case "instalments":
			sched, err := parseSchedule(p, raw, inv.Kind)
			if err != nil {
				return nil, err
			}
			inv.Instalments = sched
		}
	}
	if raw, ok := body["lines"]; ok {
		lines, err := parseLines(p, raw, inv.VATMode, set)
		if err != nil {
			return nil, err
		}
		inv.Lines = lines
	}
	if inv.ServiceDateEnd != nil && (inv.ServiceDate == nil || *inv.ServiceDateEnd < *inv.ServiceDate) {
		p.fail("service_date_end", "The end of the service period needs a start on or before it.")
	}
	if inv.VATMode == invoicecalc.None { // existing lines follow a switch to no VAT
		for i := range inv.Lines {
			inv.Lines[i].VATCategory, inv.Lines[i].VATRate = "O", 0
		}
	}
	if len(p.invalid) > 0 {
		return p.invalid, nil
	}
	compute(inv)
	return totalsIssues(*inv), nil
}

func validateTotals(inv store.Invoice) error {
	if invalid := totalsIssues(inv); invalid != nil {
		return validationFailed(invalid)
	}
	return nil
}

func totalsIssues(inv store.Invoice) map[string]string {
	if inv.Total < 0 {
		return map[string]string{"prepayment_ids": "The prepayments cannot exceed the final invoice's total."}
	}
	if inv.Payable() > maxPayable {
		return map[string]string{"lines": "The total cannot exceed 999'999'999.99."}
	}
	return nil
}

// twoDecimalCurrency: an ISO 4217 code with exactly two minor units (amounts are kept in hundredths).
func twoDecimalCurrency(v string) (string, string) {
	c, msg := clients.NormaliseCurrency(v)
	if msg == "" && !store.TwoDecimalCurrency(c) {
		msg = "Choose a currency with two decimals, such as CHF or EUR."
	}
	return c, msg
}

// vatexCodes: the official VATEX-EU codes (CEF VATEX code list), the only exemption codes accepted.
var vatexCodes = []string{"VATEX-EU-79-C", "VATEX-EU-132", "VATEX-EU-132-1A", "VATEX-EU-132-1B", "VATEX-EU-132-1C",
	"VATEX-EU-132-1D", "VATEX-EU-132-1E", "VATEX-EU-132-1F", "VATEX-EU-132-1G", "VATEX-EU-132-1H", "VATEX-EU-132-1I",
	"VATEX-EU-132-1J", "VATEX-EU-132-1K", "VATEX-EU-132-1L", "VATEX-EU-132-1M", "VATEX-EU-132-1N", "VATEX-EU-132-1O",
	"VATEX-EU-132-1P", "VATEX-EU-132-1Q", "VATEX-EU-143", "VATEX-EU-143-1A", "VATEX-EU-143-1B", "VATEX-EU-143-1C",
	"VATEX-EU-143-1D", "VATEX-EU-143-1E", "VATEX-EU-143-1F", "VATEX-EU-143-1FA", "VATEX-EU-143-1G", "VATEX-EU-143-1H",
	"VATEX-EU-143-1I", "VATEX-EU-143-1J", "VATEX-EU-143-1K", "VATEX-EU-143-1L", "VATEX-EU-148", "VATEX-EU-148-A",
	"VATEX-EU-148-B", "VATEX-EU-148-C", "VATEX-EU-148-D", "VATEX-EU-148-E", "VATEX-EU-148-F", "VATEX-EU-148-G",
	"VATEX-EU-151", "VATEX-EU-151-1A", "VATEX-EU-151-1AA", "VATEX-EU-151-1B", "VATEX-EU-151-1C", "VATEX-EU-151-1D",
	"VATEX-EU-151-1E", "VATEX-EU-309", "VATEX-EU-AE", "VATEX-EU-D", "VATEX-EU-F", "VATEX-EU-G", "VATEX-EU-I",
	"VATEX-EU-IC", "VATEX-EU-J", "VATEX-EU-O"}

func vatexCode(v string) (string, string) {
	if v = strings.ToUpper(v); !slices.Contains(vatexCodes, v) {
		return "", "Enter an official VATEX-EU code, such as VATEX-EU-AE."
	}
	return v, ""
}

// prepaymentIDs reads the prepayments a draft invoice deducts (ids only; resolvePrepayments reads them).
func prepaymentIDs(p *parser, raw json.RawMessage, kind string) []store.PrepaymentRef {
	const key = "prepayment_ids"
	var ids []string
	switch {
	case kind != "invoice":
		p.fail(key, "Only an invoice can deduct prepayments.")
		return nil
	case isNull(raw) || json.Unmarshal(raw, &ids) != nil:
		p.fail(key, "Enter a list of prepayment invoice ids.")
		return nil
	case len(ids) > maxPrepayments:
		p.fail(key, fmt.Sprintf("Deduct at most %d prepayments.", maxPrepayments))
		return nil
	}
	refs := make([]store.PrepaymentRef, 0, len(ids))
	for _, id := range ids {
		if id == "" || len(id) > 100 || slices.ContainsFunc(refs, func(r store.PrepaymentRef) bool { return r.ID == id }) {
			p.fail(key, "List each prepayment invoice once.")
			return nil
		}
		refs = append(refs, store.PrepaymentRef{ID: id})
	}
	return refs
}

// parseLines reads the lines array; omitted line fields take their defaults (category S at the default rate
// when VAT applies, else O at 0).
func parseLines(p *parser, raw json.RawMessage, vatMode string, set Settings) ([]store.InvoiceLine, error) {
	var items []json.RawMessage
	if isNull(raw) || json.Unmarshal(raw, &items) != nil {
		p.fail("lines", "Enter a list of lines.")
		return nil, nil
	}
	if len(items) > maxLines {
		p.fail("lines", fmt.Sprintf("Use at most %d lines.", maxLines))
		return nil, nil
	}
	lines := make([]store.InvoiceLine, 0, len(items))
	for i, item := range items {
		m, err := object(item, fmt.Sprintf("lines[%d]", i), lineKeys...)
		if err != nil {
			return nil, err
		}
		key := func(f string) string { return fmt.Sprintf("lines.%d.%s", i, f) }
		l := store.InvoiceLine{ID: auth.NewID("lin"), Position: i + 1, VATCategory: "O"}
		if vatMode != invoicecalc.None {
			l.VATCategory, l.VATRate = "S", set.DefaultVATRate
		}
		if raw, ok := m["description"]; ok { // may stay empty while drafting; issuing requires it
			l.Description = deref(p.text(key("description"), raw, maxDescription, nil))
		}
		if raw, ok := m["quantity"]; ok {
			if n, ok := p.decimal(key("quantity"), raw, parseQuantity, "Enter a quantity with at most three decimals."); ok {
				if n <= 0 || n > maxQuantity {
					p.fail(key("quantity"), "Enter a quantity above 0 and up to 1'000'000.")
				}
				l.Quantity = invoicecalc.Quantity(n)
			}
		} else {
			l.Quantity = 1000
		}
		if raw, ok := m["unit"]; ok {
			l.Unit = p.text(key("unit"), raw, 10, oneOf("hour", "day", "piece", "month", "km", "flat"))
		}
		if raw, ok := m["unit_price"]; !ok {
			p.fail(key("unit_price"), "Enter a unit price.")
		} else if n, ok := p.decimal(key("unit_price"), raw, parseMoney, "Enter a price of 0 or more with at most two decimals."); ok {
			if n > maxPrice {
				p.fail(key("unit_price"), "Enter a price up to 100'000'000.00.")
			}
			l.UnitPrice = invoicecalc.Money(n)
		}
		if m["catalogue_price_basis"] != nil || m["catalogue_unit_price"] != nil || m["catalogue_currency"] != nil {
			basis := p.required(key("catalogue_price_basis"), m["catalogue_price_basis"], 5, oneOf("net", "gross"), "Choose the catalogue price basis.")
			currency := p.required(key("catalogue_currency"), m["catalogue_currency"], 3, twoDecimalCurrency, "Choose the catalogue currency.")
			price, ok := p.decimal(key("catalogue_unit_price"), m["catalogue_unit_price"], parseMoney, "Enter the original catalogue unit price.")
			if ok && price > maxPrice {
				p.fail(key("catalogue_unit_price"), "The catalogue unit price exceeds the price limit.")
			}
			original := invoicecalc.Money(price)
			l.CataloguePriceBasis, l.CatalogueUnitPrice, l.CatalogueCurrency = &basis, &original, &currency
		}
		if raw, ok := m["discount_percent"]; ok {
			if n, ok := p.decimal(key("discount_percent"), raw, parsePercent, "Enter a percentage from 0 to 100 with at most two decimals."); ok {
				l.DiscountPercent = invoicecalc.Percent(n)
			}
		}
		if raw, ok := m["vat_category"]; ok {
			l.VATCategory = p.required(key("vat_category"), raw, 2, oneOf(invoicecalc.Categories...), "Choose a VAT category.")
			if l.VATCategory != "S" {
				l.VATRate = 0
			}
		}
		if raw, ok := m["vat_rate"]; ok {
			if n, ok := p.decimal(key("vat_rate"), raw, parsePercent, "Enter a VAT rate from 0 to 100 with at most two decimals."); ok {
				l.VATRate = invoicecalc.Percent(n)
			}
		}
		if raw, ok := m["vat_exemption_code"]; ok {
			l.VATExemptionCode = p.text(key("vat_exemption_code"), raw, 20, vatexCode)
		}
		if raw, ok := m["vat_exemption_reason"]; ok {
			l.VATExemptionReason = p.text(key("vat_exemption_reason"), raw, 300, nil)
		}
		switch {
		case vatMode == invoicecalc.None:
			l.VATCategory, l.VATRate = "O", 0
		case l.VATCategory == "S" && l.VATRate == 0:
			p.fail(key("vat_rate"), "A standard-rated line needs a rate above 0 (or choose zero-rated, Z).")
		case l.VATCategory != "S" && l.VATRate != 0:
			p.fail(key("vat_rate"), "Only standard-rated (S) lines have a VAT rate.")
		}
		lines = append(lines, l)
	}
	return lines, nil
}

// compute fills the draft's line amounts and totals; a final invoice's totals are those after its prepayments,
// which prepaid_total holds (gross).
func compute(inv *store.Invoice) invoicecalc.Totals {
	in := make([]invoicecalc.Line, len(inv.Lines))
	for i, l := range inv.Lines {
		in[i] = invoicecalc.Line{Quantity: l.Quantity, UnitPrice: l.UnitPrice, Discount: l.DiscountPercent, Category: l.VATCategory, Rate: l.VATRate}
	}
	t := invoicecalc.Compute(inv.VATMode, inv.Currency, in, inv.DiscountPercent)
	for i := range inv.Lines {
		inv.Lines[i].Amount = t.Amounts[i]
	}
	inv.PrepaidTotal = 0
	if len(inv.Prepayments) > 0 {
		prepaid := make([][]invoicecalc.Group, len(inv.Prepayments))
		for i, p := range inv.Prepayments {
			prepaid[i] = p.VATBreakdown
		}
		t, inv.PrepaidTotal = invoicecalc.Deduct(t, prepaid, inv.Currency)
	}
	inv.Subtotal, inv.DiscountAmount, inv.NetTotal, inv.VATBreakdown = t.Subtotal, t.DiscountAmount, t.NetTotal, t.Breakdown
	inv.VATTotal, inv.Total, inv.RoundingAmount = t.VATTotal, t.Total, t.RoundingAmount
	inv.AmountDue, inv.PayableTotal = t.Payable(), t.Payable()
	return t
}

func addDays(d string, days int) string {
	t, err := time.Parse(time.DateOnly, d)
	if err != nil {
		return d
	}
	return t.AddDate(0, 0, days).Format(time.DateOnly)
}

var fxRateText = regexp.MustCompile(`^\d{1,12}(\.\d{1,6})?$`)

// fxRate: an exchange rate entered by the user (RON per unit of the invoice currency), above 0, at most six decimals.
func fxRate(v string) (string, string) {
	if !fxRateText.MatchString(v) || strings.Trim(v, "0.") == "" {
		return "", "Enter the exchange rate as a number above 0 with at most six decimals, e.g. 4.9771."
	}
	return v, ""
}
