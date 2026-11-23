package scheduling

import (
	"context"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/store"
)

// outbox records the emails instead of sending them.
type outbox struct {
	mu   sync.Mutex
	sent []mail.Message
}

func (o *outbox) Send(_ context.Context, m mail.Message) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.sent = append(o.sent, m)
	return nil
}

// take returns the emails sent since the last take.
func (o *outbox) take() []mail.Message {
	o.mu.Lock()
	defer o.mu.Unlock()
	out := o.sent
	o.sent = nil
	return out
}

type portalAt string

func (p portalAt) CanonicalURL(context.Context, store.Workspace) (string, error) {
	return string(p), nil
}

// withEmails turns the service's emails on, as the business "Muster AG" writing German documents.
func (e *env) withEmails() (*outbox, *Emails) {
	box := &outbox{}
	em := NewEmails(e.svc, box, portalAt("https://portal.example.com/w/muster"), func(context.Context, string) (mail.Brand, error) {
		return mail.Brand{Name: "Muster AG", Language: "de", ReplyTo: "office@muster.example"}, nil
	})
	e.svc.SetNotifier(em)
	return box, em
}

func (e *env) clientIn(b *browser, email, lang string) string {
	e.t.Helper()
	id := e.client(b, email)
	if lang != "" {
		if _, err := e.db.Exec(context.Background(), `UPDATE clients SET language = $2 WHERE id = $1`, id, lang); err != nil {
			e.t.Fatal(err)
		}
	}
	return id
}

func one(t *testing.T, box *outbox) mail.Message {
	t.Helper()
	got := box.take()
	if len(got) != 1 {
		t.Fatalf("%d emails, want 1: %+v", len(got), got)
	}
	return got[0]
}

func contains(t *testing.T, what, s string, want ...string) {
	t.Helper()
	for _, w := range want {
		if !strings.Contains(s, w) {
			t.Errorf("%s: no %q in\n%s", what, w, s)
		}
	}
}

func TestInvitationInTheClientsLanguageAndZone(t *testing.T) {
	e := newEnv(t)
	box, _ := e.withEmails()
	b := e.workspace()
	for _, c := range []struct{ lang, subject, lead, date string }{
		{"", "Einladung: Coaching", "Muster AG lädt Sie zu Coaching ein.", "Di, 1. Dez. 2026, 09:00–10:00 (Europe/Zurich)"},
		{"en", "Invitation: Coaching", "Muster AG invites you to Coaching.", "Tue, 1 Dec 2026, 09:00–10:00 (Europe/Zurich)"},
		{"fr", "Invitation: Coaching", "Muster AG vous invite à Coaching.", "mar. 1 déc. 2026, 09:00–10:00 (Europe/Zurich)"},
		{"it", "Invito: Coaching", "Muster AG la invita a Coaching.", "mar 1 dic 2026, 09:00–10:00 (Europe/Zurich)"},
	} {
		client := e.clientIn(b, "anna@mueller.example", c.lang)
		out := e.create(b, map[string]any{"client_id": client, "title": "Coaching", "starts_local": "2026-12-01T09:00", "duration_minutes": 60,
			"mode": "live", "location": "Bahnhofstrasse 1, Zürich", "client_note": "Bring the contract"})
		m := one(t, box)
		if m.Subject != c.subject || m.Workspace != b.workspace || !slices.Equal(m.To, []string{"anna@mueller.example"}) || m.Members {
			t.Fatalf("%q: %+v", c.lang, m)
		}
		contains(t, c.lang+" text", m.Text, c.lead, c.date, "Bahnhofstrasse 1, Zürich", "Bring the contract", "https://portal.example.com/w/muster/sessions")
		contains(t, c.lang+" html", m.HTML, "<p>"+c.lead+"</p>", "https://portal.example.com/w/muster/sessions",
			`<a href="https://maps.google.com/?q=Bahnhofstrasse+1%2C+Z%C3%BCrich">Bahnhofstrasse 1, Zürich</a>`)
		occ := out.Data.Occurrences[0]
		if m.CalendarMethod != "REQUEST" || len(m.Attachments) != 1 || m.Attachments[0].Name != "invite.ics" ||
			string(m.Attachments[0].Data) != string(m.Calendar) {
			t.Fatalf("calendar part and invite.ics: %+v", m.Attachments)
		}
		contains(t, "ics", string(m.Calendar), "METHOD:REQUEST", "UID:"+occ.ID+"@app.example.com", "SEQUENCE:0",
			"DTSTART:20261201T080000Z", `ORGANIZER;CN="Muster AG":mailto:office@muster.example`, "ATTENDEE", "mailto:anna@mueller.example",
			"LOCATION:Bahnhofstrasse 1\\, Zürich")
	}
	// The client's own zone first, the business's added.
	london := e.clientIn(b, "tom@example.com", "en")
	if err := e.st.SetClientTimeZone(context.Background(), b.workspace, london, ptr("Europe/London"), false); err != nil {
		t.Fatal(err)
	}
	e.create(b, map[string]any{"client_id": london, "title": "Call", "starts_local": "2026-12-01T09:00", "duration_minutes": 30})
	contains(t, "zones", one(t, box).Text, "Tue, 1 Dec 2026, 08:00–08:30 (Europe/London) · 09:00–09:30 (Europe/Zurich)")
}

func ptr[T any](v T) *T { return &v }

func TestNoEmailWithoutAddressOrWithNotifyOff(t *testing.T) {
	e := newEnv(t)
	box, _ := e.withEmails()
	b := e.workspace()
	e.create(b, map[string]any{"client_id": e.client(b, ""), "title": "x", "starts_local": "2026-12-01T09:00", "duration_minutes": 60})
	e.create(b, map[string]any{"client_id": e.client(b, "a@example.com"), "title": "x", "starts_local": "2026-12-02T09:00",
		"duration_minutes": 60, "notify": false})
	if got := box.take(); len(got) != 0 {
		t.Fatalf("emails %+v", got)
	}
}

func TestSeriesEmails(t *testing.T) {
	e := newEnv(t)
	box, _ := e.withEmails()
	b := e.workspace()
	c := e.clientIn(b, "anna@mueller.example", "en")
	if err := e.st.ReplaceSchedulingHolidays(context.Background(), b.workspace, []store.SchedHoliday{{Day: "2026-12-08", Name: "Holiday"}}); err != nil {
		t.Fatal(err)
	}
	out := e.create(b, map[string]any{"client_id": c, "title": "Training", "starts_local": "2026-12-01T09:00", "duration_minutes": 60,
		"skip_holidays": true, "recurrence": map[string]any{"freq": "weekly", "count": 4}})
	occs := out.Data.Occurrences
	if len(occs) != 4 {
		t.Fatalf("occurrences %d", len(occs))
	}
	inv := one(t, box)
	ev := out.Data.Event.ID
	// One email for the whole series: its master with the holiday as EXDATE and the COUNT as the last session's UNTIL.
	ics := string(inv.Calendar)
	contains(t, "series invitation", ics, "UID:"+ev+"@app.example.com", "DTSTART;TZID=Europe/Zurich:20261201T090000",
		"RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261229T", "EXDATE;TZID=Europe/Zurich:20261208T090000", "BEGIN:VTIMEZONE")
	if strings.Contains(ics, "COUNT=") || strings.Contains(ics, "RECURRENCE-ID") {
		t.Fatalf("series invitation: %s", ics)
	}
	contains(t, "series text", inv.Text, "Tue, 1 Dec 2026", "Tue, 15 Dec 2026", "Tue, 29 Dec 2026")

	// "this": only that session, by the series' UID and its RECURRENCE-ID, sequence up.
	e.do(b, "PATCH", "/api/v1/scheduling/occurrences/"+occs[1].ID, map[string]any{"scope": "this", "starts_local": "2026-12-15T11:00"},
		http.StatusOK, nil)
	up := one(t, box)
	if up.Subject != "Updated: Training" || up.CalendarMethod != "REQUEST" {
		t.Fatalf("update %+v", up)
	}
	contains(t, "this", string(up.Calendar), "UID:"+ev+"@app.example.com", "RECURRENCE-ID;TZID=Europe/Zurich:20261215T090000",
		"DTSTART;TZID=Europe/Zurich:20261215T110000", "SEQUENCE:1")
	if strings.Contains(string(up.Calendar), "RRULE") {
		t.Fatalf("a change to one session is sent as that VEVENT only: %s", up.Calendar)
	}

	// Cancelling one session cancels that instance; cancelling the rest cancels the series' UID.
	e.do(b, "POST", "/api/v1/scheduling/occurrences/"+occs[0].ID+"/cancel", map[string]any{"scope": "this"}, http.StatusOK, nil)
	cancel := one(t, box)
	if cancel.CalendarMethod != "CANCEL" || cancel.Subject != "Cancelled: Training" {
		t.Fatalf("cancel %+v", cancel)
	}
	contains(t, "cancel one", string(cancel.Calendar), "METHOD:CANCEL", "RECURRENCE-ID;TZID=Europe/Zurich:20261201T090000", "STATUS:CANCELLED")
	e.do(b, "POST", "/api/v1/scheduling/occurrences/"+occs[1].ID+"/cancel", map[string]any{"scope": "following"}, http.StatusOK, nil)
	all := one(t, box)
	contains(t, "cancel all", string(all.Calendar), "METHOD:CANCEL", "UID:"+ev+"@app.example.com", "RRULE:")
	if strings.Contains(string(all.Calendar), "RECURRENCE-ID") {
		t.Fatalf("the whole series is cancelled by its UID: %s", all.Calendar)
	}
}

func TestFollowingSplitEmailsBothSeries(t *testing.T) {
	e := newEnv(t)
	box, _ := e.withEmails()
	b := e.workspace()
	c := e.clientIn(b, "anna@mueller.example", "en")
	out := e.create(b, map[string]any{"client_id": c, "title": "Training", "starts_local": "2026-12-01T09:00", "duration_minutes": 60,
		"recurrence": map[string]any{"freq": "weekly", "until": "2027-01-26"}})
	box.take()
	old := out.Data.Event.ID
	var patched struct{ Data Occurrence }
	e.do(b, "PATCH", "/api/v1/scheduling/occurrences/"+out.Data.Occurrences[2].ID,
		map[string]any{"scope": "following", "starts_local": "2026-12-15T14:00"}, http.StatusOK, &patched)
	got := box.take()
	if len(got) != 2 {
		t.Fatalf("emails %d, want the old series ended and the new one", len(got))
	}
	contains(t, "old series", string(got[0].Calendar), "UID:"+old+"@app.example.com", "UNTIL=20261214", "SEQUENCE:1")
	contains(t, "new series", string(got[1].Calendar), "UID:"+patched.Data.EventID+"@app.example.com",
		"DTSTART;TZID=Europe/Zurich:20261215T140000", "RRULE:FREQ=WEEKLY")
	if patched.Data.EventID == old {
		t.Fatal("the split made no new event")
	}
}

func TestRequestEmailsAndHostNotifications(t *testing.T) {
	e := newEnv(t)
	box, _ := e.withEmails()
	b := e.workspace()
	c := e.clientIn(b, "anna@mueller.example", "en")
	ctx := context.Background()
	ws, err := e.st.AdmissionWorkspace(ctx, b.workspace)
	if err != nil {
		t.Fatal(err)
	}
	// Tomorrow 09:00: inside the 24 h notice, so a cancel request is late and waits.
	out := e.create(b, map[string]any{"client_id": c, "title": "Coaching", "starts_local": "2026-11-17T09:00", "duration_minutes": 60})
	box.take()
	occ := out.Data.Occurrences[0].ID
	req, cancelled, err := e.svc.RequestCancel(ctx, ws, c, occ, "anna@mueller.example", nil)
	if err != nil || cancelled || !req.Late {
		t.Fatalf("late request %+v %v %v", req, cancelled, err)
	}
	if got := box.take(); len(got) != 0 {
		t.Fatalf("the client's own request emails nobody: %+v", got)
	}
	notes := e.notes(b, "scheduling.cancel_requested")
	if len(notes) != 1 || !strings.Contains(string(notes[0].Data), `"late": true`) || !strings.Contains(string(notes[0].Data), `"client_name": "Müller AG"`) {
		t.Fatalf("host notification %+v", notes)
	}
	e.do(b, "POST", "/api/v1/scheduling/requests/"+req.ID+"/decline", map[string]any{"reason": "We need the full notice."}, http.StatusOK, nil)
	m := one(t, box)
	if m.Subject != "Request declined: Coaching" || m.Calendar != nil {
		t.Fatalf("decline %+v", m)
	}
	contains(t, "decline", m.Text, "Muster AG declined your request about Coaching.", "We need the full notice.")

	resched, err := e.svc.RequestReschedule(ctx, ws, c, occ, "", []time.Time{mustTime("2026-11-20T08:00:00Z")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	e.do(b, "POST", "/api/v1/scheduling/requests/"+resched.ID+"/propose", map[string]any{"starts_at": "2026-11-23T08:00:00Z"}, http.StatusOK, nil)
	m = one(t, box)
	contains(t, "proposal", m.Text, "Muster AG proposes another time for Coaching.", "Mon, 23 Nov 2026, 09:00–10:00", "client portal")
	if _, err := e.svc.Answer(ctx, ws, c, resched.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	if up := one(t, box); up.CalendarMethod != "REQUEST" || !strings.Contains(string(up.Calendar), "SEQUENCE:1") {
		t.Fatalf("accepted proposal: update %+v", up)
	}
	if n := e.notes(b, "scheduling.proposal_answered"); len(n) != 1 || !strings.Contains(string(n[0].Data), `"answer": "accepted"`) {
		t.Fatalf("proposal answered %+v", n)
	}

	// An on-time cancellation, approved at once: the client gets the cancellation, the host hears of it.
	later := e.create(b, map[string]any{"client_id": c, "title": "Later", "starts_local": "2026-12-10T09:00", "duration_minutes": 60})
	box.take()
	if _, cancelled, err := e.svc.RequestCancel(ctx, ws, c, later.Data.Occurrences[0].ID, "", nil); err != nil || !cancelled {
		t.Fatalf("on time %v %v", cancelled, err)
	}
	if m := one(t, box); m.CalendarMethod != "CANCEL" {
		t.Fatalf("cancellation %+v", m)
	}
	if n := e.notes(b, "scheduling.cancelled_by_client"); len(n) != 1 {
		t.Fatalf("cancelled by client %+v", n)
	}
}

func (e *env) notes(b *browser, event string) []store.Notification {
	e.t.Helper()
	got, err := e.st.Notifications(context.Background(), b.workspace, b.user, store.NotificationFilter{Limit: 50, Events: []string{event}})
	if err != nil {
		e.t.Fatal(err)
	}
	return got
}

func TestReminders(t *testing.T) {
	e := newEnv(t)
	box, em := e.withEmails()
	b := e.workspace()
	ctx := context.Background()
	set := store.DefaultSchedSettings()
	set.HostReminders = []int{30}
	if err := e.st.SaveSchedulingSettings(ctx, b.workspace, set, b.user, fixedNow); err != nil {
		t.Fatal(err)
	}
	c := e.clientIn(b, "anna@mueller.example", "en")
	// Wednesday 18 Nov, 09:00 and 12:00 Zurich (08:00 and 11:00 UTC); made on Monday, before any reminder is due.
	e.create(b, map[string]any{"client_id": c, "title": "Coaching", "starts_local": "2026-11-18T09:00", "duration_minutes": 60})
	moved := e.create(b, map[string]any{"client_id": c, "title": "Moved", "starts_local": "2026-11-18T12:00", "duration_minutes": 60})
	box.take()

	e.at(mustTime("2026-11-17T11:05:00Z")) // both 24 h reminders are due
	// Moved to 11:00 Zurich: its 24 h reminder for the new time was due before the move, so it never goes out.
	e.do(b, "PATCH", "/api/v1/scheduling/occurrences/"+moved.Data.Occurrences[0].ID,
		map[string]any{"starts_local": "2026-11-18T11:00", "notify": false}, http.StatusOK, nil)
	// two instances at once: each reminder goes out once
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() { em.RemindersTick(ctx) })
	}
	wg.Wait()
	m := one(t, box)
	if m.Subject != "Reminder: Coaching" || m.Calendar != nil || m.Members || !slices.Equal(m.To, []string{"anna@mueller.example"}) {
		t.Fatalf("client reminder %+v", m)
	}
	contains(t, "reminder", m.Text, "A reminder of your session Coaching with Muster AG.", "Wed, 18 Nov 2026, 09:00–10:00")
	em.RemindersTick(ctx)
	if got := box.take(); len(got) != 0 {
		t.Fatalf("sent again: %+v", got)
	}

	e.at(mustTime("2026-11-18T07:30:00Z")) // Coaching: the client's 1 h and the host's 30 min reminders
	em.RemindersTick(ctx)
	got := box.take()
	if len(got) != 2 {
		t.Fatalf("reminders %+v", got)
	}
	slices.SortFunc(got, func(a, b mail.Message) int { return strings.Compare(a.Subject, b.Subject) })
	// the host's: a member email in the business's language, with the internal notes and no portal link
	if got[0].Subject != "Erinnerung: Coaching" || !got[0].Members || len(got[0].To) != 1 || strings.Contains(got[0].Text, "portal") {
		t.Fatalf("host reminder %+v", got[0])
	}
	contains(t, "host reminder", got[0].Text, "Ihr Termin Coaching mit Müller AG beginnt bald.")
	if got[1].Subject != "Reminder: Coaching" || got[1].Members {
		t.Fatalf("client 1 h reminder %+v", got[1])
	}

	e.at(mustTime("2026-11-18T09:05:00Z")) // Moved (10:00 UTC): its 1 h reminder, due after the move
	em.RemindersTick(ctx)
	if m := one(t, box); m.Subject != "Reminder: Moved" {
		t.Fatalf("moved reminder %+v", m)
	}
}

func TestMaterialiseExtendsSeriesOnce(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	out := e.create(b, map[string]any{"client_id": c, "title": "Weekly", "starts_local": "2026-11-17T09:00", "duration_minutes": 60,
		"recurrence": map[string]any{"freq": "weekly"}})
	count := func() int {
		var n int
		if err := e.db.QueryRow(context.Background(), `SELECT count(*) FROM scheduling_occurrences WHERE event_id = $1`,
			out.Data.Event.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := count()
	e.svc.MaterialiseTick(context.Background())
	if count() != before {
		t.Fatal("extended before it was a day short of the horizon")
	}
	e.at(fixedNow.AddDate(0, 0, 15))
	e.svc.MaterialiseTick(context.Background())
	after := count()
	if after != before+2 {
		t.Fatalf("after 15 days %d sessions, want %d", after, before+2)
	}
	e.svc.MaterialiseTick(context.Background())
	if count() != after {
		t.Fatal("materialising twice added sessions")
	}
}

func TestAutoAttendAndExpireRequests(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	ctx := context.Background()
	set := store.DefaultSchedSettings()
	set.AutoAttendedAfterHours = ptr(2)
	if err := e.st.SaveSchedulingSettings(ctx, b.workspace, set, b.user, fixedNow); err != nil {
		t.Fatal(err)
	}
	c := e.client(b, "")
	done := e.create(b, map[string]any{"client_id": c, "title": "Done", "starts_local": "2026-11-16T12:00", "duration_minutes": 60})
	asked := e.create(b, map[string]any{"client_id": c, "title": "Asked", "starts_local": "2026-11-16T13:00", "duration_minutes": 60})
	ws, err := e.st.AdmissionWorkspace(ctx, b.workspace)
	if err != nil {
		t.Fatal(err)
	}
	req, _, err := e.svc.RequestCancel(ctx, ws, c, asked.Data.Occurrences[0].ID, "", nil)
	if err != nil {
		t.Fatal(err)
	}

	e.at(mustTime("2026-11-16T13:30:00Z")) // Done ended 1.5 h ago, Asked has started
	e.svc.AutoAttendTick(ctx)
	e.svc.ExpireRequestsTick(ctx)
	if got := e.occurrence(b, done.Data.Occurrences[0].ID); got.Status != "scheduled" {
		t.Fatalf("marked before the hours passed: %s", got.Status)
	}
	if r, err := e.st.SchedRequest(ctx, b.workspace, req.ID, false); err != nil || r.Status != "expired" {
		t.Fatalf("request %+v %v", r, err)
	}

	e.at(mustTime("2026-11-16T14:00:00Z"))
	e.svc.AutoAttendTick(ctx)
	if got := e.occurrence(b, done.Data.Occurrences[0].ID); got.Status != "attended" || !got.Counts {
		t.Fatalf("auto attended: %+v", got)
	}
	var audits int
	if err := e.db.QueryRow(ctx, `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'scheduling.attendance_changed'`,
		b.workspace).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 1 {
		t.Fatalf("audit events %d", audits)
	}
}

func TestJobsPauseWithoutTheFeature(t *testing.T) {
	e := newEnv(t)
	box, em := e.withEmails()
	b := e.workspace()
	ctx := context.Background()
	set := store.DefaultSchedSettings()
	set.AutoAttendedAfterHours = ptr(1)
	if err := e.st.SaveSchedulingSettings(ctx, b.workspace, set, b.user, fixedNow); err != nil {
		t.Fatal(err)
	}
	c := e.clientIn(b, "anna@mueller.example", "en")
	out := e.create(b, map[string]any{"client_id": c, "title": "Coaching", "starts_local": "2026-11-17T09:00", "duration_minutes": 60})
	box.take()
	e.st.SetFeatureGate(func(context.Context, store.Q, string, string) error { return store.ErrFeatureDenied })
	e.at(mustTime("2026-11-17T07:30:00Z"))
	em.RemindersTick(ctx)
	e.at(mustTime("2026-11-17T12:00:00Z"))
	e.svc.AutoAttendTick(ctx)
	if got := box.take(); len(got) != 0 {
		t.Fatalf("reminders after a downgrade: %+v", got)
	}
	o, err := e.st.SchedOccurrence(ctx, b.workspace, out.Data.Occurrences[0].ID, false)
	if err != nil || o.Status != store.SchedScheduled {
		t.Fatalf("auto attended after a downgrade: %+v %v", o, err)
	}
}
