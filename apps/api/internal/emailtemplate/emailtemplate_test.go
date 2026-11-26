package emailtemplate

import (
	"fmt"
	"strings"
	"testing"
)

var vars = map[string]string{"document": "Rechnung", "number": "2026-001", "client": "Muster AG", "amount": "CHF 1'234.50",
	"company": "Acme", "due_date": "01.02.2026", "valid_until": "03.04.2026"}

func TestRenderLeavesUnknownBraces(t *testing.T) {
	got := Render(Template{Subject: "Invoice {number}  from {company}", Body: "Hi {client},\n{nope}"},
		map[string]string{"number": "2026-001", "company": "", "client": "Muster AG"})
	want := Template{Subject: "Invoice 2026-001 from", Body: "Hi Muster AG,\n{nope}"}
	if got != want {
		t.Fatalf("got %+v want %+v", got, want)
	}
}

func TestRenderSubjectCollapsesSpaceAndNewlines(t *testing.T) {
	got := Render(Template{Subject: "A\n {number}", Body: "x"}, map[string]string{"number": "2026-001"})
	if got.Subject != "A 2026-001" {
		t.Fatalf("got %q", got.Subject)
	}
}

func TestRenderDoesNotRescanValues(t *testing.T) {
	got := Render(Template{Subject: "{client} {number}", Body: "{client}"}, map[string]string{"client": "{number}", "number": "1"})
	if got.Subject != "{number} 1" || got.Body != "{number}" {
		t.Fatalf("got %+v", got)
	}
}

func TestCheckSubjectNewline(t *testing.T) {
	if got := Check("invoice", Template{Subject: "a\nb", Body: "x"}); got["subject"] == "" || got["body"] != "" {
		t.Fatalf("got %v", got)
	}
}

func TestCheckLimitsRunes(t *testing.T) {
	ok := func(s, b int) bool {
		return len(Check("invoice", Template{Subject: strings.Repeat("ä", s), Body: strings.Repeat("ä", b)})) == 0
	}
	if !ok(200, MaxTemplate) || ok(201, MaxTemplate) || ok(200, MaxTemplate+1) {
		t.Fatal("rune limits wrong")
	}
}

func TestCheckMessages(t *testing.T) {
	got := Check("quote", Template{Subject: "Quote {due_date}", Body: ""})
	want := map[string]string{
		"subject": "Unknown variable {due_date}. Use {document}, {number}, {client}, {amount}, {company}, {valid_until}.",
		"body":    "Enter a message of at most 1000 characters.",
	}
	if got["body"] != want["body"] || got["subject"] != want["subject"] {
		t.Fatalf("got %v", got)
	}
}

func TestCheckUnknownWinsOverLength(t *testing.T) {
	got := Check("invoice", Template{Subject: "{x}" + strings.Repeat("a", 300), Body: "{y}"})
	if !strings.HasPrefix(got["subject"], "Unknown variable {x}") || !strings.HasPrefix(got["body"], "Unknown variable {y}") {
		t.Fatalf("got %v", got)
	}
}

func TestCheckWhitespaceOnlyFails(t *testing.T) {
	if got := Check("invoice", Template{Subject: "  ", Body: " \n"}); len(got) != 2 {
		t.Fatalf("got %v", got)
	}
}

func TestDefaultUnknownLanguageIsEnglish(t *testing.T) {
	if Default("invoice", "pl") != Default("invoice", "en") {
		t.Fatal("pl is not en")
	}
	if Default("nope", "en") != (Template{}) || Variables("nope") != nil {
		t.Fatal("unknown kind")
	}
}

func TestDefaultExample(t *testing.T) {
	want := Template{Subject: "{document} {number} from {company}",
		Body: "Hello\n\nPlease find attached our invoice {number} for {amount}, payable by {due_date}.\n\nThe PDF includes the payment details. If you have a question about the invoice, reply to this email.\n\nKind regards\n{company}"}
	if got := Default("invoice", "en"); got != want {
		t.Fatalf("got %+v", got)
	}
}

// old is the wording the send code used before templates: greeting, invoice, credit note, sign-off, from, proforma, quote.
var old = map[string][7]string{
	"de": {"Guten Tag", "Im Anhang finden Sie unsere Rechnung %s über %s, zahlbar bis %s.", "Im Anhang finden Sie unsere Gutschrift %s über %s.", "Freundliche Grüsse", "von", "Im Anhang finden Sie unsere Proforma-Rechnung %s über %s.", "Im Anhang finden Sie unsere Offerte %s über %s, gültig bis %s."},
	"fr": {"Bonjour", "Veuillez trouver ci-joint notre facture %s d'un montant de %s, payable jusqu'au %s.", "Veuillez trouver ci-joint notre note de crédit %s d'un montant de %s.", "Meilleures salutations", "de", "Veuillez trouver ci-joint notre facture proforma %s d'un montant de %s.", "Veuillez trouver ci-joint notre offre %s d'un montant de %s, valable jusqu'au %s."},
	"it": {"Buongiorno", "In allegato trovate la nostra fattura %s di %s, pagabile entro il %s.", "In allegato trovate la nostra nota di credito %s di %s.", "Cordiali saluti", "di", "In allegato trovate la nostra fattura proforma %s di %s.", "In allegato trovate la nostra offerta %s di %s, valida fino al %s."},
	"en": {"Hello", "Please find attached our invoice %s for %s, payable by %s.", "Please find attached our credit note %s for %s.", "Kind regards", "from", "Please find attached our proforma invoice %s for %s.", "Please find attached our quote %s for %s, valid until %s."},
}

func TestDefaultsMatchToday(t *testing.T) {
	n, a, c := vars["number"], vars["amount"], vars["company"]
	for lang, o := range old {
		sign := "\n\n" + o[3] + "\n" + c
		want := map[string]Template{
			"invoice":     {fmt.Sprintf("Rechnung %s %s %s", n, o[4], c), o[0] + "\n\n" + fmt.Sprintf(o[1], n, a, vars["due_date"]) + sign},
			"credit_note": {fmt.Sprintf("Rechnung %s %s %s", n, o[4], c), o[0] + "\n\n" + fmt.Sprintf(o[2], n, a) + sign},
			"proforma":    {fmt.Sprintf("Rechnung %s %s %s", n, o[4], c), o[0] + "\n\n" + fmt.Sprintf(o[5], n, a) + sign},
			"quote":       {fmt.Sprintf("Rechnung %s %s %s", n, o[4], c), o[0] + "\n\n" + fmt.Sprintf(o[6], n, a, vars["valid_until"]) + sign},
		}
		if len(want) != len(Kinds)-3 { // document and the two signature kinds: TestSignatureDefaults
			t.Fatal("kinds changed")
		}
		for kind, w := range want {
			w.Body = strings.Replace(w.Body, sign, "\n\n"+nextSteps[lang][kind]+sign, 1)
			if got := Render(Default(kind, lang), vars); got != w {
				t.Errorf("%s/%s: got %+v want %+v", kind, lang, got, w)
			}
		}
	}
}

func TestEveryDefaultPassesCheck(t *testing.T) {
	for _, kind := range Kinds {
		for _, lang := range append(Languages, "pl") {
			if got := Check(kind, Default(kind, lang)); len(got) != 0 {
				t.Errorf("%s/%s: %v", kind, lang, got)
			}
		}
	}
}

func TestSignatureDefaults(t *testing.T) {
	v := map[string]string{"document": "Vertrag", "client": "Beta AG", "sender": "Ana Muster", "company": "Muster GmbH"}
	// The English subjects are the ones of the signature emails without a language: the business asks, not the member.
	if got := Render(Default("signature_request", "en"), v).Subject; got != "Muster GmbH asks you to sign “Vertrag”" {
		t.Errorf("request subject %q", got)
	}
	if got := Render(Default("signature_reminder", "en"), v).Subject; got != "Reminder: Muster GmbH asks you to sign “Vertrag”" {
		t.Errorf("reminder subject %q", got)
	}
	for _, kind := range []string{"document", "signature_request", "signature_reminder"} {
		if Default(kind, "pl") != Default(kind, "en") {
			t.Errorf("%s: pl is not en", kind)
		}
		seen := map[Template]bool{}
		for _, lang := range Languages {
			d := Default(kind, lang)
			r := Render(d, v)
			if seen[d] || strings.Contains(r.Subject+r.Body, "{") || !strings.Contains(r.Subject, "Vertrag") ||
				!strings.HasSuffix(r.Body, "\nAna Muster\nMuster GmbH") {
				t.Errorf("%s/%s: %+v", kind, lang, r)
			}
			seen[d] = true
		}
	}
	if got := Render(Default("document", "de"), v).Subject; got != "Vertrag von Muster GmbH" {
		t.Errorf("document subject %q", got)
	}
	if bad := Check("document", Template{Subject: "{document} für {client}", Body: "{sender}"}); len(bad) > 0 {
		t.Errorf("document variables refused: %v", bad)
	}
	if got := Check("signature_request", Template{Subject: "{number}", Body: "x"}); got["subject"] != "Unknown variable {number}. Use {document}, {sender}, {company}." {
		t.Errorf("got %v", got)
	}
}
