package scheduling

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"time"

	"helvetly.com/api/internal/ical"
	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/recur"
	"helvetly.com/api/internal/store"
)

// Mailer sends the client's and the hosts' email (mail.Metered around mail.Branded: counted, as the business).
type Mailer interface {
	Send(ctx context.Context, m mail.Message) error
}

// PortalURLs is where a workspace's clients sign in (internal/portalscope).
type PortalURLs interface {
	CanonicalURL(ctx context.Context, ws store.Workspace) (string, error)
}

// Emails is the Notifier of the scheduling service: after every committed change it emails the client (invitation,
// update, cancellation, request answer, each with its .ics) and tells the host in the bell, and it sends the
// reminders. Without a mailer only the bell works.
type Emails struct {
	s      *Service
	mail   Mailer
	portal PortalURLs
	brands func(ctx context.Context, workspaceID string) (mail.Brand, error)
}

// NewEmails wires the emails; m and urls may be nil (no mail server, no portal links). brands names the business
// (invoices.Service.MailBrand): its name, document language and reply address.
func NewEmails(s *Service, m Mailer, urls PortalURLs, brands func(context.Context, string) (mail.Brand, error)) *Emails {
	return &Emails{s: s, mail: m, portal: urls, brands: brands}
}

// Changed is called once a write committed; a failure is logged, never answered: the change stands.
func (e *Emails) Changed(ctx context.Context, c Change) {
	if err := e.changed(ctx, c); err != nil {
		e.s.log.ErrorContext(ctx, "scheduling email", "kind", c.Kind, "workspace", c.WorkspaceID, "error", err)
	}
}

func (e *Emails) changed(ctx context.Context, c Change) error {
	switch c.Kind {
	case ChangeRequested:
		return e.notifyHost(ctx, c)
	case ChangeAnswered:
		return e.answer(ctx, c)
	}
	var errs []error
	// The client booked or cancelled on their own: the host hears of it (a proposal's answer comes as ChangeRequested).
	if c.ActorID == "" && (c.Kind == ChangeInvited || c.Kind == ChangeCancelled) {
		errs = append(errs, e.notifyHost(ctx, c))
	}
	if c.Notify {
		errs = append(errs, e.sessions(ctx, c))
	}
	return errors.Join(errs...)
}

// letter is what one email says, before the words of its language are put in.
type letter struct {
	title        string // the session's
	lead         string // the first sentence, already in the email's language
	sessions     []store.SchedOccurrence
	where, join  string
	note, reason string
	proposal     *time.Time
	portalLine   bool // "Accept or decline it in the client portal."
}

// mailCtx is what every email to one client of one event needs.
type mailCtx struct {
	ws       store.Workspace
	brand    mail.Brand
	event    store.SchedEvent
	to       []string
	lang     string
	zone     *time.Location
	hostMail string
	host     string // the host's name
	greet    string // the client's name in the greeting; empty for a host
	portal   string
	members  bool // a member's own email (the host's reminder): sent as Helvetly, not as the business
}

func (e *Emails) load(ctx context.Context, q store.Q, workspaceID, eventID string) (mailCtx, error) {
	ws, err := q.AdmissionWorkspace(ctx, workspaceID)
	if err != nil {
		return mailCtx{}, err
	}
	ev, err := q.SchedEvent(ctx, workspaceID, eventID, false)
	if err != nil {
		return mailCtx{}, err
	}
	m := mailCtx{ws: ws, event: ev, zone: ws.Location(), brand: mail.Brand{Name: ws.Name}}
	if e.brands != nil {
		if m.brand, err = e.brands(ctx, workspaceID); err != nil {
			return m, err
		}
	}
	client, err := q.Client(ctx, workspaceID, ev.ClientID)
	if err != nil {
		return m, err
	}
	m.greet = client.GreetingName()
	m.to = slices.Clone(ev.Attendees)
	if len(m.to) == 0 {
		for _, a := range []*string{client.Email, client.BillingEmail} {
			if a != nil && strings.TrimSpace(*a) != "" {
				m.to = []string{strings.TrimSpace(*a)}
				break
			}
		}
	}
	m.lang = language(deref(client.Language), m.brand.Language)
	if tz, err := q.ClientTimeZone(ctx, workspaceID, ev.ClientID); err != nil {
		return m, err
	} else if tz != nil {
		m.zone = loadZone(*tz)
	}
	if ev.HostUserID != nil {
		members, err := q.SchedMembers(ctx, workspaceID)
		if err != nil {
			return m, err
		}
		m.hostMail, m.host = deref(members[*ev.HostUserID].Email), members[*ev.HostUserID].Name
	}
	if e.portal != nil {
		if u, err := e.portal.CanonicalURL(ctx, ws); err == nil && u != "" {
			m.portal = strings.TrimRight(u, "/") + "/sessions"
		}
	}
	return m, nil
}

// sessions emails the client about the change's occurrences: one email per event they belong to.
func (e *Emails) sessions(ctx context.Context, c Change) error {
	q := e.s.db.Q
	byEvent := map[string][]store.SchedOccurrence{}
	var order []string
	for _, id := range c.OccurrenceIDs {
		o, err := q.SchedOccurrence(ctx, c.WorkspaceID, id, false)
		if err != nil {
			return err
		}
		// A declined booking is told by the request's answer, with its cancellation.
		if c.Kind == ChangeCancelled && o.Status == store.SchedDeclined {
			continue
		}
		if _, ok := byEvent[o.EventID]; !ok {
			order = append(order, o.EventID)
		}
		byEvent[o.EventID] = append(byEvent[o.EventID], o)
	}
	var errs []error
	if c.EndedEventID != "" {
		errs = append(errs, e.ended(ctx, c.WorkspaceID, c.EndedEventID))
	}
	for _, eventID := range order {
		errs = append(errs, e.event(ctx, c.Kind, c.WorkspaceID, eventID, byEvent[eventID]))
	}
	return errors.Join(errs...)
}

// event emails one event's changed occurrences with the .ics that applies the change in the client's calendar.
func (e *Emails) event(ctx context.Context, kind, workspaceID, eventID string, occs []store.SchedOccurrence) error {
	m, err := e.load(ctx, e.s.db.Q, workspaceID, eventID)
	if err != nil || len(m.to) == 0 {
		return err
	}
	cal, err := e.calendar(ctx, m, kind, occs)
	if err != nil {
		return err
	}
	w := wordsOf(m.lang)
	title := sessionTitle(m.event, occs[0])
	l := letter{title: title, sessions: occs, note: deref(m.event.ClientNote)}
	l.where, l.join = place(m.event, occs[0])
	subject := w.invitation
	switch kind {
	case ChangeInvited:
		l.lead = fmt.Sprintf(w.invited, m.brand.Name, title)
	case ChangeUpdated:
		subject, l.lead = w.update, fmt.Sprintf(w.updated, m.brand.Name, title)
	case ChangeCancelled:
		subject, l.lead, l.where, l.join, l.note = w.cancellation, fmt.Sprintf(w.cancelled, m.brand.Name, title), "", "", ""
	}
	return e.send(ctx, m, subject+": "+title, l, cal)
}

// ended tells the client that a split series now ends before its new one: the old UID's REQUEST with its UNTIL.
func (e *Emails) ended(ctx context.Context, workspaceID, eventID string) error {
	m, err := e.load(ctx, e.s.db.Q, workspaceID, eventID)
	if err != nil || len(m.to) == 0 {
		return err
	}
	rows, err := e.s.db.SchedOccurrences(ctx, workspaceID, store.SchedOccurrenceFilter{EventID: eventID})
	if err != nil {
		return err
	}
	master, err := e.s.seriesVEvent(ctx, e.s.db.Q, m.event, rows)
	if err != nil {
		return err
	}
	w := wordsOf(m.lang)
	l := letter{title: m.event.Title, lead: fmt.Sprintf(w.updated, m.brand.Name, m.event.Title)}
	return e.send(ctx, m, w.update+": "+m.event.Title, l, &ical.Calendar{Method: ical.Request, Stamp: e.s.now(), Events: []ical.Event{master}})
}

// calendar is the change as iCalendar: a one-off's VEVENT; for a series the master (RRULE, EXDATEs) with its moved
// sessions, or only the sessions changed on their own; a cancellation of the whole series cancels its UID.
func (e *Emails) calendar(ctx context.Context, m mailCtx, kind string, occs []store.SchedOccurrence) (*ical.Calendar, error) {
	cal := &ical.Calendar{Method: ical.Request, Stamp: e.s.now()}
	if kind == ChangeCancelled {
		cal.Method = ical.Cancel
	}
	ev := m.event
	single := func(list []store.SchedOccurrence) []ical.Event {
		out := make([]ical.Event, len(list))
		for i, o := range list {
			out[i] = e.s.VEvent(ev, o)
		}
		return out
	}
	if ev.RRule == nil {
		cal.Events = single(occs)
		return e.dress(cal, m), nil
	}
	rows, err := e.s.db.SchedOccurrences(ctx, ev.WorkspaceID, store.SchedOccurrenceFilter{EventID: ev.ID})
	if err != nil {
		return nil, err
	}
	switch {
	case kind == ChangeCancelled && !slices.ContainsFunc(rows, func(o store.SchedOccurrence) bool { return isOpen(o.Status) }):
		master, err := e.s.seriesVEvent(ctx, e.s.db.Q, ev, rows)
		if err != nil {
			return nil, err
		}
		master.Status = "CANCELLED"
		cal.Events = []ical.Event{master}
	case kind == ChangeCancelled || !slices.ContainsFunc(occs, func(o store.SchedOccurrence) bool { return !ownWay(o) }):
		cal.Events = single(occs)
	default:
		master, err := e.s.seriesVEvent(ctx, e.s.db.Q, ev, rows)
		if err != nil {
			return nil, err
		}
		cal.Events = append([]ical.Event{master}, single(slices.DeleteFunc(slices.Clone(rows), func(o store.SchedOccurrence) bool {
			return !isOpen(o.Status) || !ownWay(o)
		}))...)
	}
	return e.dress(cal, m), nil
}

// ownWay: the occurrence differs from its slot in the rule (changed on its own, or moved).
func ownWay(o store.SchedOccurrence) bool { return o.IsException || !o.StartsAt.Equal(o.OriginalStart) }

// dress puts the organizer (the reply address) and the recipients on every VEVENT.
func (e *Emails) dress(cal *ical.Calendar, m mailCtx) *ical.Calendar {
	org := &ical.Person{Name: m.brand.Name, Email: cmp.Or(m.brand.ReplyTo, m.hostMail, m.brand.Owner)}
	if org.Email == "" {
		org = nil
	}
	for i := range cal.Events {
		cal.Events[i].Organizer = org
		for _, a := range m.to {
			cal.Events[i].Attendees = append(cal.Events[i].Attendees, ical.Person{Email: a})
		}
		if m.portal != "" && cal.Events[i].URL == "" {
			cal.Events[i].URL = m.portal
		}
	}
	return cal
}

// seriesVEvent is the series as one VEVENT: its first start in its zone, its RRULE and as EXDATEs the slots that have
// no session (a skipped holiday) or a cancelled one. A COUNT whose skipped dates do not count (our rule) is written
// as the UNTIL of the last session, since an iCalendar COUNT counts the EXDATEs too.
func (s *Service) seriesVEvent(ctx context.Context, q store.Q, e store.SchedEvent, rows []store.SchedOccurrence) (ical.Event, error) {
	zone := loadZone(e.TimeZone)
	start := startsLocal(e)
	first := start.In(zone)
	rule := ruleOf(e)
	if rule == nil {
		return ical.Event{}, fmt.Errorf("event %s: no readable rule", e.ID)
	}
	r := *rule
	holidays, err := holidaySet(ctx, q, e.WorkspaceID)
	if err != nil {
		return ical.Event{}, err
	}
	end := s.horizon()
	if e.MaterialisedUntil != nil {
		end = *e.MaterialisedUntil
	}
	if r.Count > 0 {
		all := slotStarts(e, holidays, time.Time{}, first.AddDate(50, 0, 0))
		if len(all) > 0 {
			last := recur.DateOf(all[len(all)-1].In(zone))
			r.Count, r.Until = 0, &last
		}
	}
	if r.Until != nil {
		if u := r.Until.AddDays(1).At(0, 0).In(zone); u.Before(end) {
			end = u
		}
	}
	kept := map[int64]bool{}
	for _, o := range rows {
		if o.Status != store.SchedCancelledOnTime && o.Status != store.SchedCancelledLate && o.Status != store.SchedDeclined {
			kept[o.OriginalStart.Unix()] = true
		}
	}
	var ex []time.Time
	for _, t := range recur.Expand(r, start, zone, nil, time.Time{}, end, recur.MaxOccurrences) {
		if !kept[t.Unix()] {
			ex = append(ex, t)
		}
	}
	uid, _ := s.UID(e, store.SchedOccurrence{})
	v := ical.Event{UID: uid, Sequence: e.Sequence, Start: first, End: first.Add(duration(e)), Zone: zone, RRule: recur.RRULE(r, zone),
		ExDates: ex, Summary: e.Title, Description: deref(e.ClientNote)}
	v.Location, v.URL = place(e, store.SchedOccurrence{})
	if e.Mode == "online" {
		v.Location = v.URL
	}
	return v, nil
}

// place is where the session is: the address of a live one, the meeting link of an online one.
func place(e store.SchedEvent, o store.SchedOccurrence) (where, join string) {
	if e.Mode == "online" {
		return "", cmp.Or(deref(o.MeetingURL), deref(e.MeetingURL))
	}
	return cmp.Or(deref(o.Location), deref(e.Location)), ""
}

// mapsLink opens an address in Google Maps, which most clients use; a plain search link, no API.
func mapsLink(address string) string {
	return "https://maps.google.com/?q=" + url.QueryEscape(address)
}

func sessionTitle(e store.SchedEvent, o store.SchedOccurrence) string {
	return cmp.Or(deref(o.Title), e.Title)
}

// answer emails the client the business's answer on their request: a proposal, or a decline (a declined booking
// with its cancellation). An approval is told by the change it made (update or cancellation).
func (e *Emails) answer(ctx context.Context, c Change) error {
	q := e.s.db.Q
	req, err := q.SchedRequest(ctx, c.WorkspaceID, c.RequestID, false)
	if err != nil || (req.Status != "declined" && req.Status != "proposed") {
		return err
	}
	o, err := q.SchedOccurrence(ctx, c.WorkspaceID, req.OccurrenceID, false)
	if err != nil {
		return err
	}
	m, err := e.load(ctx, q, c.WorkspaceID, o.EventID)
	if err != nil || len(m.to) == 0 {
		return err
	}
	w := wordsOf(m.lang)
	title := sessionTitle(m.event, o)
	l := letter{title: title, sessions: []store.SchedOccurrence{o}, reason: deref(req.Reason)}
	subject := w.declined
	var cal *ical.Calendar
	switch {
	case req.Status == "proposed":
		subject, l.lead, l.proposal, l.portalLine = w.proposed, fmt.Sprintf(w.proposedLead, m.brand.Name, title), req.StaffProposal, true
	case req.Kind == "booking":
		l.lead = fmt.Sprintf(w.bookingDeclined, m.brand.Name, title)
		cal = e.dress(&ical.Calendar{Method: ical.Cancel, Stamp: e.s.now(), Events: []ical.Event{e.s.VEvent(m.event, o)}}, m)
	default:
		l.lead = fmt.Sprintf(w.declinedLead, m.brand.Name, title)
	}
	return e.send(ctx, m, subject+": "+title, l, cal)
}

// send words the letter in the email's language and sends it with the calendar (if any) as an alternative part and
// as invite.ics.
func (e *Emails) send(ctx context.Context, m mailCtx, subject string, l letter, cal *ical.Calendar) error {
	if e.mail == nil {
		return nil
	}
	var method ical.Method
	if cal != nil {
		method = cal.Method
	}
	text, body := compose(m, l, method)
	kind, _, _ := strings.Cut(subject, ": ") // every subject is "<kind>: <title>"; the kind is the eyebrow
	msg := mail.Message{Workspace: m.ws.ID, To: m.to, Subject: subject, Eyebrow: kind, Text: text, HTML: body, Language: m.lang, Members: m.members}
	if method == ical.Cancel || kind == wordsOf(m.lang).declined {
		msg.Tone = mail.Negative
	}
	if !m.members {
		msg.ReplyTo = m.hostMail
	}
	if cal != nil {
		ics := cal.Bytes()
		msg.Calendar, msg.CalendarMethod = ics, string(cal.Method)
		msg.Attachments = []mail.Attachment{{Name: "invite.ics", ContentType: "application/ics", Data: ics}}
	}
	return e.mail.Send(ctx, msg)
}

// listed sessions are named one by one; a series of more is summed up ("Every Tuesday, … · 57 sessions") with the
// next ones.
const listed = 3

// compose is the letter on the shared blocks: greeting, lead, the session's card, the calls to join and to open the
// portal, the business's note and the calendar line. method is the attached .ics's ("" for none).
func compose(m mailCtx, l letter, method ical.Method) (text, body string) {
	w := wordsOf(m.lang)
	sessions := slices.SortedFunc(slices.Values(l.sessions), func(a, b store.SchedOccurrence) int { return a.StartsAt.Compare(b.StartsAt) })
	rows := append([]mail.Row{{Label: w.session, Value: l.title}}, whenRows(m, w, sessions)...)
	if l.proposal != nil {
		rows = append(rows, mail.Row{Label: w.newTime, Value: formatWhen(m.lang, *l.proposal, l.proposal.Add(duration(m.event)), m.zone, m.ws.Location())})
	}
	switch {
	case l.where != "":
		rows = append(rows, mail.Row{Label: w.where, Value: l.where, Link: mapsLink(l.where), LinkText: w.maps})
	case l.join != "":
		rows = append(rows, mail.Row{Label: w.where, Value: "Online"})
	}
	rows = append(rows, mail.Row{Label: w.host, Value: m.host}, mail.Row{Label: w.price, Value: price(m.event)}, mail.Row{Label: w.reason, Value: l.reason})
	lt := mail.NewLetter(m.lang)
	if m.greet != "" {
		lt.Greeting(m.greet)
	}
	lt.Lead(l.lead)
	if m.lang == "en" {
		switch {
		case m.members:
			lt.Lead("Check the time and meeting details below before the session begins.")
		case l.join != "":
			lt.Lead("When it’s time for your session, use the meeting link below to join.")
		case method == ical.Request:
			lt.Lead("Check the date, time and any notes below so you know what to expect.")
		}
	}
	lt.Summary(rows...).Note(l.note)
	if l.portalLine {
		lt.Lead(w.answerInPortal)
	}
	if l.join == "" {
		lt.Action(w.open, m.portal)
	} else {
		lt.Action(w.join, l.join).Link(w.open, m.portal)
	}
	switch method {
	case ical.Request:
		lt.FinePrint(w.calendarAdd)
	case ical.Cancel:
		lt.FinePrint(w.calendarRemove)
	}
	return lt.Text(), lt.HTML()
}

// whenRows say when: up to listed sessions one by one; a longer series as its rhythm, first date and count, and the
// next sessions.
func whenRows(m mailCtx, w words, sessions []store.SchedOccurrence) []mail.Row {
	rule := ruleOf(m.event)
	if len(sessions) <= listed || rule == nil {
		var when []string
		for i, o := range sessions {
			if i == listed {
				when = append(when, fmt.Sprintf(w.more, len(sessions)-listed))
				break
			}
			when = append(when, formatWhen(m.lang, o.StartsAt, o.EndsAt, m.zone, m.ws.Location()))
		}
		return []mail.Row{{Label: w.when, Value: strings.Join(when, "\n")}}
	}
	first := sessions[0]
	start := first.StartsAt.In(m.zone)
	series := formatTimes(m.lang, first.StartsAt, first.EndsAt, m.zone, m.ws.Location())
	if c := cadence(w, *rule, start.Weekday()); c != "" {
		series = c + ", " + series
	}
	series += " · " + fmt.Sprintf(w.from, fmt.Sprintf(w.day, start.Day(), w.months[start.Month()-1], start.Year())) +
		" · " + fmt.Sprintf(w.count, len(sessions))
	next := make([]string, listed)
	for i, o := range sessions[:listed] {
		t := o.StartsAt.In(m.zone)
		next[i] = fmt.Sprintf(w.short, w.days[t.Weekday()], t.Day(), w.months[t.Month()-1])
	}
	return []mail.Row{{Label: w.when, Value: series}, {Label: w.next, Value: strings.Join(next, " · ")}}
}

// cadence is a rule's rhythm in words ("Every Tuesday", "Every 2 weeks on Monday, Thursday", "Monthly").
func cadence(w words, r recur.Rule, firstDay time.Weekday) string {
	switch r.Freq {
	case recur.Weekly:
		days := r.ByDay
		if len(days) == 0 {
			days = []time.Weekday{firstDay}
		}
		names := make([]string, len(days))
		for i, d := range days {
			names[i] = w.weekdays[d]
		}
		if r.Interval > 1 {
			return fmt.Sprintf(w.everyWeeks, r.Interval, strings.Join(names, ", "))
		}
		return fmt.Sprintf(w.everyWeek, strings.Join(names, ", "))
	case recur.Monthly:
		if r.Interval > 1 {
			return fmt.Sprintf(w.everyMonths, r.Interval)
		}
		return w.monthly
	}
	return ""
}

// price is a session's own price, as on the invoice; empty without one.
func price(e store.SchedEvent) string {
	if e.UnitPrice == nil {
		return ""
	}
	return strings.TrimSpace(deref(e.Currency) + " " + e.UnitPrice.Swiss("'"))
}

// notifyHost tells the session's host (owners and admins when it has none, or they left) what the client did.
func (e *Emails) notifyHost(ctx context.Context, c Change) error {
	return e.s.db.Tx(ctx, func(q store.Q) error {
		event := map[string]string{ChangeInvited: "scheduling.booked", ChangeCancelled: "scheduling.cancelled_by_client"}[c.Kind]
		occurrenceID := ""
		if len(c.OccurrenceIDs) > 0 {
			occurrenceID = c.OccurrenceIDs[0]
		}
		extra := map[string]any{}
		if c.RequestID != "" {
			req, err := q.SchedRequest(ctx, c.WorkspaceID, c.RequestID, false)
			if err != nil {
				return err
			}
			occurrenceID = req.OccurrenceID
			if c.Kind == ChangeRequested {
				event = requestEvents[req.Kind+"/"+req.Status]
				extra["answer"], extra["late"] = req.Status, req.Late
			}
		}
		if event == "" || occurrenceID == "" {
			return nil // a withdrawn request tells nobody
		}
		o, err := q.SchedOccurrence(ctx, c.WorkspaceID, occurrenceID, false)
		if err != nil {
			return err
		}
		ev, err := q.SchedEvent(ctx, c.WorkspaceID, o.EventID, false)
		if err != nil {
			return err
		}
		ws, err := q.AdmissionWorkspace(ctx, c.WorkspaceID)
		if err != nil {
			return err
		}
		clients, err := q.SchedClients(ctx, c.WorkspaceID, []string{o.ClientID})
		if err != nil {
			return err
		}
		to := store.NotifyTo{Roles: notifications.Managers}
		if o.HostUserID != nil {
			members, err := q.SchedMembers(ctx, c.WorkspaceID)
			if err != nil {
				return err
			}
			if _, ok := members[*o.HostUserID]; ok {
				to = store.NotifyTo{UserIDs: []string{*o.HostUserID}}
			}
		}
		data := map[string]any{"occurrence_id": o.ID, "title": sessionTitle(ev, o), "client_id": o.ClientID,
			"client_name": clients[o.ClientID].Name, "starts_at": o.StartsAt.UTC().Format(time.RFC3339),
			"when": formatWhen("en", o.StartsAt, o.EndsAt, ws.Location(), ws.Location())}
		for k, v := range extra {
			data[k] = v
		}
		return notifications.Notify(ctx, q, c.WorkspaceID, event, data, to, e.s.now())
	})
}

// requestEvents: a client's request (kind/status) as the host's notification.
var requestEvents = map[string]string{
	"booking/pending": "scheduling.booking_requested", "cancel/pending": "scheduling.cancel_requested",
	"reschedule/pending": "scheduling.reschedule_requested",
	"booking/accepted":   "scheduling.proposal_answered", "booking/declined": "scheduling.proposal_answered",
	"reschedule/accepted": "scheduling.proposal_answered", "reschedule/declined": "scheduling.proposal_answered",
	"cancel/accepted": "scheduling.proposal_answered", "cancel/declined": "scheduling.proposal_answered",
}

// language is the email's language: the client's, else the business's documents', else English.
func language(choices ...string) string {
	for _, l := range choices {
		if l = strings.ToLower(strings.TrimSpace(l)); len(l) >= 2 {
			if _, ok := allWords[l[:2]]; ok {
				return l[:2]
			}
		}
	}
	return "en"
}

// formatWhen is a session's date and time in zone ("Tue, 1 Dec 2026, 09:00–10:00 (Zurich time)"), the business's
// time added when the zones differ.
func formatWhen(lang string, start, end time.Time, zone, business *time.Location) string {
	w := wordsOf(lang)
	s := start.In(zone)
	return fmt.Sprintf(w.date, w.days[s.Weekday()], s.Day(), w.months[s.Month()-1], s.Year()) + ", " + formatTimes(lang, start, end, zone, business)
}

// formatTimes is a session's times in zone, its zone named, and in the business's zone when they differ.
func formatTimes(lang string, start, end time.Time, zone, business *time.Location) string {
	at := func(z *time.Location) string {
		return start.In(z).Format("15:04") + "–" + end.In(z).Format("15:04") + " (" + zoneName(lang, z) + ")"
	}
	if business.String() != zone.String() {
		return at(zone) + " · " + at(business)
	}
	return at(zone)
}

// zoneName names a zone by its city ("Zurich time"); UTC and the like stay as they are.
func zoneName(lang string, z *time.Location) string {
	name := z.String()
	i := strings.LastIndex(name, "/")
	if i < 0 {
		return name
	}
	return fmt.Sprintf(wordsOf(lang).zone, strings.ReplaceAll(name[i+1:], "_", " "))
}

// words is one language's wording of the scheduling emails; %s are filled in the order the comments name them.
type words struct {
	invitation, update, cancellation, reminder, declined, proposed string // subjects, before ": <title>"
	invited, updated, cancelled                                    string // company, title
	reminded                                                       string // title, company
	hostReminded                                                   string // title, client
	declinedLead, bookingDeclined, proposedLead                    string // company, title
	when, newTime, where, join, note, reason, open, answerInPortal string
	session, host, price, maps, next, calendarAdd, calendarRemove  string
	more, count                                                    string // %d further sessions; %d sessions
	from                                                           string // the first date
	zone                                                           string // the zone's city
	everyWeek, monthly                                             string // weekday names; -
	everyWeeks                                                     string // interval, weekday names
	everyMonths                                                    string // interval
	date                                                           string // weekday, day, month, year
	day                                                            string // day, month, year
	short                                                          string // weekday, day, month
	days                                                           [7]string
	weekdays                                                       [7]string // in full
	months                                                         [12]string
}

func wordsOf(lang string) words {
	if w, ok := allWords[lang]; ok {
		return w
	}
	return allWords["en"]
}

var allWords = map[string]words{
	"en": {
		session: "Session", host: "Host", price: "Price", maps: "Open in Maps", next: "Next",
		calendarAdd: "Add to your calendar: the invitation is attached.", calendarRemove: "The attached cancellation removes it from your calendar.",
		count: "%d sessions", from: "from %s", zone: "%s time", everyWeek: "Every %s", monthly: "Monthly", everyWeeks: "Every %d weeks on %s",
		everyMonths: "Every %d months", day: "%d %s %d", short: "%s %d %s",
		weekdays:   [7]string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"},
		invitation: "Invitation", update: "Updated", cancellation: "Cancelled", reminder: "Reminder", declined: "Request declined",
		proposed: "New time proposed",
		invited:  "%s invites you to %s.", updated: "%s changed %s.", cancelled: "%s cancelled %s.",
		reminded: "A reminder of your session %s with %s.", hostReminded: "Your session %s with %s starts soon.",
		declinedLead: "%s declined your request about %s.", bookingDeclined: "%s could not confirm your booking of %s.",
		proposedLead: "%s proposes another time for %s.",
		when:         "When", newTime: "Proposed time", where: "Where", join: "Join online", note: "Note", reason: "Reason",
		open: "View your sessions", answerInPortal: "Accept or decline it in the client portal.", more: "and %d more sessions",
		date:   "%s, %d %s %d",
		days:   [7]string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"},
		months: [12]string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"},
	},
	"de": {
		session: "Termin", host: "Leitung", price: "Preis", maps: "In Karten öffnen", next: "Nächste",
		calendarAdd: "Für Ihren Kalender: Die Einladung ist angehängt.", calendarRemove: "Die angehängte Absage entfernt ihn aus Ihrem Kalender.",
		count: "%d Termine", from: "ab %s", zone: "Zeitzone %s", everyWeek: "Jeden %s", monthly: "Monatlich", everyWeeks: "Alle %d Wochen am %s",
		everyMonths: "Alle %d Monate", day: "%d. %s %d", short: "%s %d. %s",
		weekdays:   [7]string{"Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"},
		invitation: "Einladung", update: "Geändert", cancellation: "Abgesagt", reminder: "Erinnerung", declined: "Anfrage abgelehnt",
		proposed: "Neuer Termin vorgeschlagen",
		invited:  "%s lädt Sie zu %s ein.", updated: "%s hat %s geändert.", cancelled: "%s hat %s abgesagt.",
		reminded: "Eine Erinnerung an Ihren Termin %s mit %s.", hostReminded: "Ihr Termin %s mit %s beginnt bald.",
		declinedLead: "%s hat Ihre Anfrage zu %s abgelehnt.", bookingDeclined: "%s konnte Ihre Buchung von %s nicht bestätigen.",
		proposedLead: "%s schlägt einen anderen Termin für %s vor.",
		when:         "Wann", newTime: "Vorgeschlagener Termin", where: "Wo", join: "Online teilnehmen", note: "Hinweis", reason: "Grund",
		open: "Ihre Termine ansehen", answerInPortal: "Nehmen Sie ihn im Kundenportal an oder lehnen Sie ihn ab.", more: "und %d weitere Termine",
		date:   "%s, %d. %s %d",
		days:   [7]string{"So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"},
		months: [12]string{"Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."},
	},
	"fr": {
		session: "Rendez-vous", host: "Animé par", price: "Prix", maps: "Ouvrir dans Plans", next: "Prochains",
		calendarAdd: "Pour votre agenda : l’invitation est jointe.", calendarRemove: "L’annulation jointe le retire de votre agenda.",
		count: "%d rendez-vous", from: "à partir du %s", zone: "heure de %s", everyWeek: "Chaque %s", monthly: "Chaque mois",
		everyWeeks: "Toutes les %d semaines le %s", everyMonths: "Tous les %d mois", day: "%d %s %d", short: "%s %d %s",
		weekdays:   [7]string{"dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"},
		invitation: "Invitation", update: "Modifié", cancellation: "Annulé", reminder: "Rappel", declined: "Demande refusée",
		proposed: "Nouvel horaire proposé",
		invited:  "%s vous invite à %s.", updated: "%s a modifié %s.", cancelled: "%s a annulé %s.",
		reminded: "Un rappel de votre rendez-vous %s avec %s.", hostReminded: "Votre rendez-vous %s avec %s commence bientôt.",
		declinedLead: "%s a refusé votre demande concernant %s.", bookingDeclined: "%s n’a pas pu confirmer votre réservation de %s.",
		proposedLead: "%s propose un autre horaire pour %s.",
		when:         "Quand", newTime: "Horaire proposé", where: "Où", join: "Rejoindre en ligne", note: "Remarque", reason: "Motif",
		open: "Voir vos rendez-vous", answerInPortal: "Acceptez-le ou refusez-le dans le portail client.", more: "et %d autres rendez-vous",
		date:   "%s %d %s %d",
		days:   [7]string{"dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."},
		months: [12]string{"janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."},
	},
	"it": {
		session: "Appuntamento", host: "Con", price: "Prezzo", maps: "Apri in Mappe", next: "Prossimi",
		calendarAdd: "Per il suo calendario: l’invito è allegato.", calendarRemove: "L’annullamento allegato lo rimuove dal suo calendario.",
		count: "%d appuntamenti", from: "dal %s", zone: "ora di %s", everyWeek: "Ogni %s", monthly: "Ogni mese", everyWeeks: "Ogni %d settimane il %s",
		everyMonths: "Ogni %d mesi", day: "%d %s %d", short: "%s %d %s",
		weekdays:   [7]string{"domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"},
		invitation: "Invito", update: "Modificato", cancellation: "Annullato", reminder: "Promemoria", declined: "Richiesta rifiutata",
		proposed: "Nuovo orario proposto",
		invited:  "%s la invita a %s.", updated: "%s ha modificato %s.", cancelled: "%s ha annullato %s.",
		reminded: "Un promemoria del suo appuntamento %s con %s.", hostReminded: "Il suo appuntamento %s con %s inizia a breve.",
		declinedLead: "%s ha rifiutato la sua richiesta per %s.", bookingDeclined: "%s non ha potuto confermare la sua prenotazione di %s.",
		proposedLead: "%s propone un altro orario per %s.",
		when:         "Quando", newTime: "Orario proposto", where: "Dove", join: "Partecipa online", note: "Nota", reason: "Motivo",
		open: "Vedi i suoi appuntamenti", answerInPortal: "Lo accetti o lo rifiuti nel portale clienti.", more: "e altri %d appuntamenti",
		date:   "%s %d %s %d",
		days:   [7]string{"dom", "lun", "mar", "mer", "gio", "ven", "sab"},
		months: [12]string{"gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"},
	},
}
