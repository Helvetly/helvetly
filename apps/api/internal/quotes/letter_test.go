package quotes

import (
	"testing"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/mail/mailtest"
	"helvetly.com/api/internal/store"
)

func TestQuoteEmailGolden(t *testing.T) {
	number := "Q-2026-007"
	q := store.Quote{Number: &number, Revision: 2, Currency: "CHF", Language: "fr", PayableTotal: 1250000, ValidUntil: "2027-01-15"}
	m := mail.Message{Workspace: "ws", Subject: "Offre Q-2026-007", Language: "fr", Text: "Bonjour,\n\nVeuillez trouver ci-joint notre offre révisée.\n\nMeilleures salutations",
		Attachments: []mail.Attachment{{Name: FileName(q)}}}
	mailtest.Golden(t, "quote-revision", withLetter(m, q))
}
