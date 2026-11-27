package scheduling

import (
	"context"
	"encoding/json"
	"errors"
	"net/mail"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/recur"
	"helvetly.com/api/internal/store"
)

// form collects field messages for one 422.
type form map[string]string

func (f form) fail(k, msg string) {
	if f[k] == "" {
		f[k] = msg
	}
}

func (f form) err() error {
	if len(f) == 0 {
		return nil
	}
	return validationFailed(f)
}

func isNull(raw json.RawMessage) bool { return string(raw) == "null" }

// text reads an optional string of at most max characters; null or blank is nil. min > 0 refuses nil.
func (f form) text(k string, raw json.RawMessage, min, max int) *string {
	if isNull(raw) {
		if min > 0 {
			f.fail(k, "Enter a value.")
		}
		return nil
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		f.fail(k, "Enter text.")
		return nil
	}
	s = strings.TrimSpace(s)
	n := len([]rune(s))
	switch {
	case n == 0 && min > 0:
		f.fail(k, "Enter a value.")
		return nil
	case n > max:
		f.fail(k, "Use at most "+strconv.Itoa(max)+" characters.")
		return nil
	case n == 0:
		return nil
	}
	return &s
}

func (f form) integer(k string, raw json.RawMessage, lo, hi int) (int, bool) {
	var n int
	if json.Unmarshal(raw, &n) != nil || n < lo || n > hi {
		f.fail(k, "Enter a whole number from "+strconv.Itoa(lo)+" to "+strconv.Itoa(hi)+".")
		return 0, false
	}
	return n, true
}

func (f form) boolean(k string, raw json.RawMessage) (bool, bool) {
	var b bool
	if json.Unmarshal(raw, &b) != nil {
		f.fail(k, "Enter true or false.")
		return false, false
	}
	return b, true
}

func (f form) instant(k string, raw json.RawMessage) (time.Time, bool) {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		s = ""
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		f.fail(k, "Enter a time such as 2026-12-01T09:00:00Z.")
		return time.Time{}, false
	}
	return t.UTC(), true
}

func (f form) zone(k string, raw json.RawMessage) (string, bool) {
	var s string
	if json.Unmarshal(raw, &s) == nil && s != "" && len(s) <= 64 && !strings.EqualFold(s, "local") {
		if _, err := time.LoadLocation(s); err == nil {
			return s, true
		}
	}
	f.fail(k, "Choose a time zone such as Europe/Zurich.")
	return "", false
}

// decode reads a JSON object body and refuses keys outside allowed (400).
func decode(body map[string]json.RawMessage, allowed ...string) error {
	for k := range body {
		if !slices.Contains(allowed, k) {
			return badRequest("Unknown field " + strconv.Quote(k) + ".")
		}
	}
	return nil
}

// eventFields are EventInput's fields (scheduling-contract.md).
var eventFields = []string{"client_id", "engagement_id", "event_type_id", "host_id", "title", "description", "client_note", "mode",
	"meeting", "location", "time_zone", "starts_local", "duration_minutes", "recurrence", "skip_holidays", "attendees",
	"units_per_session", "unit_price", "currency", "participant_contact_id"}

// ruleFields change a series' slots.
var ruleFields = []string{"recurrence", "starts_local", "time_zone", "duration_minutes", "skip_holidays"}

var currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)

var dayCodes = map[string]time.Weekday{"SU": time.Sunday, "MO": time.Monday, "TU": time.Tuesday, "WE": time.Wednesday,
	"TH": time.Thursday, "FR": time.Friday, "SA": time.Saturday}

// RecurrenceJSON is a series' rule as the API reads and answers it.
type RecurrenceJSON struct {
	Freq       string      `json:"freq"`
	Interval   int         `json:"interval"`
	ByDay      []string    `json:"by_day,omitempty"`
	ByMonthDay int         `json:"by_month_day,omitempty"`
	BySetPos   *SetPosJSON `json:"by_set_pos,omitempty"`
	Until      string      `json:"until,omitempty"`
	Count      int         `json:"count,omitempty"`
	RRule      string      `json:"rrule"`
}

type SetPosJSON struct {
	Pos int    `json:"pos"`
	Day string `json:"day"`
}

func codeOf(d time.Weekday) string {
	for c, w := range dayCodes {
		if w == d {
			return c
		}
	}
	return ""
}

// recurrenceOut is the event's rule for its answer; nil for a one-off.
func recurrenceOut(e store.SchedEvent) *RecurrenceJSON {
	if e.RRule == nil {
		return nil
	}
	zone := loadZone(e.TimeZone)
	r, err := recur.Parse(*e.RRule, zone)
	if err != nil {
		return &RecurrenceJSON{RRule: *e.RRule}
	}
	out := &RecurrenceJSON{Freq: string(r.Freq), Interval: max(r.Interval, 1), ByMonthDay: r.ByMonthDay, RRule: *e.RRule}
	for _, d := range r.ByDay {
		out.ByDay = append(out.ByDay, codeOf(d))
	}
	if p := r.BySetPos; p != nil {
		out.BySetPos = &SetPosJSON{Pos: p.Pos, Day: codeOf(p.Day)}
	}
	if r.Until != nil {
		out.Until = r.Until.String()
	}
	out.Count = r.Count
	return out
}

// parseRule reads a recurrence object into a valid rule.
func (f form) parseRule(raw json.RawMessage) (*recur.Rule, bool) {
	var in struct {
		Freq       string      `json:"freq"`
		Interval   *int        `json:"interval"`
		ByDay      []string    `json:"by_day"`
		ByMonthDay int         `json:"by_month_day"`
		BySetPos   *SetPosJSON `json:"by_set_pos"`
		Until      *string     `json:"until"`
		Count      *int        `json:"count"`
		RRule      string      `json:"rrule"` // read-only: answers can be sent back as they are
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		f.fail("recurrence", "Check the repeat rule.")
		return nil, false
	}
	r := recur.Rule{Freq: recur.Freq(in.Freq), Interval: 1, ByMonthDay: in.ByMonthDay}
	if in.Interval != nil {
		r.Interval = *in.Interval
		if r.Interval < 1 {
			f.fail("recurrence.interval", "Repeat every 1 to 12 weeks or months.")
			return nil, false
		}
	}
	for _, c := range in.ByDay {
		d, ok := dayCodes[c]
		if !ok {
			f.fail("recurrence.by_day", "Choose days such as MO or TU.")
			return nil, false
		}
		r.ByDay = append(r.ByDay, d)
	}
	if p := in.BySetPos; p != nil {
		d, ok := dayCodes[p.Day]
		if !ok {
			f.fail("recurrence.by_set_pos", "Choose a day such as MO.")
			return nil, false
		}
		r.BySetPos = &recur.SetPos{Pos: p.Pos, Day: d}
	}
	if in.Until != nil {
		d, err := recur.ParseDate(*in.Until)
		if err != nil {
			f.fail("recurrence.until", "Enter a date such as 2027-06-30.")
			return nil, false
		}
		r.Until = &d
	}
	if in.Count != nil {
		if *in.Count < 1 {
			f.fail("recurrence.count", "Enter a number of sessions from 1 to 520.")
			return nil, false
		}
		r.Count = *in.Count
	}
	if err := r.Validate(); err != nil {
		f.fail("recurrence", "Check the repeat rule: "+err.Error()+".")
		return nil, false
	}
	return &r, true
}

func loadZone(name string) *time.Location {
	if z, err := time.LoadLocation(name); err == nil {
		return z
	}
	return time.UTC
}

// setRule stores rule (nil = one-off) on the event as its RRULE, until and count.
func setRule(e *store.SchedEvent, r *recur.Rule) {
	e.RRule, e.UntilDate, e.Count = nil, nil, nil
	if r == nil {
		return
	}
	rr := recur.RRULE(*r, loadZone(e.TimeZone))
	e.RRule = &rr
	if r.Until != nil {
		u := r.Until.String()
		e.UntilDate = &u
	}
	if r.Count > 0 {
		c := r.Count
		e.Count = &c
	}
}

// ruleOf is the event's rule; nil for a one-off.
func ruleOf(e store.SchedEvent) *recur.Rule {
	if e.RRule == nil {
		return nil
	}
	r, err := recur.Parse(*e.RRule, loadZone(e.TimeZone))
	if err != nil {
		return nil
	}
	return &r
}

func startsLocal(e store.SchedEvent) recur.DateTime {
	t := e.StartsLocal
	return recur.DateTime{Date: recur.Date{Year: t.Year(), Month: t.Month(), Day: t.Day()}, Hour: t.Hour(), Minute: t.Minute()}
}

func wall(dt recur.DateTime) time.Time {
	return time.Date(dt.Year, dt.Month, dt.Day, dt.Hour, dt.Minute, 0, 0, time.UTC)
}

// eventInput is a parsed EventInput: the fields it set, its rule and the meeting asked for.
type eventInput struct {
	set             map[string]bool
	rule            *recur.Rule // when set["recurrence"]
	meetingProvider *string     // when set["meeting"]: nil = no meeting
	meetingURL      *string
}

// applyEvent reads body onto e. Create fills the defaults (host: the caller; zone: the workspace's; title, duration,
// mode and price from the event type or the engagement). Each field is checked against its record in q.
func (s *Service) applyEvent(ctx context.Context, q store.Q, sess store.Session, e *store.SchedEvent, body map[string]json.RawMessage,
	create bool) (eventInput, error) {
	in := eventInput{set: map[string]bool{}}
	for k := range body {
		in.set[k] = true
	}
	f := form{}
	ws := sess.Workspace
	if raw, ok := body["client_id"]; ok {
		var id string
		if json.Unmarshal(raw, &id) != nil || id == "" {
			f.fail("client_id", "Choose a client.")
		} else if !create && id != e.ClientID {
			f.fail("client_id", "A session's client cannot change: cancel it and schedule a new one.")
		} else if _, err := q.Client(ctx, ws.ID, id); errors.Is(err, store.ErrNotFound) {
			f.fail("client_id", "Choose a client of this workspace.")
		} else if err != nil {
			return in, err
		} else {
			e.ClientID = id
		}
	} else if create {
		f.fail("client_id", "Choose a client.")
	}
	if raw, ok := body["participant_contact_id"]; ok && f["client_id"] == "" {
		id, msg, err := ParticipantOf(ctx, q, e.ClientID, raw)
		if err != nil {
			return in, err
		}
		if msg != "" {
			f.fail("participant_contact_id", msg)
		} else {
			e.ParticipantContactID = id
		}
	}
	var etype *store.SchedEventType
	if raw, ok := body["event_type_id"]; ok {
		e.EventTypeID = nil
		if !isNull(raw) {
			var id string
			_ = json.Unmarshal(raw, &id)
			t, err := q.SchedEventType(ctx, ws.ID, id)
			switch {
			case errors.Is(err, store.ErrNotFound) || err == nil && t.ArchivedAt != nil:
				f.fail("event_type_id", "Choose an event type of this workspace.")
			case err != nil:
				return in, err
			default:
				etype, e.EventTypeID = &t, &t.ID
			}
		}
	}
	var engagement *store.Engagement
	if raw, ok := body["engagement_id"]; ok {
		e.EngagementID = nil
		if !isNull(raw) {
			var id string
			_ = json.Unmarshal(raw, &id)
			en, err := q.Engagement(ctx, ws.ID, id, false)
			switch {
			case errors.Is(err, store.ErrNotFound) || err == nil && en.ClientID != e.ClientID:
				f.fail("engagement_id", "Choose an engagement of this client.")
			case err != nil:
				return in, err
			default:
				if st := engagements.Status(en, ws.Today(s.now())); st != "active" && st != "scheduled" {
					f.fail("engagement_id", "Choose an active or scheduled engagement.")
				} else {
					engagement, e.EngagementID = &en, &en.ID
				}
			}
		}
	}
	if raw, ok := body["host_id"]; ok {
		var id string
		if json.Unmarshal(raw, &id) != nil || id == "" {
			f.fail("host_id", "Choose a member as host.")
		} else if _, err := q.MemberRole(ctx, ws.ID, id); errors.Is(err, store.ErrNotFound) {
			f.fail("host_id", "Choose a member of this workspace.")
		} else if err != nil {
			return in, err
		} else {
			e.HostUserID = &id
		}
	} else if create {
		e.HostUserID = &sess.User.ID
	}
	if create { // defaults the body may override below
		e.TimeZone, e.Mode = ws.Timezone, "live"
		if etype != nil {
			e.Title, e.DurationMinutes, e.Mode = etype.Name, etype.DurationMinutes, etype.Mode
			e.MeetingProvider, e.Location, e.UnitPrice, e.Currency = etype.MeetingProvider, etype.Location, etype.UnitPrice, etype.Currency
		} else if engagement != nil {
			e.Title = engagement.Title
		}
		if e.Location == nil && e.Mode == "live" {
			set, err := q.SchedulingSettings(ctx, ws.ID)
			if err != nil {
				return in, err
			}
			e.Location = set.DefaultLocation
		}
		if c, err := q.Client(ctx, ws.ID, e.ClientID); err == nil && c.Email != nil && *c.Email != "" {
			e.Attendees = []string{*c.Email}
		}
	}
	if raw, ok := body["title"]; ok {
		if t := f.text("title", raw, 1, 200); t != nil {
			e.Title = *t
		}
	} else if create && e.Title == "" {
		f.fail("title", "Enter a title.")
	}
	if raw, ok := body["description"]; ok {
		e.Description = f.text("description", raw, 0, 4000)
	}
	if raw, ok := body["client_note"]; ok {
		e.ClientNote = f.text("client_note", raw, 0, 2000)
	}
	if raw, ok := body["mode"]; ok {
		var m string
		if json.Unmarshal(raw, &m) != nil || m != "online" && m != "live" {
			f.fail("mode", "Choose online or live.")
		} else {
			e.Mode = m
		}
	}
	if raw, ok := body["location"]; ok {
		e.Location = f.text("location", raw, 0, 500)
	}
	if raw, ok := body["meeting"]; ok {
		if !isNull(raw) {
			var m struct {
				Provider string  `json:"provider"`
				URL      *string `json:"url"`
			}
			if json.Unmarshal(raw, &m) != nil || !slices.Contains([]string{"manual", "google_meet", "teams"}, m.Provider) {
				f.fail("meeting", "Choose a manual link, Google Meet or Teams.")
			} else {
				in.meetingProvider = &m.Provider
				if m.Provider == "manual" && m.URL != nil && *m.URL != "" {
					u, err := url.Parse(*m.URL)
					if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || len(*m.URL) > 2000 {
						f.fail("meeting.url", "Enter a link starting with https://.")
					} else {
						in.meetingURL = m.URL
					}
				}
			}
		}
	}
	if raw, ok := body["time_zone"]; ok {
		if z, ok := f.zone("time_zone", raw); ok {
			e.TimeZone = z
		}
	}
	if raw, ok := body["starts_local"]; ok {
		var str string
		_ = json.Unmarshal(raw, &str)
		dt, err := recur.ParseDateTime(str)
		if err != nil || dt.Year < 2000 || dt.Year > 2100 {
			f.fail("starts_local", "Enter a date and time such as 2026-12-01T09:00.")
		} else {
			e.StartsLocal = wall(dt)
		}
	} else if create {
		f.fail("starts_local", "Choose a date and time.")
	}
	if raw, ok := body["duration_minutes"]; ok {
		if n, ok := f.integer("duration_minutes", raw, 5, 720); ok {
			e.DurationMinutes = n
		}
	} else if create && e.DurationMinutes == 0 {
		f.fail("duration_minutes", "Enter a duration of 5 to 720 minutes.")
	}
	if raw, ok := body["recurrence"]; ok && !isNull(raw) {
		in.rule, _ = f.parseRule(raw)
	}
	if raw, ok := body["skip_holidays"]; ok {
		if b, ok := f.boolean("skip_holidays", raw); ok {
			e.SkipHolidays = b
		}
	}
	if raw, ok := body["attendees"]; ok {
		var list []string
		if json.Unmarshal(raw, &list) != nil || len(list) > 10 {
			f.fail("attendees", "Invite at most 10 email addresses.")
		} else {
			e.Attendees = []string{}
			for _, a := range list {
				addr, err := mail.ParseAddress(strings.TrimSpace(a))
				if err != nil || addr.Name != "" || len(a) > 254 {
					f.fail("attendees", "Enter email addresses only.")
					break
				}
				if !slices.Contains(e.Attendees, strings.ToLower(addr.Address)) {
					e.Attendees = append(e.Attendees, strings.ToLower(addr.Address))
				}
			}
		}
	}
	if raw, ok := body["units_per_session"]; ok {
		e.UnitsPerSession = nil
		if !isNull(raw) {
			n, ok := invoicecalc.ParseQuantity(literal(raw))
			if !ok || n <= 0 || n > 10_000_000 {
				f.fail("units_per_session", "Enter a quantity above 0 with at most three decimals.")
			} else {
				e.UnitsPerSession = &n
			}
		}
	}
	if raw, ok := body["unit_price"]; ok {
		e.UnitPrice = nil
		if !isNull(raw) {
			m, ok := invoicecalc.ParseMoney(literal(raw))
			if !ok || m < 0 || m > 99_999_999_999 {
				f.fail("unit_price", "Enter a price with at most two decimals.")
			} else {
				e.UnitPrice = &m
			}
		}
	}
	if raw, ok := body["currency"]; ok {
		e.Currency = nil
		if !isNull(raw) {
			var c string
			if json.Unmarshal(raw, &c) != nil || !currencyRe.MatchString(c) {
				f.fail("currency", "Enter a currency code such as CHF.")
			} else {
				e.Currency = &c
			}
		}
	}
	if e.Mode == "live" {
		e.MeetingProvider, e.MeetingURL, e.MeetingRef = nil, nil, nil
		if in.meetingProvider != nil {
			f.fail("meeting", "A live session has no meeting link: choose online.")
		}
	} else if in.set["meeting"] {
		if in.meetingProvider == nil || e.MeetingProvider == nil || *in.meetingProvider != *e.MeetingProvider {
			e.MeetingURL, e.MeetingRef = nil, nil // a provider's link is made again for the new provider
		}
		e.MeetingProvider = in.meetingProvider
		if in.meetingProvider != nil && *in.meetingProvider == "manual" {
			e.MeetingURL = in.meetingURL
		}
	}
	if in.rule != nil {
		if in.rule.Until != nil && in.rule.Until.Before(startsLocal(*e).Date) {
			f.fail("recurrence.until", "End the series on or after its first session.")
		}
		if in.rule.Freq == recur.Weekly && len(in.rule.ByDay) == 0 {
			in.rule.ByDay = []time.Weekday{startsLocal(*e).Weekday()}
		}
	}
	if err := f.err(); err != nil {
		return in, err
	}
	if in.set["recurrence"] || in.set["time_zone"] {
		if in.set["recurrence"] {
			setRule(e, in.rule)
		} else if r := ruleOf(*e); r != nil {
			setRule(e, r) // UNTIL is written in the zone
		}
	}
	return in, nil
}

func literal(raw json.RawMessage) string {
	if u, err := strconv.Unquote(string(raw)); err == nil {
		return u
	}
	return string(raw)
}

// ParticipantOf reads a participant_contact_id: null clears it; else a person of the client (so of its workspace) with
// the participant role. A message says why it is refused.
func ParticipantOf(ctx context.Context, q store.Q, clientID string, raw json.RawMessage) (*string, string, error) {
	if isNull(raw) {
		return nil, "", nil
	}
	var id string
	if json.Unmarshal(raw, &id) != nil || id == "" || clientID == "" {
		return nil, "Choose a participant of this client.", nil
	}
	p, err := q.Contact(ctx, clientID, id)
	if errors.Is(err, store.ErrNotFound) || err == nil && !p.Is(store.RoleParticipant) {
		return nil, "Choose a participant of this client.", nil
	}
	if err != nil {
		return nil, "", err
	}
	return &p.ID, "", nil
}
