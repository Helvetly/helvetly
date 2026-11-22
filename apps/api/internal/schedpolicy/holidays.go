package schedpolicy

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/recur"
)

// Holiday is a suggested public holiday.
type Holiday struct {
	Date recur.Date
	Name string
}

// Cantons are the Swiss cantons' codes.
var Cantons = []string{"AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU", "NE", "NW", "OW",
	"SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS", "ZG", "ZH"}

type swissDay struct {
	names [4]string // en, de, fr, it
	date  func(year int, easter recur.Date) recur.Date
	// in lists the cantons that keep the day; empty = all. notIn lists the cantons that do not.
	in, notIn []string
}

func fixed(month time.Month, day int) func(int, recur.Date) recur.Date {
	return func(y int, _ recur.Date) recur.Date { return recur.Date{Year: y, Month: month, Day: day} }
}

func fromEaster(days int) func(int, recur.Date) recur.Date {
	return func(_ int, e recur.Date) recur.Date { return e.AddDays(days) }
}

// nthWeekday is the nth (1-based) weekday on or after the given day of the month.
func nthWeekday(month time.Month, after int, wd time.Weekday, n, plus int) func(int, recur.Date) recur.Date {
	return func(y int, _ recur.Date) recur.Date {
		d := recur.Date{Year: y, Month: month, Day: after}
		return d.AddDays((int(wd)-int(d.Weekday())+7)%7 + 7*(n-1) + plus)
	}
}

var catholic = []string{"AI", "FR", "JU", "LU", "NW", "OW", "SZ", "TI", "UR", "VS", "ZG"}

// The days most cantons keep by law or custom. A suggestion the business edits, not a legal register: some
// days are kept only in parts of a canton.
var swissDays = []swissDay{
	{names: [4]string{"New Year’s Day", "Neujahr", "Nouvel An", "Capodanno"}, date: fixed(time.January, 1)},
	{names: [4]string{"Berchtold’s Day", "Berchtoldstag", "Saint-Berchtold", "San Basilio"}, date: fixed(time.January, 2),
		in: []string{"AG", "BE", "FR", "GL", "JU", "LU", "NE", "OW", "SH", "SO", "TG", "VD", "ZG", "ZH"}},
	{names: [4]string{"Epiphany", "Heilige Drei Könige", "Épiphanie", "Epifania"}, date: fixed(time.January, 6),
		in: []string{"SZ", "TI", "UR"}},
	{names: [4]string{"Republic Day", "Jahrestag der Ausrufung der Republik", "Instauration de la République", "Festa della Repubblica"},
		date: fixed(time.March, 1), in: []string{"NE"}},
	{names: [4]string{"St Joseph’s Day", "Josefstag", "Saint-Joseph", "San Giuseppe"}, date: fixed(time.March, 19),
		in: []string{"NW", "SZ", "TI", "UR", "VS"}},
	{names: [4]string{"Näfels Pilgrimage", "Näfelser Fahrt", "Näfelser Fahrt", "Näfelser Fahrt"}, date: naefelserFahrt,
		in: []string{"GL"}},
	{names: [4]string{"Good Friday", "Karfreitag", "Vendredi saint", "Venerdì santo"}, date: fromEaster(-2),
		notIn: []string{"TI", "VS"}},
	{names: [4]string{"Easter Monday", "Ostermontag", "Lundi de Pâques", "Lunedì dell’Angelo"}, date: fromEaster(1),
		notIn: []string{"NE", "VS"}},
	{names: [4]string{"Labour Day", "Tag der Arbeit", "Fête du travail", "Festa del lavoro"}, date: fixed(time.May, 1),
		in: []string{"BL", "BS", "JU", "NE", "SH", "TG", "TI", "ZH"}},
	{names: [4]string{"Ascension Day", "Auffahrt", "Ascension", "Ascensione"}, date: fromEaster(39)},
	{names: [4]string{"Whit Monday", "Pfingstmontag", "Lundi de Pentecôte", "Lunedì di Pentecoste"}, date: fromEaster(50),
		notIn: []string{"VS"}},
	{names: [4]string{"Corpus Christi", "Fronleichnam", "Fête-Dieu", "Corpus Domini"}, date: fromEaster(60), in: catholic},
	{names: [4]string{"Jura Independence Day", "Fest der Unabhängigkeit", "Commémoration du plébiscite", "Festa dell’indipendenza"},
		date: fixed(time.June, 23), in: []string{"JU"}},
	{names: [4]string{"Saints Peter and Paul", "Peter und Paul", "Saints Pierre et Paul", "Santi Pietro e Paolo"},
		date: fixed(time.June, 29), in: []string{"TI"}},
	{names: [4]string{"Swiss National Day", "Bundesfeier", "Fête nationale", "Festa nazionale"}, date: fixed(time.August, 1)},
	{names: [4]string{"Assumption Day", "Mariä Himmelfahrt", "Assomption", "Assunzione"}, date: fixed(time.August, 15), in: catholic},
	// Thursday after the first Sunday of September.
	{names: [4]string{"Geneva Fast", "Genfer Bettag", "Jeûne genevois", "Digiuno ginevrino"},
		date: nthWeekday(time.September, 1, time.Sunday, 1, 4), in: []string{"GE"}},
	// Monday after the third Sunday of September.
	{names: [4]string{"Federal Fast Monday", "Bettagsmontag", "Lundi du Jeûne fédéral", "Lunedì del digiuno federale"},
		date: nthWeekday(time.September, 1, time.Sunday, 3, 1), in: []string{"NE", "VD"}},
	{names: [4]string{"St Nicholas of Flüe", "Bruder Klaus", "Saint-Nicolas-de-Flüe", "San Nicolao della Flüe"},
		date: fixed(time.September, 25), in: []string{"OW"}},
	{names: [4]string{"All Saints’ Day", "Allerheiligen", "Toussaint", "Ognissanti"}, date: fixed(time.November, 1),
		in: []string{"AI", "FR", "GL", "JU", "LU", "NW", "OW", "SG", "SZ", "TI", "UR", "VS", "ZG"}},
	{names: [4]string{"Immaculate Conception", "Mariä Empfängnis", "Immaculée Conception", "Immacolata"},
		date: fixed(time.December, 8), in: []string{"AI", "LU", "NW", "OW", "SZ", "TI", "UR", "VS", "ZG"}},
	{names: [4]string{"Christmas Day", "Weihnachten", "Noël", "Natale"}, date: fixed(time.December, 25)},
	{names: [4]string{"St Stephen’s Day", "Stephanstag", "Saint-Étienne", "Santo Stefano"}, date: fixed(time.December, 26),
		notIn: []string{"GE", "JU", "NE", "VD", "VS"}},
	{names: [4]string{"Restoration of the Republic", "Wiederherstellung der Republik", "Restauration de la République", "Restaurazione della Repubblica"},
		date: fixed(time.December, 31), in: []string{"GE"}},
}

// naefelserFahrt is the first Thursday of April, a week later when that falls in Holy Week.
func naefelserFahrt(y int, easter recur.Date) recur.Date {
	d := nthWeekday(time.April, 1, time.Thursday, 1, 0)(y, easter)
	if !d.Before(easter.AddDays(-7)) && d.Before(easter) {
		d = d.AddDays(7)
	}
	return d
}

// SwissHolidays suggests the public holidays of year: those every canton keeps, plus the canton's own when one
// is given (a code of Cantons), named in lang (en, de, fr, it; else English).
func SwissHolidays(year int, canton, lang string) ([]Holiday, error) {
	canton = strings.ToUpper(canton)
	if canton != "" && !slices.Contains(Cantons, canton) {
		return nil, fmt.Errorf("unknown canton %q", canton)
	}
	base, _, _ := strings.Cut(strings.ToLower(lang), "-")
	li := max(slices.Index([]string{"en", "de", "fr", "it"}, base), 0)
	easter := Easter(year)
	var out []Holiday
	for _, h := range swissDays {
		keep := len(h.in) == 0 && len(h.notIn) == 0 ||
			canton != "" && (len(h.in) > 0 && slices.Contains(h.in, canton) || len(h.notIn) > 0 && !slices.Contains(h.notIn, canton))
		if keep {
			out = append(out, Holiday{h.date(year, easter), h.names[li]})
		}
	}
	slices.SortStableFunc(out, func(a, b Holiday) int { return strings.Compare(a.Date.String(), b.Date.String()) })
	return out, nil
}

// Easter is Western Easter Sunday (the anonymous Gregorian algorithm).
func Easter(y int) recur.Date {
	a, b, c := y%19, y/100, y%100
	d, e := b/4, b%4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i, k := c/4, c%4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	month := (h + l - 7*m + 114) / 31
	day := (h+l-7*m+114)%31 + 1
	return recur.Date{Year: y, Month: time.Month(month), Day: day}
}
