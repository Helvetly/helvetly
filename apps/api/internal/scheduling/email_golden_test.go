package scheduling

import (
	"testing"
	"time"

	"helvetly.com/api/internal/ical"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/mail/mailtest"
	"helvetly.com/api/internal/store"
)

// weekly is n sessions every Tuesday 20:30–23:00 in Zurich from 24 Nov 2026.
func weekly(n int) []store.SchedOccurrence {
	zone := loadZone("Europe/Zurich")
	out := make([]store.SchedOccurrence, n)
	for i := range out {
		start := time.Date(2026, 11, 24, 20, 30, 0, 0, zone).AddDate(0, 0, 7*i)
		out[i] = store.SchedOccurrence{StartsAt: start, OriginalStart: start, EndsAt: start.Add(150 * time.Minute)}
	}
	return out
}

func goldenCtx(lang string, ev store.SchedEvent) mailCtx {
	return mailCtx{ws: store.Workspace{ID: "ws", Timezone: "Europe/Zurich"}, event: ev, lang: lang, zone: loadZone("Europe/Zurich"),
		host: "Anna Keller", greet: "Lea Frei", portal: "https://portal.example.com/w/deutsch/sessions"}
}

// Every client email of scheduling, rendered as the client gets it.
func TestSchedulingEmailsGolden(t *testing.T) {
	rule, place, link := "FREQ=WEEKLY;BYDAY=TU", "Bahnhofstrasse 1, 8001 Zürich", "https://meet.example.com/abc-defg-hij"
	price, chf, note := store.Money(12000), "CHF", "Bitte bringen Sie Ihr Lehrbuch mit."
	series := store.SchedEvent{Title: "Deutsch 60 min", Mode: "live", Location: &place, TimeZone: "Europe/Zurich",
		StartsLocal: time.Date(2026, 11, 24, 20, 30, 0, 0, time.UTC), DurationMinutes: 150, RRule: &rule, UnitPrice: &price, Currency: &chf, ClientNote: &note}
	online := store.SchedEvent{Title: "Probestunde", Mode: "online", MeetingURL: &link, TimeZone: "Europe/Zurich", DurationMinutes: 60}
	proposal := weekly(1)[0].StartsAt.AddDate(0, 0, 2)
	reason := "Die Woche ist ausgebucht."
	de, en := wordsOf("de"), wordsOf("en")
	for _, c := range []struct {
		name, lang, subject string
		ev                  store.SchedEvent
		l                   letter
		method              ical.Method
	}{
		{"invitation-series", "de", de.invitation, series, letter{lead: "Dein Deutsch Coach lädt Sie zu Deutsch 60 min ein.", sessions: weekly(57),
			where: place, note: note}, ical.Request},
		{"invitation-one-off-online", "en", en.invitation, online, letter{lead: "Dein Deutsch Coach invites you to Probestunde.", sessions: weekly(1),
			join: link}, ical.Request},
		{"update-few", "en", en.update, series, letter{lead: "Dein Deutsch Coach changed Deutsch 60 min.", sessions: weekly(2), where: place}, ical.Request},
		{"cancellation", "fr", wordsOf("fr").cancellation, series, letter{lead: "Dein Deutsch Coach a annulé Deutsch 60 min.", sessions: weekly(1)}, ical.Cancel},
		{"proposal", "de", de.proposed, series, letter{lead: "Dein Deutsch Coach schlägt einen anderen Termin für Deutsch 60 min vor.",
			sessions: weekly(1), proposal: &proposal, portalLine: true}, ""},
		{"declined", "it", wordsOf("it").declined, series, letter{lead: "Dein Deutsch Coach ha rifiutato la sua richiesta per Deutsch 60 min.",
			sessions: weekly(1), reason: reason}, ""},
		{"reminder", "de", de.reminder, series, letter{lead: "Eine Erinnerung an Ihren Termin Deutsch 60 min mit Dein Deutsch Coach.",
			sessions: weekly(1), where: place, note: note}, ""},
	} {
		c.l.title = c.ev.Title
		text, body := compose(goldenCtx(c.lang, c.ev), c.l, c.method)
		mailtest.Golden(t, "scheduling-"+c.name, mail.Message{Workspace: "ws", Subject: c.subject + ": " + c.ev.Title, Language: c.lang, Text: text, HTML: body})
	}
}
