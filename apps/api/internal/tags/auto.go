package tags

import (
	"regexp"
	"slices"
	"strconv"
)

// Record: what the app knows about a file of a record, from the record itself or the system folder it sits in.
type Record struct {
	Kind      string // invoice, credit-note, debit-note, quote, contract, receipt, engagement; "" for none
	Year      int    // the record's year, as its folder uses it; 0 for none
	Client    string // the client's name
	Number    string // the record's number, such as 2026/Q/001
	Category  string // a receipt's expense category
	FromQuote string // the number of the quote a contract was made from
	Signed    bool   // fully signed (a completed signature request's original or signed copy)
}

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
	if r.Year > 0 {
		add("year-" + strconv.Itoa(r.Year))
	}
	add(prefixed("client-", r.Client))
	add(Slug(r.Number))
	add(prefixed("expense-", r.Category))
	add(prefixed("from-quote-", r.FromQuote))
	return out
}

// prefixed: the tag of name after prefix, "" when name makes no tag of its own.
func prefixed(prefix, name string) string {
	if Slug(name) == "" {
		return ""
	}
	return Slug(prefix + name)
}

// ProtectedPattern matches facts set only by the document's record or filing.
const ProtectedPattern = `^(signed|year-[0-9]{4}|client-.+)$`

var protectedTag = regexp.MustCompile(ProtectedPattern)

func Protected(tag string) bool { return protectedTag.MatchString(tag) }

// Merge applies computed automatic tags to a file's tags: automatic tags no longer computed leave, new ones join
// unless dismissed or already owned by the person. Protected facts always follow the record. It returns the
// file's tags, the person's first, then the automatic ones in Auto's order, and which of them are automatic.
func Merge(have, auto, removed, computed []string) (tags, nowAuto []string) {
	tags, nowAuto = []string{}, []string{}
	for _, t := range have {
		if !slices.Contains(auto, t) && !(Protected(t) && slices.Contains(computed, t)) {
			tags = append(tags, t)
		}
	}
	for _, t := range computed {
		if Protected(t) || slices.Contains(auto, t) && slices.Contains(have, t) || !slices.Contains(tags, t) && !slices.Contains(removed, t) {
			nowAuto = append(nowAuto, t)
		}
	}
	return append(tags, nowAuto...), nowAuto
}
