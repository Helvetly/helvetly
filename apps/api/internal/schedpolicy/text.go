package schedpolicy

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

type wording struct {
	untilStart      string // no notice, no cut-off
	notice          string // %s = the notice
	dayBefore       string // %[1]s = the time, %[2]s = the day word: a cut-off with 24 hours' notice
	lastDay         string // %[1]s = the day word, %[2]s = the time, %[3]s = the notice
	lastDayNoNote   string // %[1]s = the day word, %[2]s = the time
	businessDay     string
	anyDay          string
	or              string
	weekdays        [7]string // from Sunday
	minute, minutes string
	hour, hours     string
	day, days       string
}

var wordings = map[string]wording{
	"en": {
		untilStart:    "Free cancellation until the session starts.",
		notice:        "Free cancellation up to %s before the session.",
		dayBefore:     "Free cancellation until %[1]s on the %[2]s before the session.",
		lastDay:       "Free cancellation until the last %[1]s at %[2]s that is at least %[3]s before the session.",
		lastDayNoNote: "Free cancellation until the last %[1]s at %[2]s before the session.",
		businessDay:   "business day", anyDay: "day", or: "or",
		weekdays: [7]string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"},
		minute:   "minute", minutes: "minutes", hour: "hour", hours: "hours", day: "day", days: "days",
	},
	"de": {
		untilStart:    "Kostenlose Absage bis zum Beginn des Termins.",
		notice:        "Kostenlose Absage bis %s vor dem Termin.",
		dayBefore:     "Kostenlose Absage bis %[1]s Uhr am %[2]s vor dem Termin.",
		lastDay:       "Kostenlose Absage bis zum letzten %[1]s um %[2]s Uhr, mindestens %[3]s vor dem Termin.",
		lastDayNoNote: "Kostenlose Absage bis zum letzten %[1]s um %[2]s Uhr vor dem Termin.",
		businessDay:   "Werktag", anyDay: "Tag", or: "oder",
		weekdays: [7]string{"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"},
		minute:   "Minute", minutes: "Minuten", hour: "Stunde", hours: "Stunden", day: "Tag", days: "Tage",
	},
	"fr": {
		untilStart:    "Annulation gratuite jusqu’au début de la séance.",
		notice:        "Annulation gratuite jusqu’à %s avant la séance.",
		dayBefore:     "Annulation gratuite jusqu’à %[1]s le %[2]s précédant la séance.",
		lastDay:       "Annulation gratuite jusqu’au dernier %[1]s à %[2]s, au moins %[3]s avant la séance.",
		lastDayNoNote: "Annulation gratuite jusqu’au dernier %[1]s à %[2]s avant la séance.",
		businessDay:   "jour ouvrable", anyDay: "jour", or: "ou",
		weekdays: [7]string{"dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"},
		minute:   "minute", minutes: "minutes", hour: "heure", hours: "heures", day: "jour", days: "jours",
	},
	"it": {
		untilStart:    "Disdetta gratuita fino all’inizio della seduta.",
		notice:        "Disdetta gratuita fino a %s prima della seduta.",
		dayBefore:     "Disdetta gratuita fino alle %[1]s del %[2]s precedente la seduta.",
		lastDay:       "Disdetta gratuita fino all’ultimo %[1]s alle %[2]s, almeno %[3]s prima della seduta.",
		lastDayNoNote: "Disdetta gratuita fino all’ultimo %[1]s alle %[2]s prima della seduta.",
		businessDay:   "giorno feriale", anyDay: "giorno", or: "o",
		weekdays: [7]string{"domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"},
		minute:   "minuto", minutes: "minuti", hour: "ora", hours: "ore", day: "giorno", days: "giorni",
	},
}

var businessDays = []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday}

// PolicyText is the policy as one sentence for the portal and the settings' example, in lang (en, de, fr, it;
// a region such as de-CH reads as its language; anything else as English).
func PolicyText(p Policy, lang string) string {
	base, _, _ := strings.Cut(strings.ToLower(lang), "-")
	w, ok := wordings[base]
	if !ok {
		w = wordings["en"]
	}
	if p.Cutoff == nil {
		if p.NoticeMinutes <= 0 {
			return w.untilStart
		}
		return fmt.Sprintf(w.notice, w.duration(p.NoticeMinutes))
	}
	days := slices.Clone(p.CutoffDays)
	slices.Sort(days)
	days = slices.Compact(days)
	var dayWord string
	switch {
	case slices.Equal(days, businessDays):
		dayWord = w.businessDay
	case len(days) == 7:
		dayWord = w.anyDay
	default:
		names := make([]string, len(days))
		for i, d := range days {
			names[i] = w.weekdays[d]
		}
		dayWord = joinOr(names, w.or)
	}
	at := p.Cutoff.String()
	switch {
	case p.NoticeMinutes == 24*60 && (dayWord == w.businessDay || dayWord == w.anyDay):
		return fmt.Sprintf(w.dayBefore, at, dayWord)
	case p.NoticeMinutes <= 0:
		return fmt.Sprintf(w.lastDayNoNote, dayWord, at)
	}
	return fmt.Sprintf(w.lastDay, dayWord, at, w.duration(p.NoticeMinutes))
}

func (w wording) duration(minutes int) string {
	n, one, many := minutes, w.minute, w.minutes
	switch {
	case minutes%(24*60) == 0 && minutes > 24*60:
		n, one, many = minutes/(24*60), w.day, w.days
	case minutes%60 == 0:
		n, one, many = minutes/60, w.hour, w.hours
	}
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

func joinOr(names []string, or string) string {
	if len(names) < 2 {
		return strings.Join(names, "")
	}
	return strings.Join(names[:len(names)-1], ", ") + " " + or + " " + names[len(names)-1]
}
