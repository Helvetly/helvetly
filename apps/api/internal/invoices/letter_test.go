package invoices

import (
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
