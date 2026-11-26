package documents

import (
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
)

// Bank statements: AI filing and organizing put an account statement of a bank or payment provider into
// Bank Statements/<year>, the year its period ends (else its date, else the upload's in the workspace's time zone).
// The model says whether a file is one; a cheap check of its name and text helps. A file of the workspace's own
// invoices and quotes is matched before (record_match.go), and a file the model reads as an invoice, quote or receipt
// never goes there.

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

// otherRecord: the file belongs to an invoice or expense, or the model reads it (its first tag, or the place it
// chose) as an invoice, quote or receipt.
func otherRecord(d store.Document, tagList []string, place *recordPlace) bool {
	if slices.ContainsFunc(d.Links, func(l store.DocumentLink) bool { return l.Type == "invoice" || l.Type == "expense" }) {
		return true
	}
	if place != nil && place.kind != "bank_statements" {
		return true
	}
	return len(tagList) > 0 && (recordWords[tags.Slug(tagList[0])] != "" || folderKind(tagList[0]) == "receipts")
}

// bankStatement: whether a file goes to Bank Statements: the model says so, or its name or text looks like a
// statement; never a file of another record, nor one the model put into a client's or the expenses' folders.
func bankStatement(d store.Document, text string, model bool, tagList []string, place *recordPlace) bool {
	return !otherRecord(d, tagList, place) && (model || looksLikeStatement(d.Name, text))
}

// statementYear: the year of the statement's period end, else its date (YYYY-MM-DD each, "" when unknown), else of
// the upload in the workspace's time zone.
func statementYear(periodEnd, date string, uploaded time.Time, zone *time.Location) int {
	for _, d := range []string{periodEnd, date} {
		if y, ok := yearOf(d[:min(len(d), 4)]); ok {
			return y
		}
	}
	return uploaded.In(zone).Year()
}

// statementProposal: a proposal for a bank statement (its first tag says so, or its name or text looks like one, and
// the model put it into no other record's place) goes to Bank Statements/<year>: the year a path or the file's name
// names, else the upload's in zone. A file already there keeps its place.
func statementProposal(p proposal, d store.Document, text string, names recordNames, zone *time.Location) proposal {
	path, _ := splitPath(p.Folder, organizeApplyDepth)
	place, _ := recordPath(path, names)
	if place != nil && place.kind == "bank_statements" || otherRecord(d, p.Tags, place) ||
		!statementTag(p.Tags) && !looksLikeStatement(d.Name, text) {
		return p
	}
	year := d.CreatedAt.In(zone).Year()
	for _, seg := range append(path, words(d.Name)...) {
		if y, ok := yearOf(seg); ok {
			year = y
			break
		}
	}
	p.Folder = store.BankStatementsFolderName + "/" + strconv.Itoa(year)
	p.Change = p.FromFolder == nil || *p.FromFolder != p.Folder ||
		slices.ContainsFunc(p.Tags, func(t string) bool { return !slices.Contains(d.Tags, t) })
	p.Reason = "A bank statement, so it goes in the Bank Statements folder."
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
