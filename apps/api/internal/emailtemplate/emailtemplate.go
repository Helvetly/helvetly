// Package emailtemplate holds the subject and message of the emails sent with invoices and quotes and of the emails
// asking someone to sign (and reminding them): the built-in
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

// MaxTemplate is the longest message, in characters, of a workspace's own template, in every language; the email
// sent from it may grow to MaxMessage once its variables are filled and the sender edits it.
const MaxTemplate = 1000

const maxSubject = 200

var (
	Kinds     = []string{"invoice", "credit_note", "proforma", "quote", "payment_confirmation", "document", "signature_request", "signature_reminder"}
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
	case "payment_confirmation": // amount: what arrived; balance: what is still open after it
		return append(slices.Clone(common), "paid_on", "balance")
	case "document":
		return []string{"document", "client", "sender", "company"}
	case "signature_request", "signature_reminder":
		return []string{"document", "sender", "company"}
	}
	return nil
}

// Required lists the variables every text of a kind written by AI must keep: the record it is about.
func Required(kind string) []string {
	switch kind {
	case "invoice", "credit_note", "proforma", "quote", "payment_confirmation":
		return []string{"number"}
	case "document", "signature_request", "signature_reminder":
		return []string{"document"}
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

var nextSteps = map[string]map[string]string{
	"en": {
		"invoice":     "The PDF includes the payment details. If you have a question about the invoice, reply to this email.",
		"credit_note": "The PDF shows what was credited. Reply to this email if you’d like to check how it applies to your invoice.",
		"proforma":    "Review the items and amounts in the PDF. If anything needs to change, reply before we prepare the final invoice.",
		"quote":       "The PDF sets out what’s included. Reply if you have questions, want to make a change or are ready to go ahead.",
	},
	"de": {
		"invoice":     "Die Zahlungsangaben stehen im PDF. Bei Fragen zur Rechnung antworten Sie einfach auf diese E-Mail.",
		"credit_note": "Im PDF sehen Sie, was gutgeschrieben wurde. Bei Fragen zur Verrechnung antworten Sie auf diese E-Mail.",
		"proforma":    "Prüfen Sie die Positionen und Beträge im PDF. Teilen Sie uns Änderungen mit, bevor wir die endgültige Rechnung erstellen.",
		"quote":       "Im PDF sehen Sie, welche Leistungen enthalten sind. Antworten Sie bei Fragen, Änderungswünschen oder wenn Sie das Angebot annehmen möchten.",
	},
	"fr": {
		"invoice":     "Les coordonnées de paiement figurent dans le PDF. Pour toute question sur la facture, répondez à cet e-mail.",
		"credit_note": "Le PDF détaille le crédit accordé. Répondez à cet e-mail si vous souhaitez vérifier son imputation.",
		"proforma":    "Vérifiez les lignes et les montants dans le PDF. Signalez-nous les modifications avant l’établissement de la facture définitive.",
		"quote":       "Le PDF détaille les prestations incluses. Répondez à cet e-mail pour poser une question, demander une modification ou accepter l’offre.",
	},
	"it": {
		"invoice":     "Nel PDF trova i dati per il pagamento. Per domande sulla fattura, risponda a questa e-mail.",
		"credit_note": "Il PDF indica gli importi accreditati. Risponda a questa e-mail per chiarimenti su come si applicano alla fattura.",
		"proforma":    "Controlli le voci e gli importi nel PDF. Ci segnali eventuali modifiche prima che prepariamo la fattura definitiva.",
		"quote":       "Il PDF descrive le prestazioni incluse. Risponda per fare una domanda, chiedere una modifica o accettare l’offerta.",
	},
}

// signing is the built-in text of the emails that send a document and of the signature emails, per kind and language. Its English subjects are the ones
// these emails had before they had templates.
var signing = map[string]map[string]Template{
	"document": {
		"de": {"{document} von {company}",
			"Guten Tag\n\nIm Anhang finden Sie «{document}». Bei Fragen antworten Sie einfach auf diese E-Mail.\n\nFreundliche Grüsse\n{sender}\n{company}"},
		"fr": {"{document} de {company}",
			"Bonjour\n\nVous trouverez « {document} » en pièce jointe. Pour toute question, répondez simplement à cet e-mail.\n\nMeilleures salutations\n{sender}\n{company}"},
		"it": {"{document} da {company}",
			"Buongiorno\n\nIn allegato trova «{document}». Per qualsiasi domanda, risponda semplicemente a questa e-mail.\n\nCordiali saluti\n{sender}\n{company}"},
		"en": {"{document} from {company}",
			"Hello\n\nThe PDF for “{document}” is attached for your review.\n\nIf you have a question about the document or need a change, reply to this email.\n\nKind regards\n{sender}\n{company}"},
	},
	"signature_request": {
		"de": {"{company} bittet Sie, «{document}» zu unterschreiben",
			"Guten Tag\n\nBitte prüfen und unterschreiben Sie «{document}» über den Link unten. Bei Fragen antworten Sie einfach auf diese E-Mail.\n\nFreundliche Grüsse\n{sender}\n{company}"},
		"fr": {"{company} vous invite à signer « {document} »",
			"Bonjour\n\nVeuillez vérifier et signer « {document} » à l'aide du lien ci-dessous. Pour toute question, répondez simplement à cet e-mail.\n\nMeilleures salutations\n{sender}\n{company}"},
		"it": {"{company} le chiede di firmare «{document}»",
			"Buongiorno\n\nLa preghiamo di verificare e firmare «{document}» tramite il link qui sotto. Per qualsiasi domanda, risponda semplicemente a questa e-mail.\n\nCordiali saluti\n{sender}\n{company}"},
		"en": {"{company} asks you to sign “{document}”",
			"Hello\n\nOpen “{document}” using the link below. Take a moment to check the details before signing.\n\nIf you have a question about the document, reply to this email.\n\nKind regards\n{sender}\n{company}"},
	},
	"signature_reminder": {
		"de": {"Erinnerung: {company} bittet Sie, «{document}» zu unterschreiben",
			"Guten Tag\n\nWir erinnern Sie freundlich daran, dass «{document}» noch auf Ihre Unterschrift wartet. Über den Link unten gelangen Sie direkt dorthin.\n\nFreundliche Grüsse\n{sender}\n{company}"},
		"fr": {"Rappel : {company} vous invite à signer « {document} »",
			"Bonjour\n\nNous vous rappelons que « {document} » attend toujours votre signature. Le lien ci-dessous vous y mène directement.\n\nMeilleures salutations\n{sender}\n{company}"},
		"it": {"Promemoria: {company} le chiede di firmare «{document}»",
			"Buongiorno\n\nLe ricordiamo che «{document}» è ancora in attesa della sua firma. Il link qui sotto la porta direttamente al documento.\n\nCordiali saluti\n{sender}\n{company}"},
		"en": {"Reminder: {company} asks you to sign “{document}”",
			"Hello\n\n“{document}” is still waiting for your signature.\n\nUse the link below to review it and sign before the deadline shown in this email.\n\nKind regards\n{sender}\n{company}"},
	},
}

// confirmations is the built-in text of the email confirming a payment: the amounts, the balance and the next
// instalment follow in the email's summary.
var confirmations = map[string]Template{
	"de": {"Zahlung erhalten: {document} {number}",
		"Guten Tag\n\nVielen Dank für Ihre Zahlung. Wir haben am {paid_on} {amount} für {document} {number} erhalten.\n\nBei Fragen antworten Sie einfach auf diese E-Mail.\n\nFreundliche Grüsse\n{company}"},
	"fr": {"Paiement reçu : {document} {number}",
		"Bonjour\n\nMerci pour votre paiement. Nous avons bien reçu {amount} le {paid_on} ({document} {number}).\n\nPour toute question, répondez simplement à cet e-mail.\n\nMeilleures salutations\n{company}"},
	"it": {"Pagamento ricevuto: {document} {number}",
		"Buongiorno\n\nGrazie per il suo pagamento. Abbiamo ricevuto {amount} il {paid_on} ({document} {number}).\n\nPer qualsiasi domanda, risponda semplicemente a questa e-mail.\n\nCordiali saluti\n{company}"},
	"en": {"Payment received: {document} {number}",
		"Hello\n\nThank you for your payment. We received {amount} on {paid_on} for {document} {number}.\n\nIf you have a question, reply to this email.\n\nKind regards\n{company}"},
}

// Default is the built-in text of a kind in a language (English for any other); empty for an unknown kind.
func Default(kind, language string) Template {
	if kind == "payment_confirmation" {
		if t, ok := confirmations[language]; ok {
			return t
		}
		return confirmations["en"]
	}
	if texts, ok := signing[kind]; ok {
		if t, ok := texts[language]; ok {
			return t
		}
		return texts["en"]
	}
	w, ok := languages[language]
	if !ok {
		language = "en"
		w = languages[language]
	}
	sentence, ok := w.sentence[kind]
	if !ok {
		return Template{}
	}
	return Template{
		Subject: "{document} {number} " + w.from + " {company}",
		Body:    w.greeting + "\n\n" + sentence + "\n\n" + nextSteps[language][kind] + "\n\n" + w.signOff + "\n{company}",
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
	} else if n := utf8.RuneCountInString(t.Body); strings.TrimSpace(t.Body) == "" || n > MaxTemplate {
		bad["body"] = fmt.Sprintf("Enter a message of at most %d characters.", MaxTemplate)
	}
	return bad
}
