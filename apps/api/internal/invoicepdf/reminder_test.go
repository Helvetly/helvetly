package invoicepdf

import (
	"bytes"
	"strings"
	"testing"

	"helvetly.com/api/internal/dunningcalc"
)

func TestReminderWords(t *testing.T) {
	for _, c := range []struct {
		language    string
		rank, ranks int
		beforeDue   bool
		want        string
	}{
		{"de", 1, 3, false, "Zahlungserinnerung"},
		{"de", 2, 3, false, "2. Mahnung"},
		{"de", 3, 3, false, "Letzte Mahnung"},
		{"de", 2, 2, false, "Letzte Mahnung"},
		{"de", 1, 1, false, "Zahlungserinnerung"},
		{"de", 4, 6, false, "4. Mahnung"},
		{"de", 0, 0, true, "Zahlungshinweis"},
		{"fr", 3, 3, false, "Dernier rappel"},
		{"fr", 2, 3, false, "2e rappel"},
		{"it", 2, 3, false, "2° sollecito"},
		{"en", 2, 3, false, "Second reminder"},
		{"en", 3, 5, false, "Third reminder"},
		{"en", 9, 10, false, "Ninth reminder"},
		{"en", 1, 3, true, "Payment due soon"},
		{"xx", 1, 3, false, "Payment reminder"},
	} {
		if got := ReminderWords(c.language, c.rank, c.ranks, c.beforeDue).Title; got != c.want {
			t.Errorf("%s %d/%d = %q, want %q", c.language, c.rank, c.ranks, got, c.want)
		}
	}
	if got := LegacyReminderWords("en", 2, 3).Title; got != "Reminder 2" {
		t.Errorf("historical title = %q, want Reminder 2", got)
	}
	if w := ReminderWords("de", 0, 0, true); !strings.Contains(w.Sentence, "fällig wird") || !strings.Contains(w.PayWithin, "Fälligkeitsdatum") {
		t.Errorf("note before the due date: %+v", w)
	}
}

func TestRenderReminder(t *testing.T) {
	for _, language := range []string{"de", "fr", "it", "en"} {
		for _, withBill := range []bool{true, false} {
			d := sample(language, 2)
			if !withBill {
				d.Bill = nil
			}
			n := Notice{Words: ReminderWords(language, 2, 3, false), SentOn: "2026-12-20", Rate: 500, InterestFrom: "2026-12-16",
				Amounts: dunningcalc.Notice(d.Invoice.Payable(), 2000, 500, "2026-12-16", "2026-12-20", "CHF")}
			n.Title = n.Words.Title
			out, err := RenderReminder(d, n)
			if err != nil {
				t.Fatalf("%s: %v", language, err)
			}
			want := 1
			if withBill {
				want = 2
			}
			if !bytes.HasPrefix(out, []byte("%PDF-")) || len(pageObject.FindAll(out, -1)) != want {
				t.Fatalf("%s bill=%v: %d pages, want %d", language, withBill, len(pageObject.FindAll(out, -1)), want)
			}
		}
	}
	d := sample("de", 1)
	d.Invoice.Language = "xx"
	if _, err := RenderReminder(d, Notice{Words: ReminderWords("xx", 1, 1, false)}); err == nil {
		t.Fatal("an unknown language rendered")
	}
}
