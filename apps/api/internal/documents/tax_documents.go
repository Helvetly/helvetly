package documents

import (
	"regexp"
	"slices"
	"strconv"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
)

// Tax documents: a tax return, assessment, provisional tax bill, VAT return or statement of the tax authority,
// withholding tax or tax certificate goes to Tax Documents/<year>, the tax year it is about (else its date's year,
// else the upload's in the workspace's time zone), never into Clients or Expenses. A file of the workspace's own
// records is matched before (record_match.go); a file of an invoice or expense, or one the model names another kind
// (a social security bill is an expense receipt), is no tax document.

// taxText: words that clearly say tax document (en, de, fr, it), in a file's name or text.
var taxText = regexp.MustCompile(`(?i)(^|[^\p{L}])(steuererkl(ä|ae)rung|veranlagungsverf(ü|ue)gung|veranlagung|` +
	`steuerrechnung|vorl(ä|ae)ufige steuer|mwst-abrechnung|mwst abrechnung|mehrwertsteuerabrechnung|` +
	`verrechnungssteuer|lohnausweis|steuerbescheinigung|tax return|tax assessment|provisional tax|vat return|` +
	`withholding tax|tax certificate|d(é|e)claration d'imp(ô|o)t|d(é|e)claration fiscale|taxation d(é|e)finitive|` +
	`d(é|e)compte tva|imp(ô|o)t anticip(é|e)|attestation fiscale|dichiarazione dei redditi|dichiarazione d'imposta|` +
	`notifica di tassazione|rendiconto iva|imposta preventiva|certificato fiscale)([^\p{L}]|$)`)

// taxDocument: whether a file goes to Tax Documents: the model names it one (kind tax-document), or names no kind
// and its name or text clearly says so; never a file of an invoice or expense.
func taxDocument(d store.Document, text, kind string) bool {
	return !linkedRecord(d) && (kind == "tax-document" || kind == "" && taxText.MatchString(d.Name+"\n"+text))
}

// taxSlugs: tags and folder names (as tags) that say tax document, in the app's languages.
var taxSlugs = []string{"tax-document", "tax-documents", "tax", "taxes", "steuern", "steuer", "steuerunterlagen",
	"impots", "impot", "documents-fiscaux", "fiscalite", "tasse", "imposte", "documenti-fiscali", "fisco"}

// taxTag: the first (kind) tag, or a folder name, says tax document.
func taxTag(tagList []string) bool {
	return len(tagList) > 0 && slices.Contains(taxSlugs, tags.Slug(tagList[0]))
}

// taxYear: the tax year the model read (YYYY), else the year in the file's name, else of the upload in zone.
func taxYear(year string, d store.Document, zone *time.Location) int {
	if y, ok := yearOf(year); ok {
		return y
	}
	for _, w := range words(d.Name) {
		if y, ok := yearOf(w); ok {
			return y
		}
	}
	return d.CreatedAt.In(zone).Year()
}

// taxProposal: a proposal for a tax document (its kind tag or folder says so, or it has no kind and its name or text
// says so) goes to Tax Documents/<year>: the year its path or name names, else the upload's in zone. A file already
// there keeps its place.
func taxProposal(p proposal, d store.Document, text string, names recordNames, zone *time.Location) proposal {
	path, _ := splitPath(p.Folder, organizeApplyDepth)
	place, _ := recordPath(path, names)
	kind := ""
	if len(p.Tags) > 0 && tags.Kind(p.Tags[0]) {
		kind = p.Tags[0]
	}
	leaf := []string{}
	if len(path) > 0 {
		leaf = path[:1]
	}
	if place != nil && place.kind == "tax_documents" || linkedRecord(d) || kind != "" && kind != "tax-document" ||
		kind == "" && !taxTag(leaf) && !taxText.MatchString(d.Name+"\n"+text) {
		return p
	}
	if kind == "" {
		p.Tags = append([]string{"tax-document"}, p.Tags[:min(len(p.Tags), filingAITags-1)]...)
	}
	year := d.CreatedAt.In(zone).Year()
	for _, seg := range append(slices.Clone(path), words(d.Name)...) {
		if y, ok := yearOf(seg); ok {
			year = y
			break
		}
	}
	p.Folder = store.TaxDocumentsFolderName + "/" + strconv.Itoa(year)
	p.Change = p.FromFolder == nil || *p.FromFolder != p.Folder ||
		slices.ContainsFunc(p.Tags, func(t string) bool { return !slices.Contains(d.Tags, t) })
	p.Reason = "A tax document, so it goes in the Tax Documents folder."
	return p
}
