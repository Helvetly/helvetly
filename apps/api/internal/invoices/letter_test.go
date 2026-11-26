package invoices

import (
	"strings"
	"testing"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/mail/mailtest"
	"helvetly.com/api/internal/store"
)

// An invoice's and a credit note's email: the message as written, then the summary and the attachments.
func TestInvoiceEmailGolden(t *testing.T) {
	number := "2026-042"
	inv := store.Invoice{Kind: "invoice", Number: &number, DueDate: "2026-12-24", Currency: "CHF", Language: "de", Total: 48000}
	pdf := []mail.Attachment{{Name: "Rechnung-2026-042.pdf"}, {Name: "Rechnung-2026-042.xml"}}
	message := "Guten Tag Lea Frei\n\nIm Anhang finden Sie die Rechnung 2026-042.\n\nFreundliche Grüsse\nDein Deutsch Coach"
	mailtest.Golden(t, "invoice", withLetter(mail.Message{Workspace: "ws", Subject: "Rechnung 2026-042", Text: message, Attachments: pdf}, inv))
	credit := store.Invoice{Kind: "credit_note", Number: &number, DueDate: "2026-12-24", Currency: "EUR", Language: "en", Total: -12050}
	mailtest.Golden(t, "credit-note", withLetter(mail.Message{Workspace: "ws", Subject: "Credit note 2026-042", Language: "en", Text: "Hello,\n\nYour credit note is attached.",
		Attachments: []mail.Attachment{{Name: "Credit-note-2026-042.pdf"}}}, credit))
}

// The workspace's own footer follows its details and comes before "Sent with", escaped, in both parts.
func TestInvoiceEmailWithFooterGolden(t *testing.T) {
	number := "2026-042"
	inv := store.Invoice{Kind: "invoice", Number: &number, DueDate: "2026-12-24", Currency: "CHF", Language: "de", Total: 48000}
	brand := mailtest.Brand
	brand.Footer = "Bürozeiten: Mo–Fr 8–17 Uhr\nBank <Muster> & Partner, IBAN CH93 0076 2011 6238 5295 7"
	m := withLetter(mail.Message{Workspace: "ws", Subject: "Rechnung 2026-042", Text: "Guten Tag\n\nIm Anhang die Rechnung.",
		Attachments: []mail.Attachment{{Name: "Rechnung-2026-042.pdf"}}}, inv)
	mailtest.GoldenWith(t, "invoice-footer", m, brand)
	h, text := mail.Render(m, brand, mailtest.PublicURL)
	if !strings.Contains(h, "Bürozeiten: Mo–Fr 8–17 Uhr<br>Bank &lt;Muster&gt; &amp; Partner") || strings.Index(h, "Bürozeiten") > strings.Index(h, "Gesendet mit") ||
		strings.Index(h, "CHE-123.456.789") > strings.Index(h, "Bürozeiten") {
		t.Errorf("html footer:\n%s", h)
	}
	if !strings.Contains(text, "MWST\n\nBürozeiten: Mo–Fr 8–17 Uhr\nBank <Muster> & Partner") {
		t.Errorf("text footer:\n%s", text)
	}
}

// A payment confirmation in each language: in part with the next instalment (de, fr), and in full (it, en).
func TestPaymentConfirmationEmailGolden(t *testing.T) {
	number, next, due := "2026-042", store.Money(20000), "2026-12-24"
	for _, tt := range []struct {
		lang, subject, message string
		open                   store.Money
	}{
		{"de", "Zahlung erhalten: Rechnung 2026-042", "Guten Tag\n\nVielen Dank für Ihre Zahlung. Wir haben am 24.11.2026 CHF 280.00 für Rechnung 2026-042 erhalten.\n\nFreundliche Grüsse\nDein Deutsch Coach", 20000},
		{"fr", "Paiement reçu : Facture 2026-042", "Bonjour\n\nMerci pour votre paiement. Nous avons bien reçu CHF 280.00 le 24.11.2026 (Facture 2026-042).\n\nMeilleures salutations\nDein Deutsch Coach", 20000},
		{"it", "Pagamento ricevuto: Fattura 2026-042", "Buongiorno\n\nGrazie per il suo pagamento. Abbiamo ricevuto CHF 280.00 il 24.11.2026 (Fattura 2026-042).\n\nCordiali saluti\nDein Deutsch Coach", 0},
		{"en", "Payment received: Invoice 2026-042", "Hello\n\nThank you for your payment. We received CHF 280.00 on 24.11.2026 for Invoice 2026-042.\n\nKind regards\nDein Deutsch Coach", 0},
	} {
		inv := store.Invoice{Kind: "invoice", Number: &number, DueDate: due, Currency: "CHF", Language: tt.lang, Total: 48000}
		c := store.PaymentConfirmation{Amount: 28000, PaidOn: "2026-11-24", Open: tt.open}
		if tt.open > 0 {
			c.NextAmount, c.NextDue = &next, &due
		}
		m := confirmationLetter(mail.Message{Workspace: "ws", Language: tt.lang, Subject: tt.subject, Text: tt.message}, inv, c)
		mailtest.Golden(t, "payment-confirmation-"+tt.lang, m)
	}
}
