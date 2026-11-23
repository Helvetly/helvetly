package dunning

import (
	"testing"

	"helvetly.com/api/internal/mail/mailtest"
	"helvetly.com/api/internal/store"
)

// The second notice's email with a fee and interest, as the client gets it.
func TestNoticeEmailGolden(t *testing.T) {
	number, seller, from := "2026-042", "billing@deutsch.example", "2026-11-01"
	st := state{inv: store.Invoice{Kind: "invoice", Number: &number, Language: "de", Currency: "CHF", IssueDate: "2026-10-01", DueDate: "2026-10-31",
		Seller: &store.Party{Name: "Dein Deutsch Coach", Email: &seller}}}
	n := store.DunningNotice{Level: 2, Levels: 3, SentOn: "2026-11-30", Open: 108100, Fee: 3000, Interest: 444, InterestRate: 500,
		InterestFrom: &from, Total: 111544, Email: "lea@kunde.example"}
	m := st.message(n, []byte("%PDF"), []byte("%PDF"))
	m.Workspace = "ws" // as send sets it
	mailtest.Golden(t, "notice-2", m)
}
