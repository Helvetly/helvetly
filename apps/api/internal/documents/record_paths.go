package documents

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

// Record paths: AI filing and organizing put a client's records into Clients/<client>/<record type>/<year> (contracts
// into Clients/<client>/Documents/<year>/Contracts, a client's bank statements and payment confirmations into
// Clients/<client>/Documents/<year>/Bank Statements), expenses into Expenses/<year>/<category> and tax documents
// into Tax Documents/<year>, the system folders, instead of folders of their own.

const (
	filingClients = 200    // clients and categories listed to the model
	knownClients  = 10_000 // clients a record path or a match may name
)

// recordRules: what the model is told about the system folders.
const recordRules = "Documents of one of the listed clients (issued to them or received from them) that are an " +
	"invoice, credit or debit note, quote, engagement report or contract, signed document or other client document go " +
	"to the path Clients/<the client's name exactly as listed>/<Invoices, Quotes, Engagements, Signatures or " +
	"Documents>/<the year of the document's date>; a completed contract or agreement of a client (parties, dates " +
	"and key terms filled in, no blanks or placeholders, not a template, sample or draft) goes to " +
	"Clients/<the client's name exactly as listed>/Documents/<the year it was signed or starts, else the year of the " +
	"upload>/" + store.ContractsFolderName + ", any other contract-like file to Clients/<the client>/Documents/<year>. A bank " +
	"statement, credit advice (Gutschrift) or payment confirmation about one of the listed clients goes to Clients/<the " +
	"client's name exactly as listed>/Documents/<the year of its value or statement date>/" + store.BankStatementsFolderName +
	". Receipts, supplier bills and other expenses go to Expenses/<the " +
	"listed expense category that fits, exactly as listed, or " + store.UncategorisedFolder + ">/<the year of their " +
	"date>. Tax documents (tax returns, tax " +
	"assessments, provisional tax bills, VAT returns and statements of the tax authority, withholding tax, tax " +
	"certificates; not a social security bill, which is an expense) go to " + store.TaxDocumentsFolderName +
	"/<the tax year they are about>. Never make other folders inside Clients, Expenses or " +
	store.TaxDocumentsFolderName + "."

// recordNames: the clients and expense categories a record path may name.
type recordNames struct {
	clients    []store.ClientName
	categories []store.CategoryName
}

// recordNames: the workspace's names for record paths.
func (s *Service) recordNames(ctx context.Context, workspaceID string) (recordNames, error) {
	clients, err := s.db.ClientNames(ctx, workspaceID, knownClients)
	if err != nil {
		return recordNames{}, err
	}
	categories, err := s.db.ExpenseCategoryNames(ctx, workspaceID, filingClients)
	return recordNames{clients: clients, categories: categories}, err
}

// recordPlace: where a record path points; client "" for Expenses and Tax Documents, category nil for
// Uncategorised.
type recordPlace struct {
	clientID, kind string
	year           int
	categoryID     *string
	contracts      bool // Clients/<client>/Documents/<year>/Contracts
	statements     bool // Clients/<client>/Documents/<year>/Bank Statements
}

// recordPath reads a path into the system folders; ok false when it does not start with Clients, Expenses or Tax
// Documents, and
// place nil when it does but does not fit their structure (or names no single listed client).
func recordPath(path []string, names recordNames) (place *recordPlace, ok bool) {
	if len(path) == 0 {
		return nil, false
	}
	root := strings.ToLower(path[0])
	if strings.EqualFold(root, store.TaxDocumentsFolderName) {
		if year, good := yearOf(path[len(path)-1]); good && len(path) == 2 {
			return &recordPlace{kind: "tax_documents", year: year}, true
		}
		return nil, true
	}
	if root != "clients" && root != "expenses" {
		return nil, false
	}
	if root == "expenses" {
		if len(path) != 3 {
			return nil, true
		}
		year, good := yearOf(path[1])
		if !good {
			return nil, true
		}
		for _, c := range names.categories {
			if strings.EqualFold(strings.Join(strings.Fields(c.Name), " "), path[2]) {
				return &recordPlace{kind: "expenses", year: year, categoryID: &c.ID}, true
			}
		}
		if strings.EqualFold(path[2], store.UncategorisedFolder) {
			return &recordPlace{kind: "expenses", year: year}, true
		}
		return nil, true
	}
	inDocuments := len(path) == 5 && strings.EqualFold(path[2], store.RecordFolders["documents"])
	contracts := inDocuments && strings.EqualFold(path[4], store.ContractsFolderName)
	statements := inDocuments && strings.EqualFold(path[4], store.BankStatementsFolderName)
	if len(path) != 4 && !contracts && !statements {
		return nil, true
	}
	kind := ""
	for k, name := range store.RecordFolders {
		if strings.EqualFold(name, path[2]) {
			kind = k
		}
	}
	year, good := yearOf(path[3])
	if kind == "" || !good {
		return nil, true
	}
	match := ""
	for _, c := range names.clients {
		if strings.EqualFold(strings.Join(strings.Fields(c.Name), " "), path[1]) {
			if match != "" {
				return nil, true // two clients by that name: not ours to guess
			}
			match = c.ID
		}
	}
	if match == "" {
		return nil, true
	}
	return &recordPlace{clientID: match, kind: kind, year: year, contracts: contracts, statements: statements}, true
}

func yearOf(s string) (int, bool) {
	y, err := strconv.Atoi(s)
	return y, err == nil && len(s) == 4 && y >= 1900 && y <= 2200
}

// folder: the system folder of the place, made where missing. Run it in a transaction.
func (p recordPlace) folder(ctx context.Context, q store.Q, workspaceID, userID string, now time.Time) (string, error) {
	if p.contracts {
		return q.ContractsFolder(ctx, workspaceID, p.clientID, p.year, userID, now)
	}
	if p.statements {
		return q.ClientBankStatementsFolder(ctx, workspaceID, p.clientID, p.year, userID, now)
	}
	if p.kind == "tax_documents" {
		return q.TaxDocumentsFolder(ctx, workspaceID, p.year, userID, now)
	}
	if p.clientID != "" {
		return q.ClientRecordFolder(ctx, workspaceID, p.clientID, p.kind, p.year, userID, now)
	}
	return q.ExpenseYearFolder(ctx, workspaceID, p.categoryID, p.year, userID, now)
}

// recordList: the listed clients (the most recently changed filingClients) and expense categories for the model, one
// name per line.
func recordList(names recordNames) string {
	var b strings.Builder
	b.WriteString("Clients:\n")
	for _, c := range names.clients[:min(len(names.clients), filingClients)] {
		fmt.Fprintf(&b, "%s\n", strings.Join(strings.Fields(c.Name), " "))
	}
	if len(names.clients) == 0 {
		b.WriteString("(none yet)\n")
	}
	b.WriteString("\nExpense categories:\n")
	for _, c := range names.categories {
		fmt.Fprintf(&b, "%s\n", strings.Join(strings.Fields(c.Name), " "))
	}
	return b.String()
}

// inSystemTree: f is a system folder or below one; the model files there only by a record path.
func inSystemTree(folders []store.Folder, f store.Folder) bool {
	for seen := 0; seen < 20; seen++ {
		if f.SystemKind != nil {
			return true
		}
		if f.ParentID == nil {
			return false
		}
		i := -1
		for j, p := range folders {
			if p.ID == *f.ParentID {
				i = j
			}
		}
		if i < 0 {
			return false
		}
		f = folders[i]
	}
	return false
}

// templateWords: words that mark a file as a template, sample or draft (en, de, fr, it), as whole words of its name
// or text.
var templateWords = regexp.MustCompile(`(?i)(^|[^\p{L}])(template|sample|draft|specimen|vorlage|muster|mustervertrag|` +
	`entwurf|modèle|modele|exemple|brouillon|modello|bozza|esempio|fac-simile|facsimile)([^\p{L}]|$)`)

// placeholders: blanks left to fill: "[Name]", "{{name}}", "<<Name>>", "______", "........".
var placeholders = regexp.MustCompile(`\[[^\]\n]{1,40}\]|\{\{[^}\n]{0,40}\}\}|<<[^>\n]{0,40}>>|_{5,}|\.{8,}|…{3,}`)

// completedContract: whether a file the model calls a client's contract may go to its Contracts folder: the model
// must say it is a completed contract, and neither its name nor its text may look like a template (a template word,
// or a blank or placeholder in the text). The reason is recorded with the filing.
func completedContract(name, text string, model bool, modelReason string) (bool, string) {
	switch {
	case templateWords.MatchString(name):
		return false, "The file name marks it as a template, sample or draft."
	case templateWords.MatchString(text):
		return false, "Its text marks it as a template, sample or draft."
	case placeholders.MatchString(text):
		return false, "Its text has blanks or placeholders to fill in."
	case !model:
		if r := strings.TrimSpace(modelReason); r != "" {
			return false, r
		}
		return false, "It is not a completed contract."
	}
	return true, strings.TrimSpace(modelReason)
}
