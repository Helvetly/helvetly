package schedpolicy

import (
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/recur"
)

var zurich = func() *time.Location {
	z, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		panic(err)
	}
	return z
}()

func at(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := recur.ParseDateTime(s)
	if err != nil {
		t.Fatal(err)
	}
	return v.In(zurich)
}

func day(t *testing.T, s string) recur.Date {
	t.Helper()
	d, err := recur.ParseDate(s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func clock(t *testing.T, s string) Clock {
	t.Helper()
	c, err := ParseClock(s)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func local(times []time.Time) string {
	out := make([]string, len(times))
	for i, v := range times {
		out[i] = v.In(zurich).Format("Mon 01-02 15:04")
	}
	return strings.Join(out, ",")
}

func TestParseClock(t *testing.T) {
	for _, s := range []string{"00:00", "09:30", "23:59", "24:00"} {
		if c, err := ParseClock(s); err != nil || c.String() != s {
			t.Errorf("ParseClock(%s) = %v, %v", s, c, err)
		}
	}
	for _, s := range []string{"", "9:30", "24:01", "25:00", "12:60", "ab:cd", "12-00", "-1:00"} {
		if _, err := ParseClock(s); err == nil {
			t.Errorf("ParseClock(%s) read", s)
		}
	}
}

func TestDeadline(t *testing.T) {
	weekdays := []time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday}
	two := clock(t, "14:00")
	holidays := DateSet{day(t, "2027-12-24"): true, day(t, "2027-12-25"): true}
	for _, c := range []struct {
		name, start, want string
		p                 Policy
	}{
		{"24 hours, no cut-off", "2027-11-08T10:00", "2027-11-07T10:00", Policy{NoticeMinutes: 1440}},
		{"no notice", "2027-11-08T10:00", "2027-11-08T10:00", Policy{}},
		{"Monday with a weekday cut-off goes to Friday", "2027-11-08T10:00", "2027-11-05T14:00",
			Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays}},
		{"Wednesday afternoon: Tuesday's cut-off", "2027-11-10T16:00", "2027-11-09T14:00",
			Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays}},
		{"cut-off at exactly start − notice counts", "2027-11-10T14:00", "2027-11-09T14:00",
			Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays}},
		{"no notice: the same day's cut-off", "2027-11-10T15:00", "2027-11-10T14:00",
			Policy{Cutoff: &two, CutoffDays: weekdays}},
		{"holiday skipped", "2027-12-27T09:00", "2027-12-23T14:00",
			Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays, CutoffSkipsHolidays: true}},
		{"holiday kept", "2027-12-27T09:00", "2027-12-24T14:00",
			Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays}},
		{"across the summer-time switch", "2027-03-29T10:00", "2027-03-26T14:00",
			Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays}},
		{"no cut-off day falls back to the notice", "2027-11-08T10:00", "2027-11-07T10:00",
			Policy{NoticeMinutes: 1440, Cutoff: &two}},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := Deadline(at(t, c.start), c.p, holidays, zurich)
			if want := at(t, c.want); !got.Equal(want) {
				t.Fatalf("Deadline = %s, want %s", got.In(zurich), want)
			}
		})
	}
}

func TestPolicyText(t *testing.T) {
	two := clock(t, "14:00")
	weekdays := []time.Weekday{time.Friday, time.Monday, time.Tuesday, time.Wednesday, time.Thursday}
	all := []time.Weekday{0, 1, 2, 3, 4, 5, 6}
	for _, c := range []struct {
		lang string
		p    Policy
		want string
	}{
		{"en", Policy{}, "Free cancellation until the session starts."},
		{"en", Policy{NoticeMinutes: 1440}, "Free cancellation up to 24 hours before the session."},
		{"en", Policy{NoticeMinutes: 60}, "Free cancellation up to 1 hour before the session."},
		{"en", Policy{NoticeMinutes: 2880}, "Free cancellation up to 2 days before the session."},
		{"en", Policy{NoticeMinutes: 90}, "Free cancellation up to 90 minutes before the session."},
		{"en", Policy{NoticeMinutes: 1}, "Free cancellation up to 1 minute before the session."},
		{"en", Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays},
			"Free cancellation until 14:00 on the business day before the session."},
		{"en", Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: all},
			"Free cancellation until 14:00 on the day before the session."},
		{"en", Policy{NoticeMinutes: 2880, Cutoff: &two, CutoffDays: weekdays},
			"Free cancellation until the last business day at 14:00 that is at least 2 days before the session."},
		{"en", Policy{Cutoff: &two, CutoffDays: []time.Weekday{time.Friday, time.Monday}},
			"Free cancellation until the last Monday or Friday at 14:00 before the session."},
		{"en", Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: []time.Weekday{time.Friday}},
			"Free cancellation until the last Friday at 14:00 that is at least 24 hours before the session."},
		{"en", Policy{Cutoff: &two, CutoffDays: []time.Weekday{1, 3, 5}},
			"Free cancellation until the last Monday, Wednesday or Friday at 14:00 before the session."},
		{"de-CH", Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays},
			"Kostenlose Absage bis 14:00 Uhr am Werktag vor dem Termin."},
		{"de", Policy{NoticeMinutes: 60}, "Kostenlose Absage bis 1 Stunde vor dem Termin."},
		{"fr", Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays},
			"Annulation gratuite jusqu’à 14:00 le jour ouvrable précédant la séance."},
		{"fr", Policy{NoticeMinutes: 4320}, "Annulation gratuite jusqu’à 3 jours avant la séance."},
		{"it", Policy{NoticeMinutes: 1440, Cutoff: &two, CutoffDays: weekdays},
			"Disdetta gratuita fino alle 14:00 del giorno feriale precedente la seduta."},
		{"it", Policy{}, "Disdetta gratuita fino all’inizio della seduta."},
		{"rm", Policy{NoticeMinutes: 1440}, "Free cancellation up to 24 hours before the session."},
	} {
		if got := PolicyText(c.p, c.lang); got != c.want {
			t.Errorf("PolicyText(%s, %+v) =\n%s\nwant\n%s", c.lang, c.p, got, c.want)
		}
	}
}

func TestPolicyTextEveryLanguage(t *testing.T) {
	two := clock(t, "14:00")
	for lang := range wordings {
		for _, p := range []Policy{{}, {NoticeMinutes: 120}, {NoticeMinutes: 1440, Cutoff: &two, CutoffDays: businessDays},
			{NoticeMinutes: 2880, Cutoff: &two, CutoffDays: businessDays}, {Cutoff: &two, CutoffDays: []time.Weekday{1}}} {
			if got := PolicyText(p, lang); strings.Contains(got, "%!") || got == "" {
				t.Errorf("PolicyText(%s, %+v) = %q", lang, p, got)
			}
		}
	}
}

func weekdayHours(start, end string, t *testing.T) Hours {
	var w []Window
	for d := time.Monday; d <= time.Friday; d++ {
		w = append(w, Window{d, clock(t, start), clock(t, end)})
	}
	return Hours{Zone: zurich, Weekly: w}
}

func TestSlots(t *testing.T) {
	hours := weekdayHours("09:00", "12:00", t)
	now := at(t, "2027-11-08T07:00") // Monday
	base := SlotQuery{
		Hours: hours, Duration: time.Hour, Now: now, Horizon: 60 * 24 * time.Hour,
		From: at(t, "2027-11-08T00:00"), To: at(t, "2027-11-09T00:00"),
	}
	for _, c := range []struct {
		name string
		edit func(q *SlotQuery)
		want string
	}{
		{"whole hours in the window", func(q *SlotQuery) {}, "Mon 11-08 09:00,Mon 11-08 10:00,Mon 11-08 11:00"},
		{"a step of 30 minutes", func(q *SlotQuery) { q.Step = 30 * time.Minute },
			"Mon 11-08 09:00,Mon 11-08 09:30,Mon 11-08 10:00,Mon 11-08 10:30,Mon 11-08 11:00"},
		{"minimum notice", func(q *SlotQuery) { q.MinNotice = 3 * time.Hour }, "Mon 11-08 10:00,Mon 11-08 11:00"},
		{"horizon", func(q *SlotQuery) { q.Horizon = 3 * time.Hour }, "Mon 11-08 09:00"},
		{"a session takes its slot", func(q *SlotQuery) {
			q.Taken = []Block{{at(t, "2027-11-08T10:00"), at(t, "2027-11-08T11:00")}}
		}, "Mon 11-08 09:00,Mon 11-08 11:00"},
		{"buffers keep neighbours clear", func(q *SlotQuery) {
			q.BufferAfter = 15 * time.Minute
			q.BufferBefore = 15 * time.Minute
			q.Taken = []Block{{at(t, "2027-11-08T10:00"), at(t, "2027-11-08T11:00")}}
		}, ""},
		{"a busy time ending at the slot start does not take it", func(q *SlotQuery) {
			q.Taken = []Block{{at(t, "2027-11-08T08:00"), at(t, "2027-11-08T09:00")}}
		}, "Mon 11-08 09:00,Mon 11-08 10:00,Mon 11-08 11:00"},
		{"a holiday has no slots", func(q *SlotQuery) { q.Holidays = DateSet{day(t, "2027-11-08"): true} }, ""},
		{"a day off", func(q *SlotQuery) {
			q.Hours.Overrides = map[recur.Date]Override{day(t, "2027-11-08"): {Off: true}}
		}, ""},
		{"other hours that day", func(q *SlotQuery) {
			q.Hours.Overrides = map[recur.Date]Override{day(t, "2027-11-08"): {Start: clock(t, "14:00"), End: clock(t, "16:00")}}
		}, "Mon 11-08 14:00,Mon 11-08 15:00"},
		{"no hours on Saturday", func(q *SlotQuery) {
			q.From, q.To = at(t, "2027-11-13T00:00"), at(t, "2027-11-14T00:00")
		}, ""},
		{"overlapping windows give each slot once", func(q *SlotQuery) {
			q.Hours.Weekly = append(q.Hours.Weekly, Window{time.Monday, clock(t, "10:00"), clock(t, "13:00")})
		}, "Mon 11-08 09:00,Mon 11-08 10:00,Mon 11-08 11:00,Mon 11-08 12:00"},
		{"an empty range", func(q *SlotQuery) { q.To = q.From }, ""},
		{"no duration", func(q *SlotQuery) { q.Duration = 0 }, ""},
		{"a window to midnight", func(q *SlotQuery) {
			q.Hours.Overrides = map[recur.Date]Override{day(t, "2027-11-08"): {Start: clock(t, "22:00"), End: clock(t, "24:00")}}
		}, "Mon 11-08 22:00,Mon 11-08 23:00"},
	} {
		t.Run(c.name, func(t *testing.T) {
			q := base
			q.Hours.Weekly = append([]Window(nil), base.Hours.Weekly...)
			c.edit(&q)
			if got := local(Slots(q)); got != c.want {
				t.Fatalf("Slots =\n%s\nwant\n%s", got, c.want)
			}
		})
	}
}

func TestSlotsAcrossSummerTime(t *testing.T) {
	q := SlotQuery{
		Hours:    Hours{Zone: zurich, Weekly: []Window{{time.Sunday, clock(t, "01:00"), clock(t, "04:00")}}},
		Duration: time.Hour, Now: at(t, "2027-03-01T00:00"), Horizon: 60 * 24 * time.Hour,
		From: at(t, "2027-03-28T00:00"), To: at(t, "2027-03-29T00:00"),
	}
	// 01:00–04:00 local is two real hours that night: 01:00 and 03:00 (02:00 does not exist).
	if got := local(Slots(q)); got != "Sun 03-28 01:00,Sun 03-28 03:00" {
		t.Fatalf("Slots = %s", got)
	}
}

func TestConflicts(t *testing.T) {
	hours := weekdayHours("09:00", "17:00", t)
	cand := Candidate{Start: at(t, "2027-11-08T10:00"), End: at(t, "2027-11-08T11:00"), Exclude: "soc_self"}
	sessions := []Session{
		{ID: "soc_self", Title: "Itself", Start: cand.Start, End: cand.End},
		{ID: "soc_a", Title: "Overlaps", Start: at(t, "2027-11-08T10:30"), End: at(t, "2027-11-08T11:30")},
		{ID: "soc_b", Title: "Touches", Start: at(t, "2027-11-08T11:00"), End: at(t, "2027-11-08T12:00")},
		{ID: "soc_c", Title: "Long, from yesterday", Start: at(t, "2027-11-07T11:00"), End: at(t, "2027-11-08T10:15")},
	}
	busy := []Block{{at(t, "2027-11-08T09:30"), at(t, "2027-11-08T10:05")}, {at(t, "2027-11-08T12:00"), at(t, "2027-11-08T13:00")}}
	got := Conflicts(cand, sessions, busy, hours, nil)
	var kinds []string
	for _, c := range got {
		kinds = append(kinds, string(c.Kind)+":"+c.OccurrenceID+":"+c.Title)
	}
	want := "event:soc_c:Long, from yesterday,busy::,event:soc_a:Overlaps"
	if s := strings.Join(kinds, ","); s != want {
		t.Fatalf("Conflicts = %s, want %s", s, want)
	}

	for _, c := range []struct {
		name     string
		cand     Candidate
		hours    Hours
		holidays DateSet
		want     string
	}{
		{"inside hours", cand, hours, nil, ""},
		{"no hours set: never outside", Candidate{Start: at(t, "2027-11-13T10:00"), End: at(t, "2027-11-13T11:00")},
			Hours{Zone: zurich}, nil, ""},
		{"Saturday is outside", Candidate{Start: at(t, "2027-11-13T10:00"), End: at(t, "2027-11-13T11:00")}, hours, nil, "outside_hours"},
		{"running past the end", Candidate{Start: at(t, "2027-11-08T16:30"), End: at(t, "2027-11-08T17:30")}, hours, nil, "outside_hours"},
		{"a day off", cand, Hours{Zone: zurich, Overrides: map[recur.Date]Override{day(t, "2027-11-08"): {Off: true}}}, nil, "outside_hours"},
		{"a holiday", cand, hours, DateSet{day(t, "2027-11-08"): true}, "holiday"},
	} {
		t.Run(c.name, func(t *testing.T) {
			var kinds []string
			for _, k := range Conflicts(c.cand, nil, nil, c.hours, c.holidays) {
				kinds = append(kinds, string(k.Kind))
			}
			if s := strings.Join(kinds, ","); s != c.want {
				t.Fatalf("Conflicts = %s, want %s", s, c.want)
			}
		})
	}
}

func TestQueryRange(t *testing.T) {
	start, end := at(t, "2027-11-08T10:00"), at(t, "2027-11-08T11:00")
	from, to := QueryRange(start, end, 15*time.Minute)
	if !from.Equal(at(t, "2027-11-07T09:45")) || !to.Equal(at(t, "2027-11-08T11:15")) {
		t.Fatalf("QueryRange = %s, %s", from.In(zurich), to.In(zurich))
	}
	// The longest session that still reaches the candidate starts inside the range.
	longest := start.Add(-MaxDuration).Add(time.Minute)
	if longest.Before(from) {
		t.Fatal("a 24 h session overlapping the candidate falls outside the range")
	}
}

func TestSwissHolidays(t *testing.T) {
	for _, c := range []struct {
		canton, lang string
		year         int
		want         string
	}{
		{"", "en", 2027, "2027-01-01 New Year’s Day,2027-05-06 Ascension Day,2027-08-01 Swiss National Day,2027-12-25 Christmas Day"},
		{"zh", "de", 2027, "2027-01-01 Neujahr,2027-01-02 Berchtoldstag,2027-03-26 Karfreitag,2027-03-29 Ostermontag," +
			"2027-05-01 Tag der Arbeit,2027-05-06 Auffahrt,2027-05-17 Pfingstmontag,2027-08-01 Bundesfeier," +
			"2027-12-25 Weihnachten,2027-12-26 Stephanstag"},
		{"GE", "fr", 2027, "2027-01-01 Nouvel An,2027-03-26 Vendredi saint,2027-03-29 Lundi de Pâques," +
			"2027-05-06 Ascension,2027-05-17 Lundi de Pentecôte,2027-08-01 Fête nationale,2027-09-09 Jeûne genevois," +
			"2027-12-25 Noël,2027-12-31 Restauration de la République"},
		{"VD", "fr-CH", 2026, "2026-01-01 Nouvel An,2026-01-02 Saint-Berchtold,2026-04-03 Vendredi saint," +
			"2026-04-06 Lundi de Pâques,2026-05-14 Ascension,2026-05-25 Lundi de Pentecôte,2026-08-01 Fête nationale," +
			"2026-09-21 Lundi du Jeûne fédéral,2026-12-25 Noël"},
		{"TI", "it", 2027, "2027-01-01 Capodanno,2027-01-06 Epifania,2027-03-19 San Giuseppe,2027-03-29 Lunedì dell’Angelo," +
			"2027-05-01 Festa del lavoro,2027-05-06 Ascensione,2027-05-17 Lunedì di Pentecoste,2027-05-27 Corpus Domini," +
			"2027-06-29 Santi Pietro e Paolo,2027-08-01 Festa nazionale,2027-08-15 Assunzione,2027-11-01 Ognissanti," +
			"2027-12-08 Immacolata,2027-12-25 Natale,2027-12-26 Santo Stefano"},
	} {
		got, err := SwissHolidays(c.year, c.canton, c.lang)
		if err != nil {
			t.Fatal(err)
		}
		var s []string
		for _, h := range got {
			s = append(s, h.Date.String()+" "+h.Name)
		}
		if j := strings.Join(s, ","); j != c.want {
			t.Errorf("SwissHolidays(%d, %s) =\n%s\nwant\n%s", c.year, c.canton, j, c.want)
		}
	}
	if _, err := SwissHolidays(2027, "XX", "en"); err == nil {
		t.Fatal("unknown canton accepted")
	}
}

func TestNaefelserFahrt(t *testing.T) {
	for year, want := range map[int]string{
		2027: "2027-04-01", // Easter 28 March
		2026: "2026-04-09", // Easter 5 April: 2 April is Holy Thursday
		2029: "2029-04-05", // Easter 1 April: 5 April is after Easter
	} {
		if got := naefelserFahrt(year, Easter(year)).String(); got != want {
			t.Errorf("Näfelser Fahrt %d = %s, want %s", year, got, want)
		}
	}
}

func TestEaster(t *testing.T) {
	for year, want := range map[int]string{2024: "2024-03-31", 2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28",
		2038: "2038-04-25", 2285: "2285-03-22"} {
		if got := Easter(year).String(); got != want {
			t.Errorf("Easter(%d) = %s, want %s", year, got, want)
		}
	}
}
