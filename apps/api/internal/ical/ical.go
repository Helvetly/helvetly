// Package ical writes iCalendar (RFC 5545) files for scheduling: invitations and updates (METHOD:REQUEST),
// cancellations (CANCEL) and downloads and feeds (PUBLISH). It only writes; Helvetly never reads calendars.
package ical

import (
	"bytes"
	"cmp"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/recur"
)

type Method string

const (
	Request Method = "REQUEST"
	Cancel  Method = "CANCEL"
	Publish Method = "PUBLISH"
)

// DefaultProdID names Helvetly as the calendar's maker.
const DefaultProdID = "-//Helvetly//Scheduling//EN"

// seriesZoneYears bounds how far a series' VTIMEZONE lists transitions: to its last start, at most this far.
// shortcut: explicit transitions, not yearly VTIMEZONE rules; a series running longer (a no-end or a monthly
// one with a long interval) reads the last listed offset after it. Write yearly rules if that matters.
const seriesZoneYears = 11

type Person struct{ Name, Email string }

// Event is one VEVENT: a one-off session, a series (RRule set) or one changed occurrence of a series
// (RecurrenceID set: the series' UID and the occurrence's original start).
type Event struct {
	UID          string
	Sequence     int
	Start, End   time.Time
	Zone         *time.Location // nil or UTC: times in UTC; else DTSTART;TZID with a VTIMEZONE
	RRule        string         // recur.RRULE
	ExDates      []time.Time
	RecurrenceID time.Time
	Summary      string
	Description  string
	Location     string
	URL          string
	Organizer    *Person
	Attendees    []Person
	Status       string // CONFIRMED, TENTATIVE or CANCELLED; empty = CANCELLED under METHOD:CANCEL, else CONFIRMED
}

// Calendar is one VCALENDAR.
type Calendar struct {
	Method Method
	ProdID string    // empty = DefaultProdID
	Name   string    // X-WR-CALNAME, for feeds
	Stamp  time.Time // every event's DTSTAMP
	Events []Event
}

// Bytes is the calendar as an .ics file: CRLF lines folded at 75 octets.
func (c Calendar) Bytes() []byte {
	w := &writer{}
	w.line("BEGIN:VCALENDAR")
	w.line("VERSION:2.0")
	w.line("PRODID:" + oneLine(cmp.Or(c.ProdID, DefaultProdID)))
	w.line("CALSCALE:GREGORIAN")
	if c.Method != "" {
		w.line("METHOD:" + string(c.Method))
	}
	if c.Name != "" {
		w.line("X-WR-CALNAME:" + text(c.Name))
	}
	for _, z := range c.zones() {
		writeZone(w, z.loc, z.from, z.to)
	}
	for _, e := range c.Events {
		c.writeEvent(w, e)
	}
	w.line("END:VCALENDAR")
	return w.buf.Bytes()
}

func (c Calendar) writeEvent(w *writer, e Event) {
	zone := zoneOf(e)
	w.line("BEGIN:VEVENT")
	w.line("UID:" + oneLine(e.UID))
	w.line("DTSTAMP:" + utc(c.Stamp))
	w.line("SEQUENCE:" + strconv.Itoa(e.Sequence))
	w.line("DTSTART" + stamp(e.Start, zone))
	w.line("DTEND" + stamp(e.End, zone))
	if !e.RecurrenceID.IsZero() {
		w.line("RECURRENCE-ID" + stamp(e.RecurrenceID, zone))
	}
	if e.RRule != "" {
		w.line("RRULE:" + oneLine(e.RRule))
	}
	if len(e.ExDates) > 0 {
		values := make([]string, len(e.ExDates))
		for i, d := range e.ExDates {
			values[i] = utc(d)
			if zone != nil {
				values[i] = d.In(zone).Format(localLayout)
			}
		}
		params := ""
		if zone != nil {
			params = ";TZID=" + zone.String()
		}
		w.line("EXDATE" + params + ":" + strings.Join(values, ","))
	}
	w.line("SUMMARY:" + text(e.Summary))
	if e.Description != "" {
		w.line("DESCRIPTION:" + text(e.Description))
	}
	if e.Location != "" {
		w.line("LOCATION:" + text(e.Location))
	}
	if e.URL != "" {
		w.line("URL:" + oneLine(e.URL))
	}
	if o := e.Organizer; o != nil {
		w.line("ORGANIZER" + cn(o.Name) + ":mailto:" + oneLine(o.Email))
	}
	for _, a := range e.Attendees {
		w.line("ATTENDEE" + cn(a.Name) + ";ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:" + oneLine(a.Email))
	}
	status := e.Status
	if status == "" {
		status = "CONFIRMED"
		if c.Method == Cancel {
			status = "CANCELLED"
		}
	}
	w.line("STATUS:" + oneLine(status))
	w.line("TRANSP:OPAQUE")
	w.line("END:VEVENT")
}

const localLayout = "20060102T150405"

func utc(t time.Time) string { return t.UTC().Format("20060102T150405Z") }

// stamp is a DATE-TIME value with its parameters: ":…Z" in UTC or ";TZID=…:…" in zone.
func stamp(t time.Time, zone *time.Location) string {
	if zone == nil {
		return ":" + utc(t)
	}
	return ";TZID=" + zone.String() + ":" + t.In(zone).Format(localLayout)
}

func zoneOf(e Event) *time.Location {
	if e.Zone == nil || e.Zone.String() == "UTC" {
		return nil
	}
	return e.Zone
}

type zoneRange struct {
	loc      *time.Location
	from, to time.Time
}

// zones are the calendar's zones, in order of first use, each with the span its events need.
func (c Calendar) zones() []zoneRange {
	var out []zoneRange
	for _, e := range c.Events {
		loc := zoneOf(e)
		if loc == nil {
			continue
		}
		from, to := e.Start, e.End
		for _, t := range append([]time.Time{e.RecurrenceID}, e.ExDates...) {
			if !t.IsZero() && t.Before(from) {
				from = t
			}
			if t.After(to) {
				to = t
			}
		}
		if last := lastStart(e, loc); last.After(to) {
			to = last
		}
		i := 0
		for i < len(out) && out[i].loc.String() != loc.String() {
			i++
		}
		if i == len(out) {
			out = append(out, zoneRange{loc, from, to})
			continue
		}
		if from.Before(out[i].from) {
			out[i].from = from
		}
		if to.After(out[i].to) {
			out[i].to = to
		}
	}
	return out
}

// lastStart is a series' last start within seriesZoneYears (zero for a one-off or a rule not ours).
func lastStart(e Event, loc *time.Location) time.Time {
	rule, err := recur.Parse(e.RRule, loc)
	if e.RRule == "" || err != nil {
		return time.Time{}
	}
	local := e.Start.In(loc)
	first := recur.DateOf(local).At(local.Hour(), local.Minute())
	starts := recur.Expand(rule, first, loc, nil, e.Start, e.Start.AddDate(seriesZoneYears, 0, 0), recur.MaxOccurrences)
	if len(starts) == 0 {
		return time.Time{}
	}
	return starts[len(starts)-1]
}

// writeZone writes a VTIMEZONE from Go's zone database: the observance in effect at from, then every
// transition up to to.
func writeZone(w *writer, loc *time.Location, from, to time.Time) {
	w.line("BEGIN:VTIMEZONE")
	w.line("TZID:" + loc.String())
	start, next := from.In(loc).ZoneBounds()
	observance(w, loc, start)
	for !next.IsZero() && !next.After(to) {
		observance(w, loc, next)
		_, next = next.ZoneBounds()
	}
	w.line("END:VTIMEZONE")
}

// observance writes the STANDARD or DAYLIGHT part that starts at the instant at (zero: since ever).
func observance(w *writer, loc *time.Location, at time.Time) {
	probe := at
	if at.IsZero() {
		probe = time.Unix(0, 0)
	}
	t := probe.In(loc)
	name, to := t.Zone()
	from := to
	begins := "19700101T000000"
	if !at.IsZero() {
		_, from = at.Add(-time.Second).In(loc).Zone()
		begins = at.UTC().Add(time.Duration(from) * time.Second).Format(localLayout)
	}
	kind := "STANDARD"
	if t.IsDST() {
		kind = "DAYLIGHT"
	}
	w.line("BEGIN:" + kind)
	w.line("DTSTART:" + begins)
	w.line("TZOFFSETFROM:" + offset(from))
	w.line("TZOFFSETTO:" + offset(to))
	w.line("TZNAME:" + text(name))
	w.line("END:" + kind)
}

func offset(seconds int) string {
	sign := "+"
	if seconds < 0 {
		sign, seconds = "-", -seconds
	}
	s := fmt.Sprintf("%s%02d%02d", sign, seconds/3600, seconds%3600/60)
	if seconds%60 != 0 {
		s += fmt.Sprintf("%02d", seconds%60)
	}
	return s
}

// text escapes a TEXT value: backslash, semicolon, comma and line breaks.
func text(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\n", `\n`, "\r", `\n`).Replace(s)
}

// oneLine keeps a non-text value (a URI, an id, an address) from starting a new property.
func oneLine(s string) string { return strings.NewReplacer("\r", "", "\n", "").Replace(s) }

// cn is a quoted CN parameter; DQUOTE and control characters cannot appear in it.
func cn(name string) string {
	if name == "" {
		return ""
	}
	clean := strings.Map(func(r rune) rune {
		if r == '"' || r < 0x20 && r != '\t' || r == 0x7f {
			return -1
		}
		return r
	}, name)
	return `;CN="` + clean + `"`
}

type writer struct{ buf bytes.Buffer }

// line writes one content line folded at 75 octets, never inside a UTF-8 sequence.
func (w *writer) line(s string) {
	limit := 75
	for len(s) > limit {
		cut := limit
		for cut > 0 && !utf8.RuneStart(s[cut]) {
			cut--
		}
		w.buf.WriteString(s[:cut])
		w.buf.WriteString("\r\n ")
		s = s[cut:]
		limit = 74 // the leading space counts
	}
	w.buf.WriteString(s)
	w.buf.WriteString("\r\n")
}
