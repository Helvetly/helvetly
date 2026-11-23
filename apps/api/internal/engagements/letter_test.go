package engagements

import (
	"testing"

	"helvetly.com/api/internal/mail/mailtest"
	"helvetly.com/api/internal/store"
)

func TestReportEmailGolden(t *testing.T) {
	rep := report{name: "Leistungsnachweis-Deutschkurs.pdf", language: "de", e: store.Engagement{Title: "Deutschkurs B2"}, period: "01.11.2026 – 30.11.2026"}
	mailtest.Golden(t, "report", rep.email("ws", "Leistungsnachweis Deutschkurs B2", "Guten Tag\n\nIm Anhang finden Sie den Leistungsnachweis.\n\nFreundliche Grüsse\nDein Deutsch Coach"))
}
