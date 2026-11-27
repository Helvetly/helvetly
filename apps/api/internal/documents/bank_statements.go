package documents

import (
	"cmp"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
)

// Bank statements: an account statement of a bank or payment provider, a credit advice (Gutschrift) or a payment
// confirmation about a known client goes to that client's Documents/<year>/Bank Statements, the year of its value or
// statement date (else the upload's in the workspace's time zone). The model says what a file is; a cheap check of a
// statement's name and text helps. Without a known client a statement keeps its kind and is filed like any other
// document (a plain folder or none), and a payment confirmation as before. A file of the workspace's own invoices
// and quotes is matched before (record_match.go), and a file the model reads as an invoice, quote or receipt never
// counts as a statement.

// statementNameWords: words of a file name that say it is an account statement (en, de, fr, it).
var statementNameWords = []string{"statement", "statements", "kontoauszug", "kontoauszüge", "kontoauszuege",
	"bankauszug", "relevé", "releve", "relevés", "estratto", "mt940"}

// statementText: the parts of a statement's text: an IBAN, an opening and a closing balance; or the start of a
// CAMT.053 or MT940 file.
var (
	ibanText    = regexp.MustCompile(`\b[A-Z]{2}[0-9]{2} ?[0-9A-Z]{4}(?: ?[0-9A-Z]{2,4}){2,7}\b`)
	openingText = regexp.MustCompile(`(?i)opening balance|anfangssaldo|alter saldo|saldovortrag|saldo vortrag|` +
		`solde initial|solde précédent|ancien solde|solde de départ|saldo iniziale|saldo precedente`)
	closingText = regexp.MustCompile(`(?i)closing balance|schlusssaldo|endsaldo|neuer saldo|solde final|nouveau solde|` +
		`saldo finale|saldo di chiusura`)
	structuredText = regexp.MustCompile(`BkToCstmrStmt|camt\.053|(?m)^:60[FM]:`)
)

// looksLikeStatement: the file's name or text looks like an account statement ("statement of work" and its kind do
// not count).
func looksLikeStatement(name, text string) bool {
	w := words(strings.TrimSuffix(name, path.Ext(name)))
	for i, word := range w {
		if !slices.Contains(statementNameWords, word) || i+1 < len(w) && w[i+1] == "of" {
			continue
		}
		return true
	}
	if containsRun(w, []string{"camt", "053"}) || containsRun(w, []string{"estratti", "conto"}) {
		return true
	}
	return structuredText.MatchString(text) ||
		ibanText.MatchString(text) && openingText.MatchString(text) && closingText.MatchString(text)
}

// linkedRecord: the file belongs to an invoice or expense.
func linkedRecord(d store.Document) bool {
	return slices.ContainsFunc(d.Links, func(l store.DocumentLink) bool { return l.Type == "invoice" || l.Type == "expense" })
}

// bankStatement: whether a file is a bank statement: the model names it one (kind bank-statement), or names no kind
// and its name or text looks like a statement; never a file of another record or one the model put into another
// record's place.
func bankStatement(d store.Document, text, kind string, place *recordPlace) bool {
	if linkedRecord(d) || place != nil && !place.statements {
		return false
	}
	return kind == "bank-statement" || kind == "" && looksLikeStatement(d.Name, text)
}

// clientStatementKind: the kinds a client's Bank Statements folder holds.
func clientStatementKind(kind string) bool {
	return kind == "bank-statement" || kind == "payment-confirmation"
}

// statementYear: the year of the statement's period end, else its (value) date (YYYY-MM-DD each, "" when unknown),
// else of the upload in the workspace's time zone.
func statementYear(periodEnd, date string, uploaded time.Time, zone *time.Location) int {
	for _, d := range []string{periodEnd, date} {
		if y, ok := yearOf(d[:min(len(d), 4)]); ok {
			return y
		}
	}
	return uploaded.In(zone).Year()
}

// fileClient: the one live client a file is linked to, "" for none or several.
func fileClient(d store.Document) string {
	client := ""
	for _, l := range d.Links {
		if l.Type != "client" {
			continue
		}
		if client != "" && client != l.ID {
			return ""
		}
		client = l.ID
	}
	return client
}

// pathClient: the client a record path's Clients/<client> names, "" for none.
func pathClient(path []string, names recordNames) string {
	if len(path) < 2 || !strings.EqualFold(path[0], store.SystemRoots["clients"]) {
		return ""
	}
	match := ""
	for _, c := range names.clients {
		if strings.EqualFold(strings.Join(strings.Fields(c.Name), " "), path[1]) {
			if match != "" {
				return ""
			}
			match = c.ID
		}
	}
	return match
}

// statementProposal: a proposal for a bank statement or payment confirmation (its kind tag says so, or it has no kind
// and its name or text looks like a statement) of a known client (the path's, the file's client link, the client the
// file names) goes to Clients/<client>/Documents/<year>/Bank Statements: the year a path or the file's name names,
// else the upload's in zone. A statement of nobody keeps the model's place with its kind. A file already there keeps
// its place.
func statementProposal(p proposal, d store.Document, text string, names recordNames, named *store.ClientName, zone *time.Location) proposal {
	path, _ := splitPath(p.Folder, organizeApplyDepth)
	place, _ := recordPath(path, names)
	kind := "" // organizing proposes the kind as the first tag
	if len(p.Tags) > 0 && tags.Kind(p.Tags[0]) {
		kind = p.Tags[0]
	}
	if linkedRecord(d) || place != nil && place.statements || kind != "" && !clientStatementKind(kind) ||
		kind == "" && !statementTag(p.Tags) && !looksLikeStatement(d.Name, text) {
		return p
	}
	if kind == "" {
		kind = "bank-statement"
		p.Tags = append([]string{kind}, p.Tags[:min(len(p.Tags), filingAITags-1)]...)
	}
	from := []string{}
	if p.FromFolder != nil {
		from, _ = splitPath(*p.FromFolder, organizeApplyDepth)
	}
	client := cmp.Or(pathClient(path, names), pathClient(from, names), fileClient(d))
	if client == "" && named != nil {
		client = named.ID
	}
	year := d.CreatedAt.In(zone).Year()
	for _, seg := range append(append(slices.Clone(path), from...), words(d.Name)...) {
		if y, ok := yearOf(seg); ok {
			year = y
			break
		}
	}
	folder, ok := clientRecordPath(names, recordPlace{clientID: client, kind: "documents", year: year})
	if client == "" || !ok {
		p.Change = p.Change || slices.ContainsFunc(p.Tags, func(t string) bool { return !slices.Contains(d.Tags, t) })
		return p
	}
	p.Folder = folder + "/" + store.BankStatementsFolderName
	p.Change = p.FromFolder == nil || *p.FromFolder != p.Folder ||
		slices.ContainsFunc(p.Tags, func(t string) bool { return !slices.Contains(d.Tags, t) })
	p.Reason = map[string]string{"bank-statement": "A bank statement of the client, so it goes in the client's Bank Statements folder.",
		"payment-confirmation": "A payment confirmation of the client, so it goes in the client's Bank Statements folder."}[kind]
	return p
}

// statementSlugs: tags and folder names (as tags) that say bank statement, in the app's languages.
var statementSlugs = []string{"bank-statement", "bank-statements", "account-statement", "account-statements",
	"kontoauszug", "kontoauszuege", "bankauszug", "bankauszuege", "releve-bancaire", "releves-bancaires",
	"releve-de-compte", "releves-de-compte", "estratto-conto", "estratti-conto"}

// statementTag: the first (kind) tag, or a folder name, says bank statement.
func statementTag(tagList []string) bool {
	return len(tagList) > 0 && slices.Contains(statementSlugs, tags.Slug(tagList[0]))
}

// statementPlace: where filing puts a bank statement or payment confirmation of a known client (the one its record
// path names, else the one the file names): its Documents/<year>/Bank Statements; nil for any other file.
func statementPlace(d store.Document, kind string, record *recordPlace, named *store.ClientName, year int) *recordPlace {
	if linkedRecord(d) || !clientStatementKind(kind) {
		return nil
	}
	client := ""
	if record != nil {
		client = record.clientID
	}
	if client == "" && named != nil {
		client = named.ID
	}
	if client == "" {
		return nil
	}
	return &recordPlace{clientID: client, kind: "documents", year: year, statements: true}
}

// nameYear: the first year in a file's name, 0 for none.
func nameYear(name string) int {
	for _, w := range words(name) {
		if y, ok := yearOf(w); ok {
			return y
		}
	}
	return 0
}
