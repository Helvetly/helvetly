package invoices

import (
	"slices"

	"helvetly.com/api/internal/store"
)

// Document types (docs/invoices-contract.md "Document types"): the UNTDID 1001 code of each kind.
var typeCodes = map[string]string{"invoice": "380", "partial": "326", "prepayment": "386", "debit_note": "383",
	"corrected": "384", "credit_note": "381", "proforma": "325", "self_billed": "389"}

// creatable: the kinds POST /invoices (and duplicate) make; the rest come from an issued invoice.
var creatable = []string{"invoice", "partial", "prepayment", "proforma", "self_billed"}

func validKind(kind string) bool { _, ok := typeCodes[kind]; return ok }

// TypeCode: the UNTDID 1001 code of a kind ("380"…), "" for an unknown kind.
func TypeCode(kind string) string { return typeCodes[kind] }

// Receivable: the buyer owes the workspace; payments come in, a QR bill is attached and it counts in the summary.
func Receivable(kind string) bool {
	return slices.Contains([]string{"invoice", "partial", "prepayment", "debit_note", "corrected"}, kind)
}

// takesPayments: receivable kinds, and self-billed ones (paid out by the workspace).
func takesPayments(kind string) bool { return Receivable(kind) || kind == "self_billed" }

// needsPreceding: the kinds that refer to an issued invoice (credited_invoice, EN 16931 BT-25).
func needsPreceding(kind string) bool {
	return kind == "credit_note" || kind == "debit_note" || kind == "corrected"
}

// Series: the counter series of a kind and its number prefix; partial, prepayment, debit and corrected
// invoices share the invoice numbers.
func Series(kind string) (series, prefix string) {
	switch kind {
	case "credit_note":
		return "credit_note", "CN-"
	case "proforma":
		return "proforma", "PF-"
	case "self_billed":
		return "self_billed", "SB-"
	}
	return "invoice", ""
}

// seriesOf: Series of the document, except that a credit note against a self-billed invoice shares the SB series.
func seriesOf(inv store.Invoice, credited *store.Invoice) (series, prefix string) {
	if inv.Kind == "credit_note" && credited != nil && credited.Kind == "self_billed" {
		return Series("self_billed")
	}
	return Series(inv.Kind)
}

// invoiceJSON and listItemJSON add the derived type_code to the stored documents.
type invoiceJSON struct {
	store.Invoice
	TypeCode string `json:"type_code"`
}

type listItemJSON struct {
	store.InvoiceListItem
	TypeCode string `json:"type_code"`
}

func withCode(inv store.Invoice) invoiceJSON { return invoiceJSON{inv, TypeCode(inv.Kind)} }

func withCodes(list []store.InvoiceListItem) []listItemJSON {
	out := make([]listItemJSON, len(list))
	for i, l := range list {
		out[i] = listItemJSON{l, TypeCode(l.Kind)}
	}
	return out
}
