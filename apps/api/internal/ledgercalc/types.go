// Package ledgercalc derives the double-entry journal from signed source documents (docs/ledger-contract.md):
// each row is one Buchungssatz, so every row balances by construction and nothing is stored or converted.
package ledgercalc

import "helvetly.com/api/internal/invoicecalc"

// Accounts maps each posting role to a Swiss KMU account code.
type Accounts struct {
	Receivables      string            `json:"receivables"`
	Revenue          string            `json:"revenue"`
	OutputVAT        string            `json:"output_vat"`
	Rounding         string            `json:"rounding"`
	Payables         string            `json:"payables"`
	MemberPayable    string            `json:"member_payable"`
	InputVATMaterial string            `json:"input_vat_material"`
	InputVATOther    string            `json:"input_vat_other"`
	Bank             map[string]string `json:"bank"`
}

// DefaultAccounts returns the KMU defaults; the map is fresh on each call so callers may change it.
func DefaultAccounts() Accounts {
	return Accounts{
		Receivables:      "1100",
		Revenue:          "3200",
		OutputVAT:        "2200",
		Rounding:         "3800",
		Payables:         "2000",
		MemberPayable:    "2210",
		InputVATMaterial: "1170",
		InputVATOther:    "1171",
		Bank: map[string]string{
			"bank_transfer": "1020",
			"card":          "1020",
			"twint":         "1020",
			"other":         "1020",
			"cash":          "1000",
		},
	}
}

// AccountName returns the German KMU name of a default account code, or "" for any other code.
func AccountName(code string) string {
	switch code {
	case "1000":
		return "Kasse"
	case "1020":
		return "Bank"
	case "1100":
		return "Debitoren"
	case "1170":
		return "Vorsteuer Material und Dienstleistungen"
	case "1171":
		return "Vorsteuer Investitionen und übriger Betriebsaufwand"
	case "2000":
		return "Kreditoren"
	case "2200":
		return "Geschuldete MWST"
	case "2210":
		return "Übrige kurzfristige Verbindlichkeiten"
	case "3200":
		return "Dienstleistungserlöse"
	case "3800":
		return "Erlösminderungen"
	}
	return ""
}

// Row is one balanced posting: Amount is above 0 and moves from Credit to Debit in Currency.
// Empty date strings mean none.
type Row struct {
	Date        string            `json:"date"`
	Ref         string            `json:"ref"`
	Description string            `json:"description"`
	Debit       string            `json:"debit"`
	Credit      string            `json:"credit"`
	Amount      invoicecalc.Money `json:"amount"`
	Currency    string            `json:"currency"`
	SourceType  string            `json:"source_type"`
	SourceID    string            `json:"source_id"`
}

// Invoice is an issued receivable document; Sign -1 reverses the whole document.
type Invoice struct {
	ID       string              `json:"id"`
	Ref      string              `json:"ref"`
	Party    string              `json:"party"`
	Date     string              `json:"date"`
	Currency string              `json:"currency"`
	Sign     int                 `json:"sign"`
	Groups   []invoicecalc.Group `json:"groups"`
	Rounding invoicecalc.Money   `json:"rounding"`
}

// Payment is a payment on an invoice, or a refund when Refund is true.
type Payment struct {
	InvoiceID string            `json:"invoice_id"`
	Ref       string            `json:"ref"`
	Date      string            `json:"date"`
	Method    string            `json:"method"`
	Currency  string            `json:"currency"`
	Amount    invoicecalc.Money `json:"amount"`
	Refund    bool              `json:"refund"`
}

// Expense is a booked expense in its base currency; Account is its category account. Splits, when set, divide it
// over several accounts and replace Account, Total less Deductible, MaterialVAT and the acquisition tax amounts.
type Expense struct {
	ID           string            `json:"id"`
	Ref          string            `json:"ref"`
	Party        string            `json:"party"`
	Date         string            `json:"date"`
	Currency     string            `json:"currency"`
	Account      string            `json:"account"`
	Total        invoicecalc.Money `json:"total"`
	Deductible   invoicecalc.Money `json:"deductible"`
	MaterialVAT  bool              `json:"material_vat"`
	PaidOn       string            `json:"paid_on"`
	Method       string            `json:"method"`
	PaidByMember bool              `json:"paid_by_member"`
	ReimbursedOn string            `json:"reimbursed_on"`
	// ReverseCharge: a service from abroad owes acquisition tax (MWSTG art. 45); AcquisitionDeductible is its input-tax share.
	ReverseCharge         bool              `json:"reverse_charge"`
	AcquisitionTax        invoicecalc.Money `json:"acquisition_tax"`
	AcquisitionDeductible invoicecalc.Money `json:"acquisition_deductible"`
	Splits                []Split           `json:"splits"`
}

// Sources is everything Post needs, gathered by the store.
type Sources struct {
	Invoices []Invoice `json:"invoices"`
	Payments []Payment `json:"payments"`
	Expenses []Expense `json:"expenses"`
}

// Balance is the closing position of one account in one currency over a period.
type Balance struct {
	Account  string            `json:"account"`
	Name     string            `json:"name"`
	Currency string            `json:"currency"`
	Opening  invoicecalc.Money `json:"opening"`
	Debit    invoicecalc.Money `json:"debit"`
	Credit   invoicecalc.Money `json:"credit"`
	Closing  invoicecalc.Money `json:"closing"`
}

// StatementLine is one posting on an account's Hauptbuch; Contra is the other account of the row.
type StatementLine struct {
	Date        string            `json:"date"`
	Ref         string            `json:"ref"`
	Description string            `json:"description"`
	Contra      string            `json:"contra"`
	Debit       invoicecalc.Money `json:"debit"`
	Credit      invoicecalc.Money `json:"credit"`
	Balance     invoicecalc.Money `json:"balance"`
}

// Statement is the Hauptbuch of one account in one currency.
type Statement struct {
	Account  string            `json:"account"`
	Name     string            `json:"name"`
	Currency string            `json:"currency"`
	Opening  invoicecalc.Money `json:"opening"`
	Closing  invoicecalc.Money `json:"closing"`
	Lines    []StatementLine   `json:"lines"`
}
