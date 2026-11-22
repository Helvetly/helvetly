package ical

import (
	"bytes"
	"flag"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/recur"
)

var update = flag.Bool("update", false, "rewrite the golden files")

func load(t *testing.T, name string) *time.Location {
	t.Helper()
	z, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return z
}

func TestGolden(t *testing.T) {
	zurich := load(t, "Europe/Zurich")
	ny := load(t, "America/New_York")
	stamp := time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC)
	org := &Person{Name: `Praxis "Müller", Zürich`, Email: "hello@praxis.example"}
	client := []Person{{Name: "Anna Muster", Email: "anna@example.com"}}
	start := time.Date(2026, 12, 1, 8, 0, 0, 0, time.UTC) // 09:00 in Zurich
	until := recur.Date{Year: 2027, Month: time.June, Day: 29}
	series := Event{
		UID: "sev_abc@app.helvetly.com", Sequence: 2, Zone: zurich,
		Start: start, End: start.Add(50 * time.Minute),
		RRule:   recur.RRULE(recur.Rule{Freq: recur.Weekly, Interval: 2, ByDay: []time.Weekday{time.Tuesday}, Until: &until}, zurich),
		ExDates: []time.Time{start.AddDate(0, 0, 28)},
		Summary: "Coaching; session, with notes\\ and a line\nbreak", Location: "Bahnhofstrasse 1, 8001 Zürich",
		Description: "Join: https://meet.example/abc\nPortal: https://portal.helvetly.com/w/praxis/sessions — " +
			strings.Repeat("long text with ümlauts ", 6),
		URL: "https://portal.helvetly.com/w/praxis/sessions", Organizer: org, Attendees: client,
	}
	for _, c := range []struct {
		name string
		cal  Calendar
	}{
		{"one-off-request", Calendar{Method: Request, Stamp: stamp, Events: []Event{{
			UID: "soc_one@app.helvetly.com", Start: start, End: start.Add(time.Hour), Summary: "First meeting",
			Organizer: org, Attendees: client,
		}}}},
		{"series-request", Calendar{Method: Request, Stamp: stamp, Events: []Event{series}}},
		{"occurrence-update", Calendar{Method: Request, Stamp: stamp, Events: []Event{{
			UID: series.UID, Sequence: 3, Zone: zurich, RecurrenceID: start.AddDate(0, 0, 14),
			Start: start.AddDate(0, 0, 15), End: start.AddDate(0, 0, 15).Add(50 * time.Minute),
			Summary: "Coaching", Organizer: org, Attendees: client,
		}}}},
		{"occurrence-cancel", Calendar{Method: Cancel, Stamp: stamp, Events: []Event{{
			UID: series.UID, Sequence: 4, Zone: zurich, RecurrenceID: start.AddDate(0, 0, 14),
			Start: start.AddDate(0, 0, 14), End: start.AddDate(0, 0, 14).Add(50 * time.Minute),
			Summary: "Coaching", Organizer: org, Attendees: client,
		}}}},
		{"feed-publish", Calendar{Method: Publish, Name: "Anna’s sessions", Stamp: stamp, Events: []Event{
			{UID: "soc_a@app.helvetly.com", Zone: ny, Start: time.Date(2027, 3, 14, 14, 0, 0, 0, time.UTC),
				End: time.Date(2027, 3, 14, 15, 0, 0, 0, time.UTC), Summary: "Busy", Status: "TENTATIVE"},
			{UID: "soc_b@app.helvetly.com", Zone: time.UTC, Start: start, End: start.Add(time.Hour), Summary: "Busy"},
			{UID: "soc_c@app.helvetly.com", Zone: ny, Start: time.Date(2027, 11, 7, 14, 0, 0, 0, time.UTC),
				End: time.Date(2027, 11, 7, 15, 0, 0, 0, time.UTC), Summary: "Busy"},
		}}},
		{"no-dst-zone", Calendar{Method: Publish, ProdID: "-//Test//EN", Stamp: stamp, Events: []Event{{
			UID: "soc_t@app.helvetly.com", Zone: load(t, "Asia/Kolkata"), Start: start, End: start.Add(time.Hour), Summary: "Call",
		}}}},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := c.cal.Bytes()
			validate(t, got)
			// Golden files keep LF endings so git never converts them; validate checks the real CRLF.
			got = bytes.ReplaceAll(got, []byte("\r\n"), []byte("\n"))
			path := filepath.Join("testdata", c.name+".ics")
			if *update {
				if err := os.WriteFile(path, got, 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, want) {
				t.Fatalf("%s differs from the golden file (go test -update):\n%s", path, got)
			}
		})
	}
}

// validate parses an .ics as a calendar client would and checks what RFC 5545 requires of it.
func validate(t *testing.T, ics []byte) {
	t.Helper()
	s := string(ics)
	if !strings.HasSuffix(s, "\r\n") || strings.Contains(strings.ReplaceAll(s, "\r\n", ""), "\n") ||
		strings.Contains(strings.ReplaceAll(s, "\r\n", ""), "\r") {
		t.Fatal("lines must end in CRLF and contain no bare CR or LF")
	}
	var lines []string
	for _, raw := range strings.Split(strings.TrimSuffix(s, "\r\n"), "\r\n") {
		if len(raw) > 75 {
			t.Fatalf("line of %d octets: %q", len(raw), raw)
		}
		if !utf8.ValidString(raw) {
			t.Fatalf("folding split a character: %q", raw)
		}
		if strings.HasPrefix(raw, " ") {
			lines[len(lines)-1] += raw[1:]
			continue
		}
		lines = append(lines, raw)
	}
	var stack []string
	props := map[string][]string{} // per component path
	zones, tzids := map[string]bool{}, map[string]bool{}
	for _, l := range lines {
		name, value, ok := strings.Cut(l, ":")
		if !ok {
			t.Fatalf("no value: %q", l)
		}
		key, params, _ := strings.Cut(name, ";")
		switch key {
		case "BEGIN":
			stack = append(stack, value)
			continue
		case "END":
			if len(stack) == 0 || stack[len(stack)-1] != value {
				t.Fatalf("END:%s does not close %v", value, stack)
			}
			stack = stack[:len(stack)-1]
			continue
		}
		path := strings.Join(stack, "/")
		props[path] = append(props[path], key)
		if path == "VCALENDAR/VTIMEZONE" && key == "TZID" {
			zones[value] = true
		}
		if id, ok := strings.CutPrefix(params, "TZID="); ok {
			tzids[id] = true
		}
	}
	if len(stack) != 0 {
		t.Fatalf("unclosed %v", stack)
	}
	for _, need := range []string{"VERSION", "PRODID"} {
		if !slices.Contains(props["VCALENDAR"], need) {
			t.Fatalf("VCALENDAR without %s", need)
		}
	}
	for _, need := range []string{"UID", "DTSTAMP", "DTSTART", "SEQUENCE"} {
		if !slices.Contains(props["VCALENDAR/VEVENT"], need) {
			t.Fatalf("VEVENT without %s", need)
		}
	}
	for id := range tzids {
		if !zones[id] {
			t.Fatalf("TZID %s has no VTIMEZONE", id)
		}
	}
}

func TestEscapingRoundTrips(t *testing.T) {
	for _, s := range []string{"a,b;c\\d", "line\nbreak", "crlf\r\nbreak", "plain"} {
		got := strings.NewReplacer(`\\`, `\`, `\;`, ";", `\,`, ",", `\n`, "\n").Replace(text(s))
		if want := strings.ReplaceAll(s, "\r\n", "\n"); got != want {
			t.Errorf("text(%q) reads back as %q", s, got)
		}
	}
	if got := text("a\rb"); got != `a\nb` {
		t.Errorf("a bare CR = %q", got)
	}
}

func TestNoInjection(t *testing.T) {
	ics := string(Calendar{Method: Request, Stamp: time.Now(), Events: []Event{{
		UID: "x\r\nATTENDEE:mailto:evil@example.com", Start: time.Now(), End: time.Now().Add(time.Hour),
		Summary: "s\r\nATTENDEE:mailto:evil@example.com", URL: "https://a\nb",
		Organizer: &Person{Name: "Bad\"\x01Name", Email: "o@example.com\r\nX:1"},
	}}}.Bytes())
	validate(t, []byte(ics))
	for _, l := range strings.Split(ics, "\r\n") {
		if strings.HasPrefix(l, "ATTENDEE") || strings.HasPrefix(l, "X:") {
			t.Fatalf("a value started a property: %q", l)
		}
	}
	if !strings.Contains(ics, `ORGANIZER;CN="BadName":mailto:o@example.comX:1`) {
		t.Fatalf("organizer not cleaned:\n%s", ics)
	}
}

func TestFoldingKeepsCharacters(t *testing.T) {
	w := &writer{}
	long := "SUMMARY:" + strings.Repeat("ü", 100)
	w.line(long)
	var joined string
	for i, l := range strings.Split(strings.TrimSuffix(w.buf.String(), "\r\n"), "\r\n") {
		if len(l) > 75 || !utf8.ValidString(l) {
			t.Fatalf("line %d: %q", i, l)
		}
		if i > 0 {
			l = strings.TrimPrefix(l, " ")
		}
		joined += l
	}
	if joined != long {
		t.Fatal("unfolding does not give the line back")
	}
}

func TestOffset(t *testing.T) {
	for in, want := range map[int]string{3600: "+0100", -18000: "-0500", 19800: "+0530", 0: "+0000", -2 * 60 * 60: "-0200", 1772: "+002932"} {
		if got := offset(in); got != want {
			t.Errorf("offset(%d) = %s, want %s", in, got, want)
		}
	}
}

func TestZonesMerge(t *testing.T) {
	zurich := load(t, "Europe/Zurich")
	a := time.Date(2027, 1, 10, 9, 0, 0, 0, time.UTC)
	b := time.Date(2026, 6, 10, 9, 0, 0, 0, time.UTC)
	c := Calendar{Events: []Event{
		{Zone: zurich, Start: a, End: a.Add(time.Hour)},
		{Zone: zurich, Start: b, End: b.Add(time.Hour), RecurrenceID: b.Add(-time.Hour), ExDates: []time.Time{a.AddDate(1, 0, 0)}},
	}}
	got := c.zones()
	if len(got) != 1 || !got[0].from.Equal(b.Add(-time.Hour)) || !got[0].to.Equal(a.AddDate(1, 0, 0)) {
		t.Fatalf("zones = %+v", got)
	}
}

func TestSeriesZoneRange(t *testing.T) {
	zurich := load(t, "Europe/Zurich")
	start := time.Date(2027, 1, 5, 8, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		name, rrule string
		want        time.Time
	}{
		{"until ends it", "FREQ=WEEKLY;UNTIL=20270119T225959Z", start.AddDate(0, 0, 14)},
		{"count ends it", "FREQ=MONTHLY;COUNT=3", time.Date(2027, 3, 5, 8, 0, 0, 0, time.UTC)},
		{"no end stops at the 520th", "FREQ=WEEKLY", start.AddDate(0, 0, 7*519)},
		{"a rule not ours keeps the event's end", "FREQ=DAILY", start.Add(time.Hour)},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := Calendar{Events: []Event{{Zone: zurich, Start: start, End: start.Add(time.Hour), RRule: c.rrule}}}.zones()
			if !got[0].to.Equal(c.want) {
				t.Fatalf("to = %s, want %s", got[0].to, c.want)
			}
		})
	}
}
