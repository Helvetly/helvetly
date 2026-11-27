package documents

import (
	"context"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
)

// Record matching: before the model is asked, a file is matched to the workspace's own invoices and quotes, by the
// stored PDF it shares with one, the imported invoice it is the original of, or a record number in its name or text, and to its clients, by UID or whole name.
// Only the first two are the record itself (identity): it goes to Clients/<client>/<Invoices|Quotes>/<year> without
// the model. A number names the record's client and year only: a payment confirmation or bank statement of it (the
// model's kind, a kind the file already has, or its name: paid, bezahlt, Gutschrift, an instalment such as _1st or
// "1. Rate") goes to the client's Documents/<year>/Bank Statements; anything else is the record, as before. A record
// the model files outside Clients goes to the client's folder when the file names one client.

const maxRecordRefs = 50_000

// recordMatch: the one record a file is, or names.
type recordMatch struct {
	place    recordPlace
	client   string // the client's name
	reason   string // "Matches invoice 2026/IN/005 for Acme AG."
	tag      string
	identity bool   // it shares the record's stored PDF or is its imported original: the file is the record
	label    string // "invoice 2026/IN/005"
	words    []string
}

type recordIndex struct {
	refs    []store.RecordRef
	clients []store.ClientName
}

func (s *Service) recordIndex(ctx context.Context, workspaceID string, clients []store.ClientName) (recordIndex, error) {
	refs, err := s.db.RecordRefs(ctx, workspaceID, maxRecordRefs)
	return recordIndex{refs: refs, clients: clients}, err
}

// words: the lower-case runs of letters and digits; "2026/IN/005", "2026-IN-005" and "2026_IN_005" are the same words.
func words(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

// containsRun: needle appears in hay as consecutive words.
func containsRun(hay, needle []string) bool {
	for i := 0; len(needle) > 0 && i+len(needle) <= len(hay); i++ {
		if slices.Equal(hay[i:i+len(needle)], needle) {
			return true
		}
	}
	return false
}

// numberWords: a record number's words when it is distinctive enough to find in a file name (at least 3 characters
// with a digit, and a single number never a year); text needs two words, since a lone number there may be an amount.
func numberWords(number string, inText bool) []string {
	w := words(number)
	joined := strings.Join(w, "")
	if len(joined) < 3 || !strings.ContainsFunc(joined, unicode.IsDigit) || inText && len(w) < 2 {
		return nil
	}
	if _, year := yearOf(joined); len(w) == 1 && year {
		return nil
	}
	return w
}

// match: the record the file is, by its stored object, else by a record number in its name, else in its text (the
// longest number found wins); nil when none is found or the records found differ (the model decides then).
func (ix recordIndex) match(d store.Document, text string) *recordMatch {
	var byObject, byName, byText []store.RecordRef
	nameWords, textWords := words(strings.TrimSuffix(d.Name, path.Ext(d.Name))), words(text)
	nameLen, textLen := 0, 0
	for _, r := range ix.refs {
		if r.ObjectKey != "" && r.ObjectKey == d.ObjectKey || r.DocumentID == d.ID {
			byObject = append(byObject, r)
		}
		if w := numberWords(r.Number, false); w != nil && containsRun(nameWords, w) {
			byName, nameLen = longest(byName, nameLen, r, len(w))
		}
		if w := numberWords(r.Number, true); w != nil && containsRun(textWords, w) {
			byText, textLen = longest(byText, textLen, r, len(w))
		}
	}
	for i, found := range [][]store.RecordRef{byObject, byName, byText} {
		if len(found) > 0 {
			m := ix.one(found)
			if m != nil {
				m.identity = i == 0
			}
			return m
		}
	}
	return nil
}

// longest keeps the records whose number has the most words.
func longest(found []store.RecordRef, best int, r store.RecordRef, n int) ([]store.RecordRef, int) {
	switch {
	case n > best:
		return []store.RecordRef{r}, n
	case n == best:
		return append(found, r), best
	}
	return found, best
}

// one: the match when every record found is the same one (a quote's revisions are), else nil.
func (ix recordIndex) one(found []store.RecordRef) *recordMatch {
	r := found[0]
	for _, o := range found[1:] {
		if o.Kind != r.Kind || o.Type != r.Type || o.Number != r.Number || o.ClientID != r.ClientID || o.Year != r.Year {
			return nil // two records, perhaps of two clients: not ours to guess
		}
	}
	i := slices.IndexFunc(ix.clients, func(c store.ClientName) bool { return c.ID == r.ClientID })
	if i < 0 {
		return nil
	}
	client := strings.Join(strings.Fields(ix.clients[i].Name), " ")
	label, tag := recordLabel(r.Type)
	return &recordMatch{place: recordPlace{clientID: r.ClientID, kind: r.Kind, year: r.Year}, client: client, tag: tag,
		reason: strings.Join(strings.Fields(fmt.Sprintf("Matches %s %s for %s.", label, r.Number, client)), " "),
		label:  strings.TrimSpace(label + " " + r.Number), words: words(r.Number)}
}

// recordLabel: how a reason names a record type, and the tag it gets.
func recordLabel(kind string) (label, tag string) {
	switch kind {
	case "quote":
		return "quote", "quote"
	case "credit_note":
		return "credit note", "credit-note"
	case "debit_note":
		return "debit note", "debit-note"
	case "proforma":
		return "pro forma invoice", tags.InvoiceKinds[kind]
	}
	if tag := tags.InvoiceKinds[kind]; tag != "" {
		return "invoice", tag
	}
	return "invoice", "invoice"
}

var uidCore = regexp.MustCompile(`[a-z]{2,3}[0-9]{8,12}`)

// client: the one known client the file names, by its UID or its whole name (of at least 4 characters); nil for none
// or several.
func (ix recordIndex) client(d store.Document, text string) *store.ClientName {
	all := words(d.Name + " " + text)
	compact := strings.Join(all, "")
	var found *store.ClientName
	for i, c := range ix.clients {
		name := words(c.Name)
		uid := uidCore.FindString(strings.Join(words(c.UID), ""))
		if !(len(strings.Join(name, "")) >= 4 && containsRun(all, name) || uid != "" && strings.Contains(compact, uid)) {
			continue
		}
		if found != nil && found.ID != c.ID {
			return nil
		}
		found = &ix.clients[i]
	}
	return found
}

// recordWords: folder names and tags that say a document is an invoice (or credit note) or a quote, in the app's
// languages.
var recordWords = map[string]string{
	"invoice": "invoices", "invoices": "invoices", "credit-note": "invoices", "credit-notes": "invoices",
	"debit-note": "invoices", "rechnung": "invoices", "rechnungen": "invoices", "gutschrift": "invoices",
	"facture": "invoices", "factures": "invoices", "fattura": "invoices", "fatture": "invoices",
	"quote": "quotes", "quotes": "quotes", "offer": "quotes", "offers": "quotes", "angebot": "quotes",
	"angebote": "quotes", "offerte": "quotes", "offerten": "quotes", "devis": "quotes", "preventivo": "quotes",
	"preventivi": "quotes",
}

// recordKind: the client record folder a plain path or the first (kind) tag points at, "" for none.
func recordKind(path, tagList []string) string {
	for _, seg := range path {
		if kind := recordWords[tags.Slug(seg)]; kind != "" {
			return kind
		}
	}
	if len(tagList) > 0 {
		return recordWords[tags.Slug(tagList[0])]
	}
	return ""
}

// recordYear: the year a path names, else the first year in the file's name, else the year it was uploaded.
func recordYear(path []string, d store.Document) int {
	for _, seg := range append(slices.Clone(path), words(d.Name)...) {
		if y, ok := yearOf(seg); ok {
			return y
		}
	}
	return d.CreatedAt.Year()
}

// clientRecordPath: Clients/<client>/<record folder>/<year> as the model writes it, when it reads back as that
// client's place (one listed client by that name).
func clientRecordPath(names recordNames, place recordPlace) (string, bool) {
	i := slices.IndexFunc(names.clients, func(c store.ClientName) bool { return c.ID == place.clientID })
	if i < 0 {
		return "", false
	}
	p := []string{store.SystemRoots["clients"], strings.Join(strings.Fields(names.clients[i].Name), " "),
		store.RecordFolders[place.kind], strconv.Itoa(place.year)}
	got, _ := recordPath(p, names)
	if got == nil || got.clientID != place.clientID {
		return "", false
	}
	return strings.Join(p, "/"), true
}

// paymentNameWords: words of a file name that say it confirms a payment rather than being the record (en, de, fr, it).
var paymentNameWords = []string{"paid", "payment", "payments", "instalment", "installment", "bezahlt", "zahlung",
	"zahlungen", "teilzahlung", "gutschrift", "überweisung", "ueberweisung", "rate", "payé", "paye", "paiement",
	"virement", "acompte", "pagato", "pagamento", "bonifico", "accredito", "rata"}

var ordinalWord = regexp.MustCompile(`^([1-9][0-9]?)(st|nd|rd|th)$`)

// paid: whether a file that names m by number is a payment confirmation or bank statement of it rather than the
// record: a kind it already has, a payment word in its name, or an instalment ("_1st", "3rd", "1. Rate", a lone digit
// right after the number); its kind and the instalment's ordinal ("1st", "" for none).
func (m recordMatch) paid(d store.Document) (kind, ordinal string, ok bool) {
	for _, k := range append([]string{d.FiledKind}, d.Tags...) {
		if clientStatementKind(k) {
			kind = k
			break
		}
	}
	w := words(strings.TrimSuffix(d.Name, path.Ext(d.Name)))
	after := -1
	for i := 0; len(m.words) > 0 && i+len(m.words) <= len(w); i++ {
		if slices.Equal(w[i:i+len(m.words)], m.words) {
			after = i + len(m.words)
		}
	}
	for i, word := range w {
		switch {
		case ordinalWord.MatchString(word):
			ordinal = word
		case len(word) == 1 && word[0] >= '1' && word[0] <= '9' && (i == after || i+1 < len(w) && (w[i+1] == "rate" || w[i+1] == "rata")):
			ordinal = ordinalOf(word)
		}
	}
	named := slices.ContainsFunc(w, func(word string) bool { return slices.Contains(paymentNameWords, word) })
	if kind == "" && (named || ordinal != "") {
		kind = "payment-confirmation"
	}
	return kind, ordinal, kind != ""
}

func ordinalOf(digit string) string {
	switch digit {
	case "1":
		return "1st"
	case "2":
		return "2nd"
	case "3":
		return "3rd"
	}
	return digit + "th"
}

// paidReason: "Payment confirmation for invoice 2026/IN/031 (1st instalment)."
func (m recordMatch) paidReason(kind, ordinal string) string {
	what := map[string]string{"payment-confirmation": "Payment confirmation", "bank-statement": "Bank statement"}[kind]
	reason := what + " for " + m.label
	if ordinal != "" {
		reason += " (" + ordinal + " instalment)"
	}
	return reason + "."
}

// hint: what the model is told about a record the file names by number.
func (m recordMatch) hint() string {
	return fmt.Sprintf("The file names %s of the client %s; it is that %s only when it is the document itself, not a "+
		"payment confirmation, credit advice or bank statement of it.", m.label, m.client, strings.Fields(m.label)[0])
}
