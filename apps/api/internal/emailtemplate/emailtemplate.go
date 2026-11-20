// Package emailtemplate holds the subject and message of the emails sent with invoices and quotes: the built-in
// defaults per language, the {variable} substitution and the validation of a workspace's own texts. It is pure.
package emailtemplate

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// Template is a subject and a message, either with {variables} or already rendered.
type Template struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// MaxMessage is the longest message, in characters, of an email sent with a document (invoice, quote, service
// report) and of a workspace's own message template.
const MaxMessage = 2500

const maxSubject = 200

var (
	Kinds     = []string{"invoice", "credit_note", "proforma", "quote"}
	Languages = []string{"de", "fr", "it", "en"}
)

var common = []string{"document", "number", "client", "amount", "company"}

// Variables lists the names a kind's texts may use, in the order shown to people.
func Variables(kind string) []string {
	switch kind {
	case "invoice":
		return append(slices.Clone(common), "due_date")
	case "quote":
		return append(slices.Clone(common), "valid_until")
	case "credit_note", "proforma":
		return slices.Clone(common)
	}
	return nil
}

// words is one language: greeting, sign-off, the "from" of the subject and one sentence per kind.
type words struct {
	greeting, signOff, from string
	sentence                map[string]string
}

var languages = map[string]words{
	"de": {"Guten Tag", "Freundliche Grüsse", "von", map[string]string{
		"invoice":     "Im Anhang finden Sie unsere Rechnung {number} über {amount}, zahlbar bis {due_date}.",
		"credit_note": "Im Anhang finden Sie unsere Gutschrift {number} über {amount}.",
		"proforma":    "Im Anhang finden Sie unsere Proforma-Rechnung {number} über {amount}.",
		"quote":       "Im Anhang finden Sie unsere Offerte {number} über {amount}, gültig bis {valid_until}."}},
	"fr": {"Bonjour", "Meilleures salutations", "de", map[string]string{
		"invoice":     "Veuillez trouver ci-joint notre facture {number} d'un montant de {amount}, payable jusqu'au {due_date}.",
		"credit_note": "Veuillez trouver ci-joint notre note de crédit {number} d'un montant de {amount}.",
		"proforma":    "Veuillez trouver ci-joint notre facture proforma {number} d'un montant de {amount}.",
		"quote":       "Veuillez trouver ci-joint notre offre {number} d'un montant de {amount}, valable jusqu'au {valid_until}."}},
	"it": {"Buongiorno", "Cordiali saluti", "di", map[string]string{
		"invoice":     "In allegato trovate la nostra fattura {number} di {amount}, pagabile entro il {due_date}.",
		"credit_note": "In allegato trovate la nostra nota di credito {number} di {amount}.",
		"proforma":    "In allegato trovate la nostra fattura proforma {number} di {amount}.",
		"quote":       "In allegato trovate la nostra offerta {number} di {amount}, valida fino al {valid_until}."}},
	"en": {"Hello", "Kind regards", "from", map[string]string{
		"invoice":     "Please find attached our invoice {number} for {amount}, payable by {due_date}.",
		"credit_note": "Please find attached our credit note {number} for {amount}.",
		"proforma":    "Please find attached our proforma invoice {number} for {amount}.",
		"quote":       "Please find attached our quote {number} for {amount}, valid until {valid_until}."}},
}

// Default is the built-in text of a kind in a language (English for any other); empty for an unknown kind.
func Default(kind, language string) Template {
	w, ok := languages[language]
	if !ok {
		w = languages["en"]
	}
	sentence, ok := w.sentence[kind]
	if !ok {
		return Template{}
	}
	return Template{
		Subject: "{document} {number} " + w.from + " {company}",
		Body:    w.greeting + "\n\n" + sentence + "\n\n" + w.signOff + "\n{company}",
	}
}

// Render fills {name} from v in one pass; unknown names stay as typed. The subject is one line: whitespace
// runs collapse to a space and the ends are trimmed, so an empty value leaves no gap.
func Render(t Template, v map[string]string) Template {
	args := make([]string, 0, 2*len(v))
	for k, val := range v {
		args = append(args, "{"+k+"}", val)
	}
	r := strings.NewReplacer(args...)
	return Template{
		Subject: strings.Join(strings.Fields(r.Replace(t.Subject)), " "),
		Body:    r.Replace(t.Body),
	}
}

var placeholder = regexp.MustCompile(`\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// unknown returns the message for the first {name} a kind does not offer, or "".
func unknown(kind, text string) string {
	vars := Variables(kind)
	for _, m := range placeholder.FindAllStringSubmatch(text, -1) {
		if !slices.Contains(vars, m[1]) {
			list := make([]string, len(vars))
			for i, n := range vars {
				list[i] = "{" + n + "}"
			}
			return fmt.Sprintf("Unknown variable {%s}. Use %s.", m[1], strings.Join(list, ", "))
		}
	}
	return ""
}

// Check validates a workspace's own text; the map holds a message per bad field ("subject", "body").
func Check(kind string, t Template) map[string]string {
	bad := map[string]string{}
	if msg := unknown(kind, t.Subject); msg != "" {
		bad["subject"] = msg
	} else if n := utf8.RuneCountInString(t.Subject); strings.TrimSpace(t.Subject) == "" || n > maxSubject || strings.ContainsAny(t.Subject, "\r\n") {
		bad["subject"] = "Enter a subject of at most 200 characters, on one line."
	}
	if msg := unknown(kind, t.Body); msg != "" {
		bad["body"] = msg
	} else if n := utf8.RuneCountInString(t.Body); strings.TrimSpace(t.Body) == "" || n > MaxMessage {
		bad["body"] = fmt.Sprintf("Enter a message of at most %d characters.", MaxMessage)
	}
	return bad
}
