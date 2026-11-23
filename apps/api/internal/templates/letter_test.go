package templates

import (
	"testing"

	"helvetly.com/api/internal/emailtemplate"
	"helvetly.com/api/internal/mail/mailtest"
)

// The shared document email (a filled template, a contract), as the client gets it.
func TestDocumentEmailGolden(t *testing.T) {
	r := emailtemplate.Render(emailtemplate.Default("document", "de"), map[string]string{"document": "Kursvertrag 2027", "sender": "Anna Keller",
		"company": "Dein Deutsch Coach"})
	mailtest.Golden(t, "document", documentEmail("ws", "de", r, "Kursvertrag 2027", "Kursvertrag-2027.pdf"))
}
