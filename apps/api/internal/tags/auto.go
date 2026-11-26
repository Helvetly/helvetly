package tags

import (
	"regexp"
	"slices"
	"strings"
)

// Record: what the app knows about a file of a record, from the record itself, the system folder it sits in or AI
// filing.
type Record struct {
	Kind      string // one of Kinds; "" for none
	Period    string // YYYY-MM for a dated record; YYYY when only its year is known
	Client    string // the client's name
	Number    string // the record's number, such as 2026/Q/001
	Category  string // a receipt's expense category
	FromQuote string // the number of the quote a contract was made from
	Signed    bool   // fully signed (a completed signature request's original or signed copy)
}

// InvoiceKinds: the kind tag of each invoice kind (store invoices.kind); every invoice kind has one.
var InvoiceKinds = map[string]string{
	"invoice":     "invoice",
	"partial":     "partial-invoice",
	"prepayment":  "prepayment-invoice",
	"corrected":   "corrected-invoice",
	"proforma":    "proforma-invoice",
	"self_billed": "self-billed-invoice",
	"credit_note": "credit-note",
	"debit_note":  "debit-note",
}

// Kinds: every kind tag, one per line, in the order the app lists them. A kind is set only by the file's record, its
// system folder or AI filing; adding one here protects it everywhere (also add its label in the platform's
// lib/document-tags.ts and its Group by type in store.DocumentTypes).
var Kinds = []string{
	"invoice",
	"partial-invoice",
	"prepayment-invoice",
	"corrected-invoice",
	"proforma-invoice",
	"self-billed-invoice",
	"credit-note",
	"debit-note",
	"quote",
	"contract",
	"engagement",
	"receipt",
	"payment-confirmation",
	"consent",
	"power-of-attorney",
	"bank-statement",
	"tax-document",
}

// Kind reports whether t is one of Kinds.
func Kind(t string) bool { return slices.Contains(Kinds, t) }

// Auto: the automatic tags of a file of r, lower case and stable, in the order they are shown.
func Auto(r Record) []string {
	out := []string{}
	add := func(t string) {
		if t != "" && Valid(t) && !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	add(r.Kind)
	if r.Signed {
		add("signed")
	}
	if r.Period != "" {
		add("year-" + r.Period)
	}
	add(ClientTag(r.Client))
	add(Slug(r.Number))
	add(prefixed("expense-", r.Category))
	add(prefixed("from-quote-", r.FromQuote))
	return out
}

// Locked: those of Auto(r) only the record or filing sets and nobody removes: its kind, signed, its date and its
// record's number.
func Locked(r Record) []string {
	number := Slug(r.Number)
	return slices.DeleteFunc(Auto(r), func(t string) bool { return !Protected(t) && t != number })
}

// ClientTag: the client's tag, the slug of its name. A name whose slug could be read as another automatic tag (a
// kind, signed, a date, a record number, which start with a digit, or a prefixed tag) keeps the client- prefix.
func ClientTag(name string) string {
	s := Slug(name)
	if s == "" {
		return ""
	}
	if Protected(s) || s[0] >= '0' && s[0] <= '9' ||
		slices.ContainsFunc([]string{"client-", "expense-", "from-quote-"}, func(p string) bool { return strings.HasPrefix(s, p) }) {
		return prefixed("client-", name)
	}
	return s
}

// prefixed: the tag of name after prefix, "" when name makes no tag of its own.
func prefixed(prefix, name string) string {
	if Slug(name) == "" {
		return ""
	}
	return Slug(prefix + name)
}

// ProtectedPattern matches the tags set only by the document's record or filing: signed, its date and its kind. Neither
// a person nor the AI's free tags put one on a file.
var ProtectedPattern = "^(signed|year-[0-9]{4}(-(0[1-9]|1[0-2]))?|" + strings.Join(Kinds, "|") + ")$"

var protectedTag = regexp.MustCompile(ProtectedPattern)

func Protected(tag string) bool { return protectedTag.MatchString(tag) }

// Merge applies computed automatic tags to a file's tags: automatic tags no longer computed leave, new ones join
// unless dismissed or already owned by the person. The locked ones always follow the record. It returns the file's
// tags, the person's first, then the automatic ones in Auto's order, and which of them are automatic.
func Merge(have, auto, removed, computed, locked []string) (tags, nowAuto []string) {
	tags, nowAuto = []string{}, []string{}
	for _, t := range have {
		if !slices.Contains(auto, t) && !slices.Contains(locked, t) {
			tags = append(tags, t)
		}
	}
	// shortcut: a client-<name> tag dismissed before client tags lost their prefix still dismisses <name>; drop the
	// second check once the production rewrite of removed_auto_tags has run.
	dismissed := func(t string) bool { return slices.Contains(removed, t) || slices.Contains(removed, "client-"+t) }
	for _, t := range computed {
		if slices.Contains(locked, t) || slices.Contains(auto, t) && slices.Contains(have, t) || !slices.Contains(tags, t) && !dismissed(t) {
			nowAuto = append(nowAuto, t)
		}
	}
	return append(tags, nowAuto...), nowAuto
}
