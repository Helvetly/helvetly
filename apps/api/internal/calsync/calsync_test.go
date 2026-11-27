package calsync

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
)

func TestSealer(t *testing.T) {
	s := newSealer(bytes.Repeat([]byte{1}, 32))
	sealed, err := s.seal("wsp_a", "cal_1", "refresh", "secret-token")
	if err != nil || bytes.Contains(sealed, []byte("secret-token")) {
		t.Fatalf("sealed %q %v", sealed, err)
	}
	if got, err := s.open("wsp_a", "cal_1", "refresh", sealed); err != nil || got != "secret-token" {
		t.Fatalf("open %q %v", got, err)
	}
	for _, tc := range []struct{ ws, rec, field string }{{"wsp_b", "cal_1", "refresh"}, {"wsp_a", "cal_2", "refresh"}, {"wsp_a", "cal_1", "access"}} {
		if _, err := s.open(tc.ws, tc.rec, tc.field, sealed); err == nil {
			t.Fatalf("opened as %v", tc)
		}
	}
	if _, err := (sealer{}).seal("w", "r", "f", "x"); !errors.Is(err, errNoKey) {
		t.Fatalf("no key: %v", err)
	}
	if _, err := s.open("wsp_a", "cal_1", "refresh", []byte{1}); err == nil {
		t.Fatal("short value opened")
	}
}

func TestBackoff(t *testing.T) {
	for attempts, want := range map[int]time.Duration{0: 30 * time.Second, 1: time.Minute, 3: 4 * time.Minute, 7: time.Hour, 50: time.Hour} {
		if got := backoff(attempts); got != want {
			t.Errorf("backoff(%d) = %v, want %v", attempts, got, want)
		}
	}
}

func TestScopes(t *testing.T) {
	g, m := newGoogle("g", "s", "", "", ""), newMicrosoft("m", "s", "common", "", "", "")
	for _, tc := range []struct {
		p       provider
		granted []string
		ok      bool
	}{
		{g, []string{"openid", scopeEvents, scopeCalList}, true},
		{g, []string{"openid", scopeEvents}, false},
		{m, []string{"https://graph.microsoft.com/Calendars.ReadWrite", "User.Read"}, true},
		{m, []string{"calendars.readwrite"}, true},
		{m, []string{"Calendars.Read"}, false},
	} {
		if got := tc.p.scopesOK(tc.granted); got != tc.ok {
			t.Errorf("%s %v: %v", tc.p.name(), tc.granted, got)
		}
	}
}

func TestConfiguredProviders(t *testing.T) {
	e := newEnvWith(t, func(c *config.Config) { c.Calendars.MicrosoftClientID, c.Calendars.MicrosoftSecret = "", "" })
	b := e.workspace(pro, "member")
	status, out := e.do(b, "GET", "/api/v1/scheduling/calendars", nil)
	if status != 200 || len(out["providers"].([]any)) != 1 || out["providers"].([]any)[0] != "google" || len(out["data"].([]any)) != 0 {
		t.Fatalf("%d %v", status, out)
	}
	if status, _ := e.do(b, "GET", "/api/v1/scheduling/calendars/microsoft/connect", nil); status != 404 {
		t.Fatalf("connect to a provider that is not configured: %d", status)
	}
	if status, _ := e.do(b, "GET", "/api/v1/scheduling/calendars/outlook/connect", nil); status != 404 {
		t.Fatalf("connect to an unknown provider: %d", status)
	}
	if e.svc.webhooks(e.svc.providers["google"]) != true {
		t.Fatal("a public https PUBLIC_URL gets change notifications")
	}
	local := New(e.st, nil, config.Config{PublicURL: "http://localhost:8000", Calendars: config.Calendars{GoogleClientID: "g", GoogleClientSecret: "s"}}, e.svc.log)
	if local.webhooks(local.providers["google"]) || New(e.st, nil, config.Config{}, e.svc.log).Enabled() {
		t.Fatal("a local PUBLIC_URL polls; no settings, no sync")
	}
}

func TestConnectAndPush(t *testing.T) {
	for _, provider := range []string{"google", "microsoft"} {
		t.Run(provider, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace(pro, "member")
			start := e.clock.Add(48 * time.Hour)
			occ := e.session(b, b.userID, start)
			if got := e.connect(b, provider); got != "/settings/scheduling?calendar=connected" {
				t.Fatalf("landed on %q", got)
			}
			c := e.connection(b, provider)
			primary := e.fake.PrimaryCalendar(provider)
			if c.Status != "active" || c.PushCalendarID == nil || *c.PushCalendarID != primary || c.AccountEmail == "" ||
				bytes.Contains(c.AccessToken, []byte("at-")) || bytes.Contains(c.RefreshToken, []byte("rt-")) {
				t.Fatalf("connection %+v", c)
			}
			status, out := e.do(b, "GET", "/api/v1/scheduling/calendars", nil)
			conn := out["data"].([]any)[0].(map[string]any)
			if status != 200 || conn["push_calendar_id"] != primary || len(conn["calendars"].([]any)) != 2 ||
				len(conn["busy_calendar_ids"].([]any)) != 1 || conn["busy_calendar_ids"].([]any)[0] != primary {
				t.Fatalf("%d %v", status, out)
			}
			// Google gives each calendar its colour (normalised to lower case); the fake Microsoft gives none.
			first := conn["calendars"].([]any)[0].(map[string]any)
			if want := map[string]any{"google": "#9fe1e7", "microsoft": nil}[provider]; first["color"] != want {
				t.Fatalf("colour %v, want %v", first["color"], want)
			}
			if strings.Contains(stringOf(out), "at-") || strings.Contains(stringOf(out), "rt-") {
				t.Fatal("tokens answered")
			}
			if e.count(`SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'scheduling.calendar_connected'
				AND payload = '{"provider": "`+provider+`"}'`, b.ws) != 1 {
				t.Fatal("connection not audited")
			}
			// the existing session was queued on connect
			e.svc.PushTick(context.Background())
			events := e.fake.Events(provider, primary)
			if len(events) != 1 || events[0].Summary != "Lesson · Müller AG" || !events[0].Start.Equal(start) || events[0].Location != "Bahnhofstrasse 1" {
				t.Fatalf("pushed %+v", events)
			}
			if provider == "google" && (events[0].Props[propOccurrence] != occ.ID || events[0].Props[propWorkspace] != b.ws) {
				t.Fatalf("private properties %+v", events[0].Props)
			}
			link, err := e.st.CalendarLink(context.Background(), c.ID, occ.ID)
			if err != nil || link.ExternalID != externalID(primary, events[0].ID) || e.queued(c.ID) != 0 {
				t.Fatalf("link %+v %v, queued %d", link, err, e.queued(c.ID))
			}
			// moved in Helvetly: the same external event follows
			later := start.Add(3 * time.Hour)
			occ = e.change(occ, func(o *store.SchedOccurrence) {
				o.StartsAt, o.EndsAt, o.Status = later, later.Add(time.Hour), "rescheduled"
			})
			e.svc.PushTick(context.Background())
			if got := e.fake.Events(provider, primary); len(got) != 1 || got[0].ID != events[0].ID || !got[0].Start.Equal(later) {
				t.Fatalf("after the move %+v", got)
			}
			// another push calendar: the event moves there
			status, _ = e.do(b, "PATCH", "/api/v1/scheduling/calendars/"+c.ID, map[string]any{"push_calendar_id": "AAMk-work"})
			if provider == "google" {
				status, _ = e.do(b, "PATCH", "/api/v1/scheduling/calendars/"+c.ID, map[string]any{"push_calendar_id": "work@group.calendar.google.test"})
			}
			if status != 200 {
				t.Fatalf("push calendar change: %d", status)
			}
			e.svc.PushTick(context.Background())
			work := map[string]string{"google": "work@group.calendar.google.test", "microsoft": "AAMk-work"}[provider]
			if len(e.fake.Events(provider, primary)) != 0 || len(e.fake.Events(provider, work)) != 1 {
				t.Fatalf("not moved to the new calendar: %+v %+v", e.fake.Events(provider, primary), e.fake.Events(provider, work))
			}
			// cancelled: removed outside, link gone
			e.change(occ, func(o *store.SchedOccurrence) { o.Status = "cancelled_on_time" })
			e.svc.PushTick(context.Background())
			if len(e.fake.Events(provider, work)) != 0 {
				t.Fatal("a cancelled session stays in the calendar")
			}
			if _, err := e.st.CalendarLink(context.Background(), c.ID, occ.ID); !errors.Is(err, store.ErrNotFound) {
				t.Fatalf("link of a removed event: %v", err)
			}
		})
	}
}

func stringOf(v any) string {
	var b strings.Builder
	switch x := v.(type) {
	case map[string]any:
		for k, y := range x {
			b.WriteString(k + "=" + stringOf(y) + ";")
		}
	case []any:
		for _, y := range x {
			b.WriteString(stringOf(y) + ",")
		}
	case string:
		b.WriteString(x)
	}
	return b.String()
}

func TestOtherHostsSessionsAreNotPushed(t *testing.T) {
	e := newEnv(t)
	b := e.workspace(pro, "member")
	other := e.member(b.ws, "member")
	e.connect(b, "google")
	occ := e.session(b, other.userID, e.clock.Add(24*time.Hour))
	c := e.connection(b, "google")
	if err := e.st.Tx(context.Background(), func(q store.Q) error { return e.svc.Enqueue(context.Background(), q, b.ws, []string{occ.ID}) }); err != nil {
		t.Fatal(err)
	}
	if e.queued(c.ID) != 0 {
		t.Fatal("another host's session queued to this calendar")
	}
	// the host changes to the connected member: pushed; back to the other: removed again
	occ = e.change(occ, func(o *store.SchedOccurrence) { o.HostUserID = &b.userID })
	e.svc.PushTick(context.Background())
	primary := e.fake.PrimaryCalendar("google")
	if len(e.fake.Events("google", primary)) != 1 {
		t.Fatal("the new host's session not pushed")
	}
	e.change(occ, func(o *store.SchedOccurrence) { o.HostUserID = &other.userID })
	e.svc.PushTick(context.Background())
	if len(e.fake.Events("google", primary)) != 0 {
		t.Fatal("the session stays in the former host's calendar")
	}
}

func TestConnectRefused(t *testing.T) {
	t.Run("cancelled at the provider", func(t *testing.T) {
		e := newEnv(t)
		b := e.workspace(pro, "member")
		e.request(b, "GET", e.srv.URL+"/api/v1/scheduling/calendars/google/connect", nil).Body.Close()
		if got := e.land(b, e.srv.URL+"/api/v1/scheduling/calendars/google/callback?error=access_denied"); got != "/settings/scheduling?calendar_error=cancelled" {
			t.Fatal(got)
		}
	})
	t.Run("scopes missing", func(t *testing.T) {
		e := newEnv(t)
		b := e.workspace(pro, "member")
		e.fake.Account("google", FakeAccount{Subject: "g-1", Email: "a@gmail.test", Scope: "openid email " + scopeEvents})
		if got := e.connect(b, "google"); got != "/settings/scheduling?calendar_error=scopes_missing" {
			t.Fatal(got)
		}
		if list, _ := e.st.CalendarConnections(context.Background(), b.ws, b.userID); len(list) != 0 {
			t.Fatal("half-connected")
		}
	})
	t.Run("no state cookie or another session", func(t *testing.T) {
		e := newEnv(t)
		b := e.workspace(pro, "member")
		other := e.member(b.ws, "member")
		res := e.request(b, "GET", e.srv.URL+"/api/v1/scheduling/calendars/google/connect", nil)
		res.Body.Close()
		consent := e.request(b, "GET", res.Header.Get("Location"), nil)
		consent.Body.Close()
		callback := strings.Replace(consent.Header.Get("Location"), publicURL, e.srv.URL, 1)
		// another person's browser with the first one's state cookie copied over
		for _, c := range b.c.Jar.Cookies(mustURL(e.srv.URL + statePath + "/google/callback")) {
			if c.Name == stateCookie {
				other.c.Jar.SetCookies(mustURL(e.srv.URL+statePath), []*http.Cookie{{Name: c.Name, Value: c.Value, Path: statePath}})
			}
		}
		if got := e.land(other, callback); got != "/settings/scheduling?calendar_error=expired" {
			t.Fatalf("another session: %s", got)
		}
		if got := e.land(b, callback+"x"); got != "/settings/scheduling?calendar_error=expired" { // the cookie was spent
			t.Fatalf("replayed: %s", got)
		}
	})
	t.Run("account of another member", func(t *testing.T) {
		e := newEnv(t)
		b := e.workspace(pro, "member")
		other := e.member(b.ws, "member")
		e.connect(b, "google")
		if got := e.connect(other, "google"); got != "/settings/scheduling?calendar_error=account_in_use" {
			t.Fatal(got)
		}
		e.fake.Account("google", FakeAccount{Subject: "g-200", Email: "second@gmail.test"})
		if got := e.connect(b, "google"); got != "/settings/scheduling?calendar_error=already_connected" {
			t.Fatal(got)
		}
	})
	t.Run("plan without scheduling", func(t *testing.T) {
		e := newEnv(t)
		b := e.workspace(billing.Basic, "member")
		billingtest.Without(t, e.st, b.ws, store.FeatureScheduling)
		if status, out := e.do(b, "GET", "/api/v1/scheduling/calendars/google/connect", nil); status != http.StatusForbidden {
			t.Fatalf("%d %v", status, out)
		}
		if status, _ := e.do(b, "POST", "/api/v1/scheduling/feed", nil); status != http.StatusForbidden {
			t.Fatalf("feed on Basic: %d", status)
		}
	})
	t.Run("Free: scheduling and its feed, no calendar sync", func(t *testing.T) {
		e := newEnv(t)
		b := e.member(auth.NewID("wsp"), "owner") // no paid plan: Free
		status, out := e.do(b, "GET", "/api/v1/scheduling/calendars/google/connect", nil)
		if got, _ := out["error"].(map[string]any); status != http.StatusForbidden || got["code"] != "feature_not_in_plan" {
			t.Fatalf("connect on Free: %d %v", status, out)
		}
		if status, out := e.do(b, "POST", "/api/v1/scheduling/feed", nil); status != http.StatusOK {
			t.Fatalf("feed on Free: %d %v", status, out)
		}
	})
}

func mustURL(s string) *url.URL { u, _ := url.Parse(s); return u }

func TestReconnectAfterRevoked(t *testing.T) {
	e := newEnv(t)
	b := e.workspace(pro, "member")
	e.connect(b, "microsoft")
	c := e.connection(b, "microsoft")
	e.fake.Revoke("microsoft")
	// the access token expired: the refresh is refused
	if _, err := e.raw.Exec(context.Background(), `UPDATE calendar_connections SET access_expires_at = $2 WHERE id = $1`, c.ID, e.clock); err != nil {
		t.Fatal(err)
	}
	occ := e.session(b, b.userID, e.clock.Add(24*time.Hour))
	e.change(occ, func(*store.SchedOccurrence) {})
	e.svc.PushTick(context.Background())
	c = e.connection(b, "microsoft")
	if c.Status != "revoked" || c.RefreshToken != nil || e.notifications(b.userID, "scheduling.calendar_disconnected") != 1 {
		t.Fatalf("revoked %+v, notified %d", c, e.notifications(b.userID, "scheduling.calendar_disconnected"))
	}
	e.clock = e.clock.Add(pushLease) // the failed push's lease ran out
	if got := e.connect(b, "microsoft"); got != "/settings/scheduling?calendar=connected" {
		t.Fatal(got)
	}
	again := e.connection(b, "microsoft")
	if again.ID != c.ID || again.Status != "active" || again.RefreshToken == nil {
		t.Fatalf("reconnected %+v", again)
	}
	e.svc.PushTick(context.Background())
	if len(e.fake.Events("microsoft", e.fake.PrimaryCalendar("microsoft"))) != 1 {
		t.Fatal("not pushed after reconnecting")
	}
}

func TestPushRetries(t *testing.T) {
	e := newEnv(t)
	b := e.workspace(pro, "member")
	e.connect(b, "google")
	c := e.connection(b, "google")
	e.fake.Fail("google", http.StatusInternalServerError)
	e.session(b, b.userID, e.clock.Add(24*time.Hour))
	if err := e.st.Tx(context.Background(), func(q store.Q) error { return e.svc.enqueueAll(context.Background(), q, c) }); err != nil {
		t.Fatal(err)
	}
	e.svc.PushTick(context.Background())
	if e.count(`SELECT count(*) FROM calendar_push_queue WHERE connection_id = $1 AND attempts = 1 AND due_at = $2`, c.ID,
		e.clock.Add(firstRetry)) != 1 {
		t.Fatal("no retry 30 s later")
	}
	e.svc.PushTick(context.Background()) // not due yet
	primary := e.fake.PrimaryCalendar("google")
	if len(e.fake.Events("google", primary)) != 0 {
		t.Fatal("retried before it was due")
	}
	// 429: paused, retried after Retry-After
	e.clock = e.clock.Add(firstRetry)
	e.fake.Fail("google", http.StatusTooManyRequests)
	e.svc.PushTick(context.Background())
	if e.count(`SELECT count(*) FROM calendar_push_queue WHERE connection_id = $1 AND last_error = 'rate limited'`, c.ID) != 1 {
		t.Fatal("429 not kept for later")
	}
	e.svc.providers["google"].(*google).pausedUntil = time.Time{}
	// failing for a day: given up, the connection in error, its member told
	e.fake.Fail("google", 500)
	e.clock = e.clock.Add(25 * time.Hour)
	e.svc.PushTick(context.Background())
	c = e.connection(b, "google")
	if c.Status != "error" || *c.Error != "push_failed" || e.queued(c.ID) != 0 || e.notifications(b.userID, "scheduling.calendar_disconnected") != 1 {
		t.Fatalf("given up: %+v queued %d", c, e.queued(c.ID))
	}
}

func TestImportBusyMovesAndDeletes(t *testing.T) {
	for _, provider := range []string{"google", "microsoft"} {
		t.Run(provider, func(t *testing.T) {
			e := newEnv(t)
			b := e.workspace(pro, "member")
			start := e.clock.Add(48 * time.Hour)
			occ := e.session(b, b.userID, start)
			e.connect(b, provider)
			c := e.connection(b, provider)
			e.svc.PushTick(context.Background())
			primary := e.fake.PrimaryCalendar(provider)
			busy := e.fake.AddEvent(provider, primary, start.Add(-3*time.Hour), start.Add(-2*time.Hour), false)
			e.fake.AddEvent(provider, primary, start.Add(5*time.Hour), start.Add(6*time.Hour), true) // free: not busy
			e.fake.AddEvent(provider, "AAMk-work", start, start.Add(time.Hour), false)               // not imported
			e.svc.ImportTick(context.Background())
			blocks, err := e.svc.Busy(context.Background(), e.st.Q, b.ws, []string{b.userID}, e.clock, e.clock.Add(horizon))
			if err != nil || len(blocks) != 1 || !blocks[0].Start.Equal(start.Add(-3*time.Hour)) {
				t.Fatalf("busy %+v %v", blocks, err)
			}
			if c = e.connection(b, provider); c.LastSyncedAt == nil {
				t.Fatal("last sync not recorded")
			}
			// moved in Helvetly, not pushed yet: the old time outside is no outside move
			occ = e.change(occ, func(o *store.SchedOccurrence) {
				o.StartsAt, o.EndsAt = start.Add(30*time.Minute), start.Add(90*time.Minute)
			})
			e.makeDue()
			e.svc.ImportTick(context.Background())
			if len(e.mover.moves) != 0 {
				t.Fatalf("a pending push read as an outside move: %+v", e.mover.moves)
			}
			e.svc.PushTick(context.Background())
			// the host moves our event in their calendar
			pushed := e.fake.Events(provider, primary)
			var ours FakeEvent
			for _, ev := range pushed {
				if strings.HasPrefix(ev.Summary, "Lesson") {
					ours = ev
				}
			}
			moved := start.Add(time.Hour)
			e.fake.Move(provider, primary, ours.ID, moved, moved.Add(90*time.Minute))
			e.makeDue()
			e.svc.ImportTick(context.Background())
			if len(e.mover.moves) != 1 || e.mover.moves[0] != (move{b.ws, occ.ID, provider, moved, moved.Add(90 * time.Minute)}) {
				t.Fatalf("moves %+v", e.mover.moves)
			}
			// the host's own event deleted: no longer busy; our event deleted: detached, the session stays
			e.fake.Remove(provider, primary, busy)
			e.fake.Remove(provider, primary, ours.ID)
			e.makeDue()
			e.svc.ImportTick(context.Background())
			if blocks, _ := e.svc.Busy(context.Background(), e.st.Q, b.ws, []string{b.userID}, e.clock, e.clock.Add(horizon)); len(blocks) != 0 {
				t.Fatalf("deleted busy kept: %+v", blocks)
			}
			link, err := e.st.CalendarLink(context.Background(), c.ID, occ.ID)
			if err != nil || link.State != "detached" || e.notifications(b.userID, "scheduling.event_detached") != 1 {
				t.Fatalf("link %+v %v", link, err)
			}
			if o, _ := e.st.SchedOccurrence(context.Background(), b.ws, occ.ID, false); o.Status != "scheduled" {
				t.Fatalf("the session changed: %s", o.Status)
			}
			// pushed again (any change, or "push again"): back in the calendar
			e.change(occ, func(*store.SchedOccurrence) {})
			e.svc.PushTick(context.Background())
			lessons := 0
			for _, ev := range e.fake.Events(provider, primary) {
				if strings.HasPrefix(ev.Summary, "Lesson") {
					lessons++
				}
			}
			if link, _ := e.st.CalendarLink(context.Background(), c.ID, occ.ID); link.State != "ok" || lessons != 1 {
				t.Fatalf("not pushed again: %+v, %d", link, lessons)
			}
		})
	}
}

func TestImportFullResyncAndRefusedMove(t *testing.T) {
	e := newEnv(t)
	b := e.workspace(pro, "member")
	e.connect(b, "google")
	primary := e.fake.PrimaryCalendar("google")
	start := e.clock.Add(24 * time.Hour)
	first := e.fake.AddEvent("google", primary, start, start.Add(time.Hour), false)
	e.svc.ImportTick(context.Background())
	// the sync token expired and an event went meanwhile: the full sync drops it
	e.fake.ExpireSync()
	e.fake.Remove("google", primary, first)
	e.fake.AddEvent("google", primary, start.Add(2*time.Hour), start.Add(3*time.Hour), false)
	e.makeDue()
	e.svc.ImportTick(context.Background())
	blocks, _ := e.svc.Busy(context.Background(), e.st.Q, b.ws, []string{b.userID}, e.clock, e.clock.Add(horizon))
	if len(blocks) != 1 || !blocks[0].Start.Equal(start.Add(2*time.Hour)) {
		t.Fatalf("after the full sync %+v", blocks)
	}
	// a move Scheduling refuses is pushed back over
	occ := e.session(b, b.userID, start.Add(5*time.Hour))
	e.change(occ, func(*store.SchedOccurrence) {})
	e.svc.PushTick(context.Background())
	link, _ := e.st.CalendarLink(context.Background(), e.connection(b, "google").ID, occ.ID)
	_, id := splitExternal(link.ExternalID)
	e.mover.err = errors.New("occurrence_closed")
	e.fake.Move("google", primary, id, start.Add(9*time.Hour), start.Add(10*time.Hour))
	e.makeDue()
	e.svc.ImportTick(context.Background())
	if e.queued(e.connection(b, "google").ID) != 1 {
		t.Fatal("a refused move not pushed back")
	}
	e.svc.PushTick(context.Background())
	for _, ev := range e.fake.Events("google", primary) {
		if ev.ID == id && !ev.Start.Equal(occ.StartsAt) {
			t.Fatalf("not restored: %v", ev.Start)
		}
	}
}

func TestImportPausedWithoutPlan(t *testing.T) {
	e := newEnv(t)
	b := e.workspace(pro, "member")
	e.connect(b, "google")
	occ := e.session(b, b.userID, e.clock.Add(24*time.Hour))
	billingtest.Without(t, e.st, b.ws, store.FeatureCalendarSync)
	primary := e.fake.PrimaryCalendar("google")
	e.fake.AddEvent("google", primary, e.clock.Add(time.Hour), e.clock.Add(2*time.Hour), false)
	e.svc.ImportTick(context.Background())
	if n := e.count(`SELECT count(*) FROM calendar_busy WHERE workspace_id = $1`, b.ws); n != 0 {
		t.Fatalf("imported without the feature: %d", n)
	}
	e.change(occ, func(*store.SchedOccurrence) {})
	e.svc.PushTick(context.Background())
	if len(e.fake.Events("google", primary)) != 1 { // only the member's own event
		t.Fatal("pushed without the feature")
	}
}

func TestWorkspaceIsolation(t *testing.T) {
	e := newEnv(t)
	a := e.workspace(pro, "member")
	b := e.workspace(pro, "member")
	e.connect(a, "google")
	e.connect(b, "google") // the same Google account in another workspace: its own connection
	ca, cb := e.connection(a, "google"), e.connection(b, "google")
	if ca.ID == cb.ID || ca.ExternalAccountID != cb.ExternalAccountID {
		t.Fatal("one connection for two workspaces")
	}
	start := e.clock.Add(24 * time.Hour)
	e.change(e.session(a, a.userID, start), func(*store.SchedOccurrence) {})
	e.svc.PushTick(context.Background())
	e.makeDue()
	e.svc.ImportTick(context.Background())
	// A's session is A's own event (no busy block) and B's busy time (a real commitment of the person)
	if n := e.count(`SELECT count(*) FROM calendar_busy WHERE connection_id = $1`, ca.ID); n != 0 {
		t.Fatalf("A's own session imported as busy: %d", n)
	}
	if n := e.count(`SELECT count(*) FROM calendar_busy WHERE connection_id = $1`, cb.ID); n != 1 {
		t.Fatalf("B does not see the time as busy: %d", n)
	}
	if len(e.mover.moves) != 0 {
		t.Fatal("B took A's session for its own")
	}
	for _, req := range []struct{ method, path string }{
		{"PATCH", "/api/v1/scheduling/calendars/" + ca.ID}, {"POST", "/api/v1/scheduling/calendars/" + ca.ID + "/sync"},
		{"DELETE", "/api/v1/scheduling/calendars/" + ca.ID},
	} {
		if status, _ := e.do(b, req.method, req.path, map[string]any{}); status != 404 {
			t.Fatalf("%s %s from another workspace: %d", req.method, req.path, status)
		}
	}
}

func TestPatchSyncAndDisconnect(t *testing.T) {
	e := newEnv(t)
	owner := e.workspace(pro, "owner")
	m := e.member(owner.ws, "member")
	e.connect(m, "google")
	c := e.connection(m, "google")
	if status, out := e.do(m, "PATCH", "/api/v1/scheduling/calendars/"+c.ID, map[string]any{"busy_calendar_ids": []string{"nope"}}); status != 422 {
		t.Fatalf("unknown calendar: %d %v", status, out)
	}
	status, out := e.do(m, "PATCH", "/api/v1/scheduling/calendars/"+c.ID, map[string]any{"busy_calendar_ids": []string{"work@group.calendar.google.test"}})
	if status != 200 || stringOf(out["data"].(map[string]any)["busy_calendar_ids"]) != "work@group.calendar.google.test," {
		t.Fatalf("%d %v", status, out)
	}
	if status, _ := e.do(m, "POST", "/api/v1/scheduling/calendars/"+c.ID+"/sync", nil); status != 202 {
		t.Fatalf("sync: %d", status)
	}
	if status, _ := e.do(m, "POST", "/api/v1/scheduling/calendars/"+c.ID+"/sync", nil); status != 429 {
		t.Fatalf("second sync within 10 s: %d", status)
	}
	peer := e.member(owner.ws, "member")
	if status, _ := e.do(peer, "DELETE", "/api/v1/scheduling/calendars/"+c.ID, nil); status != 404 {
		t.Fatalf("another member disconnects: %d", status)
	}
	if status, _ := e.do(peer, "PATCH", "/api/v1/scheduling/calendars/"+c.ID, map[string]any{}); status != 404 {
		t.Fatalf("another member edits: %d", status)
	}
	occ := e.session(owner, m.userID, e.clock.Add(24*time.Hour))
	e.change(occ, func(*store.SchedOccurrence) {})
	e.svc.PushTick(context.Background())
	e.svc.WatchTick(context.Background())
	primary := e.fake.PrimaryCalendar("google")
	if len(e.fake.Events("google", primary)) != 1 || len(e.fake.Watches()) != 1 {
		t.Fatalf("pushed %d, watches %d", len(e.fake.Events("google", primary)), len(e.fake.Watches()))
	}
	// the owner may disconnect anyone's: events, watches and the grant go
	if status, _ := e.do(owner, "DELETE", "/api/v1/scheduling/calendars/"+c.ID, nil); status != 204 {
		t.Fatalf("owner disconnects: %d", status)
	}
	if len(e.fake.Events("google", primary)) != 0 || len(e.fake.Watches()) != 0 {
		t.Fatal("events or watches left behind")
	}
	if e.count(`SELECT count(*) FROM calendar_connections WHERE id = $1`, c.ID) != 0 ||
		e.count(`SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'scheduling.calendar_disconnected'`, owner.ws) != 1 {
		t.Fatal("not disconnected or not audited")
	}
	// keep_events=true leaves the pushed events
	e.connect(m, "google")
	e.svc.PushTick(context.Background())
	c = e.connection(m, "google")
	if status, _ := e.do(m, "DELETE", "/api/v1/scheduling/calendars/"+c.ID+"?keep_events=true", nil); status != 204 {
		t.Fatalf("keep events: %d", status)
	}
	if len(e.fake.Events("google", primary)) != 1 {
		t.Fatal("kept events were removed")
	}
}

func TestWatchesAndWebhooks(t *testing.T) {
	e := newEnv(t)
	b := e.workspace(pro, "member")
	e.connect(b, "google")
	e.connect(b, "microsoft")
	e.svc.WatchTick(context.Background())
	watches, err := e.st.ExpiringCalendarWatches(context.Background(), e.clock.Add(30*24*time.Hour), 10)
	if err != nil || len(watches) != 2 || len(e.fake.Watches()) != 2 {
		t.Fatalf("watches %+v %v", watches, err)
	}
	e.svc.WatchTick(context.Background()) // nothing new
	if len(e.fake.Watches()) != 2 {
		t.Fatal("watched twice")
	}
	var gw, mw store.CalendarWatch
	for _, w := range watches {
		c, _ := e.st.CalendarConnectionByID(context.Background(), w.ConnectionID)
		if c.Provider == "google" {
			gw = w
		} else {
			mw = w
		}
	}
	secret := e.fake.Watches()
	future := e.clock.Add(time.Hour)
	if _, err := e.raw.Exec(context.Background(), `UPDATE calendar_sources SET due_at = $1`, future); err != nil {
		t.Fatal(err)
	}
	due := func(w store.CalendarWatch) bool {
		return e.count(`SELECT count(*) FROM calendar_sources WHERE connection_id = $1 AND calendar_id = $2 AND due_at <= $3`,
			w.ConnectionID, w.CalendarID, e.clock) == 1
	}
	hook := func(path string, header map[string]string, body string) int {
		req, _ := http.NewRequest("POST", e.srv.URL+path, strings.NewReader(body))
		for k, v := range header {
			req.Header.Set(k, v)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	if s := hook("/api/webhooks/google-calendar", map[string]string{"X-Goog-Channel-ID": gw.ProviderID, "X-Goog-Channel-Token": "wrong"}, ""); s != 404 || due(gw) {
		t.Fatalf("wrong token: %d", s)
	}
	if s := hook("/api/webhooks/google-calendar", map[string]string{"X-Goog-Channel-ID": "cwt_unknown", "X-Goog-Channel-Token": "x"}, ""); s != 404 {
		t.Fatalf("unknown channel: %d", s)
	}
	if s := hook("/api/webhooks/google-calendar", map[string]string{"X-Goog-Channel-ID": gw.ProviderID,
		"X-Goog-Channel-Token": secret[gw.ProviderID], "X-Goog-Resource-State": "exists"}, ""); s != 202 || !due(gw) {
		t.Fatalf("google notification: %d", s)
	}
	// Graph: the validation handshake, then notifications checked by clientState
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/webhooks/microsoft-graph?validationToken=abc%20123", nil)
	res, _ := http.DefaultClient.Do(req)
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || buf.String() != "abc 123" || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/plain") {
		t.Fatalf("validation: %d %q", res.StatusCode, buf.String())
	}
	if s := hook("/api/webhooks/microsoft-graph", nil, `{"value":[{"subscriptionId":"`+mw.ProviderID+`","clientState":"wrong"}]}`); s != 404 || due(mw) {
		t.Fatalf("wrong clientState: %d", s)
	}
	if s := hook("/api/webhooks/microsoft-graph", nil, `{"value":[{"subscriptionId":"`+mw.ProviderID+`","clientState":"`+secret[mw.ProviderID]+`"}]}`); s != 202 || !due(mw) {
		t.Fatalf("graph notification: %d", s)
	}
	if s := hook("/api/webhooks/microsoft-graph", nil, strings.Repeat("x", 70<<10)); s != 400 {
		t.Fatalf("oversized body: %d", s)
	}
	// lifecycle: reauthorisation renews at the next round
	body := `{"value":[{"subscriptionId":"` + mw.ProviderID + `","clientState":"` + secret[mw.ProviderID] + `","lifecycleEvent":"reauthorizationRequired"}]}`
	if s := hook("/api/webhooks/microsoft-graph/lifecycle", nil, body); s != 202 {
		t.Fatalf("lifecycle: %d", s)
	}
	e.svc.WatchTick(context.Background())
	now := e.fake.Watches()
	if _, old := now[mw.ProviderID]; old || len(now) != 2 {
		t.Fatalf("not renewed: %v", now)
	}
	// renewed a day before expiry; nothing needed → dropped
	e.clock = e.clock.Add(googleWatchTL - 12*time.Hour)
	e.svc.WatchTick(context.Background())
	if _, old := e.fake.Watches()[gw.ProviderID]; old || len(e.fake.Watches()) != 2 {
		t.Fatalf("google channel not renewed: %v", e.fake.Watches())
	}
	g := e.connection(b, "google")
	if status, _ := e.do(b, "PATCH", "/api/v1/scheduling/calendars/"+g.ID, map[string]any{"busy_calendar_ids": []string{}}); status != 200 {
		t.Fatal(status)
	}
	e.svc.WatchTick(context.Background())
	if len(e.fake.Watches()) != 1 {
		t.Fatalf("watch of a calendar no longer imported: %v", e.fake.Watches())
	}
}

func TestPurge(t *testing.T) {
	e := newEnv(t)
	b := e.workspace(pro, "member")
	e.connect(b, "microsoft")
	c := e.connection(b, "microsoft")
	for e.clock.Weekday() != time.Monday {
		e.clock = e.clock.Add(24 * time.Hour)
	}

	if err := e.st.SaveCalendarBusy(context.Background(), c.ID, []store.BusyBlock{
		{ExternalID: "x|old", StartsAt: e.clock.Add(-72 * time.Hour), EndsAt: e.clock.Add(-71 * time.Hour)},
		{ExternalID: "x|new", StartsAt: e.clock.Add(time.Hour), EndsAt: e.clock.Add(2 * time.Hour)},
	}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := e.raw.Exec(context.Background(), `UPDATE calendar_sources SET full_resync = false, due_at = $1`, e.clock.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	e.svc.PurgeTick(context.Background())
	if got := e.count(`SELECT count(*) FROM calendar_busy WHERE connection_id = $1`, c.ID); got != 1 {
		t.Fatalf("expected one busy block after purge, got %d", got)
	}
	if e.count(`SELECT count(*) FROM calendar_sources WHERE connection_id = $1 AND busy AND full_resync`, c.ID) != 1 {
		t.Fatal("no weekly re-baseline")
	}
}

func TestCreateMeeting(t *testing.T) {
	e := newEnv(t)
	b := e.workspace(pro, "member")
	start := e.clock.Add(24 * time.Hour)
	first := store.SchedOccurrence{ID: "soc_first", StartsAt: start, EndsAt: start.Add(time.Hour), Title: new("Coaching")}
	if _, _, err := e.svc.CreateMeeting(context.Background(), b.ws, b.userID, "google_meet", first); !errors.Is(err, ErrMeetingProvider) {
		t.Fatalf("without a connection: %v", err)
	}
	e.connect(b, "google")
	link, ref, err := e.svc.CreateMeeting(context.Background(), b.ws, b.userID, "google_meet", first)
	if err != nil || !strings.HasPrefix(link, "https://meet.google.com/") || !strings.HasPrefix(ref, e.fake.PrimaryCalendar("google")+"|") {
		t.Fatalf("%q %q %v", link, ref, err)
	}
	// the event's first push adopts the meeting's event instead of making another
	occ := e.session(b, b.userID, start)
	if _, err := e.raw.Exec(context.Background(), `UPDATE scheduling_events SET meeting_provider = 'google_meet', meeting_url = $2,
		meeting_ref = $3, mode = 'online' WHERE id = $1`, occ.EventID, link, ref); err != nil {
		t.Fatal(err)
	}
	e.change(occ, func(*store.SchedOccurrence) {})
	e.svc.PushTick(context.Background())
	events := e.fake.Events("google", e.fake.PrimaryCalendar("google"))
	if len(events) != 1 || events[0].Meeting != link || !strings.Contains(events[0].Summary, "Müller AG") {
		t.Fatalf("pushed %+v", events)
	}
	// Teams: a personal Microsoft account cannot make one
	e.fake.Account("microsoft", FakeAccount{Subject: "m-9", Email: "me@outlook.test", Personal: true})
	e.connect(b, "microsoft")
	if _, _, err := e.svc.CreateMeeting(context.Background(), b.ws, b.userID, "teams", first); !errors.Is(err, ErrTeamsUnavailable) {
		t.Fatalf("personal account: %v", err)
	}
	if len(e.fake.Events("microsoft", "AAMk-default")) != 0 {
		t.Fatal("the attempt left an event")
	}
	e.fake.Fail("google", 500)
	if _, _, err := e.svc.CreateMeeting(context.Background(), b.ws, b.userID, "google_meet", first); !errors.Is(err, ErrMeetingUnavailable) {
		t.Fatalf("provider failing: %v", err)
	}
}

func TestTeamsMeeting(t *testing.T) {
	e := newEnv(t)
	b := e.workspace(pro, "member")
	e.connect(b, "microsoft")
	start := e.clock.Add(24 * time.Hour)
	link, _, err := e.svc.CreateMeeting(context.Background(), b.ws, b.userID, "teams",
		store.SchedOccurrence{ID: "soc_t", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil || !strings.HasPrefix(link, "https://teams.microsoft.com/") {
		t.Fatalf("%q %v", link, err)
	}
}

func TestFeed(t *testing.T) {
	e := newEnv(t)
	// After the Zurich spring clock change, local midnight is 22:00 UTC.
	e.clock = time.Date(2027, 3, 28, 23, 30, 0, 0, time.UTC)
	b := e.workspace(pro, "member")
	if err := e.st.UpdateWorkspace(context.Background(), store.Workspace{ID: b.ws, Name: "Firma " + b.ws, Timezone: "Europe/Zurich"}); err != nil {
		t.Fatal(err)
	}
	midnight := time.Date(2027, 3, 28, 22, 0, 0, 0, time.UTC)
	atStart := e.session(b, b.userID, midnight)
	beforeStart := e.session(b, b.userID, midnight.Add(-time.Second))
	beforeEnd := e.session(b, b.userID, e.clock.Add(horizon-time.Second))
	atEnd := e.session(b, b.userID, e.clock.Add(horizon))
	other := e.member(b.ws, "member")
	start := e.clock.Add(24 * time.Hour)
	e.session(b, b.userID, start)
	cancelled := e.session(b, b.userID, start.Add(2*time.Hour))
	e.change(cancelled, func(o *store.SchedOccurrence) { o.Status = "cancelled_late" })
	e.session(b, other.userID, start.Add(4*time.Hour)) // another host's
	if status, out := e.do(b, "GET", "/api/v1/scheduling/feed", nil); status != 200 || out["data"] != nil {
		t.Fatalf("no feed yet: %d %v", status, out)
	}
	status, out := e.do(b, "POST", "/api/v1/scheduling/feed", nil)
	feedURL, _ := out["data"].(map[string]any)["url"].(string)
	if status != 200 || !strings.HasPrefix(feedURL, publicURL+feedPath) || !strings.HasSuffix(feedURL, ".ics") {
		t.Fatalf("%d %v", status, out)
	}
	if _, again := e.do(b, "GET", "/api/v1/scheduling/feed", nil); again["data"].(map[string]any)["url"] != feedURL {
		t.Fatal("the URL is not shown again")
	}
	get := func(u string, header map[string]string) (*http.Response, string) {
		req, _ := http.NewRequest("GET", strings.Replace(u, publicURL, e.srv.URL, 1), nil)
		for k, v := range header {
			req.Header.Set(k, v)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(res.Body)
		return res, buf.String()
	}
	res, body := get(feedURL, nil)
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/calendar") || res.Header.Get("Cache-Control") != "private, max-age=300" ||
		res.Header.Get("Referrer-Policy") != "no-referrer" || strings.Count(body, "BEGIN:VEVENT") != 3 || !strings.Contains(body, "METHOD:PUBLISH") ||
		!strings.Contains(body, "Lesson · Müller AG") {
		t.Fatalf("%d %v\n%s", res.StatusCode, res.Header, body)
	}
	if !strings.Contains(body, "UID:"+atStart.ID+"@") || strings.Contains(body, "UID:"+beforeStart.ID+"@") {
		t.Fatal("feed should include local midnight and exclude the second before it")
	}
	if !strings.Contains(body, "UID:"+beforeEnd.ID+"@") || strings.Contains(body, "UID:"+atEnd.ID+"@") {
		t.Fatal("feed should stop before the end of its horizon")
	}
	if res304, _ := get(feedURL, map[string]string{"If-None-Match": res.Header.Get("ETag")}); res304.StatusCode != 304 {
		t.Fatalf("etag: %d", res304.StatusCode)
	}
	if e.count(`SELECT count(*) FROM calendar_feeds WHERE user_id = $1 AND last_fetched_at IS NOT NULL`, b.userID) != 1 {
		t.Fatal("fetch not recorded")
	}
	// busy mode: no titles, client names, notes or links
	s := store.DefaultSchedSettings()
	s.FeedDetails = "busy"
	if err := e.st.SaveSchedulingSettings(context.Background(), b.ws, s, b.userID, e.clock); err != nil {
		t.Fatal(err)
	}
	if _, body := get(feedURL, nil); !strings.Contains(body, "SUMMARY:Busy") || strings.Contains(body, "Müller") || strings.Contains(body, "Bahnhof") ||
		strings.Contains(body, "/scheduling?") {
		t.Fatalf("busy mode:\n%s", body)
	}
	// rotation: the old URL stops at once
	_, out = e.do(b, "POST", "/api/v1/scheduling/feed", nil)
	rotated := out["data"].(map[string]any)["url"].(string)
	if res, _ := get(feedURL, nil); res.StatusCode != 404 || rotated == feedURL {
		t.Fatalf("old URL after rotation: %d", res.StatusCode)
	}
	if res, _ := get(rotated, nil); res.StatusCode != 200 {
		t.Fatalf("new URL: %d", res.StatusCode)
	}
	if e.count(`SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'scheduling.feed_rotated'`, b.ws) != 2 {
		t.Fatal("rotation not audited")
	}
	// the plan without Scheduling: 404; unknown token: 404
	billingtest.Without(t, e.st, b.ws, store.FeatureScheduling)
	if res, _ := get(rotated, nil); res.StatusCode != 404 {
		t.Fatalf("without the feature: %d", res.StatusCode)
	}
	if err := billing.ClearWorkspaceOverride(context.Background(), e.st, b.ws, store.FeatureScheduling, "test", "back"); err != nil {
		t.Fatal(err)
	}
	for _, u := range []string{publicURL + feedPath + strings.Repeat("A", 43) + ".ics", publicURL + feedPath + "short.ics", strings.TrimSuffix(rotated, ".ics")} {
		if res, _ := get(u, nil); res.StatusCode != 404 {
			t.Fatalf("%s: %d", u, res.StatusCode)
		}
	}
	// the member leaving the workspace ends their feed
	if err := e.st.RemoveMember(context.Background(), b.ws, b.userID); err != nil {
		t.Fatal(err)
	}
	if res, _ := get(rotated, nil); res.StatusCode != 404 {
		t.Fatalf("member gone: %d", res.StatusCode)
	}
	// delete
	_, out = e.do(other, "POST", "/api/v1/scheduling/feed", nil)
	u := out["data"].(map[string]any)["url"].(string)
	if status, _ := e.do(other, "DELETE", "/api/v1/scheduling/feed", nil); status != 204 {
		t.Fatal(status)
	}
	if res, _ := get(u, nil); res.StatusCode != 404 {
		t.Fatalf("deleted feed: %d", res.StatusCode)
	}
}

func TestGoogleEventTimes(t *testing.T) {
	zurich, _ := time.LoadLocation("Europe/Zurich")
	for _, tc := range []struct {
		name string
		ev   gEvent
		zone *time.Location
		busy bool
		from time.Time
	}{
		{"timed", gEvent{ID: "a", Start: &gTime{DateTime: "2026-12-01T09:00:00+01:00"}, End: &gTime{DateTime: "2026-12-01T10:00:00+01:00"}}, nil,
			true, time.Date(2026, 12, 1, 8, 0, 0, 0, time.UTC)},
		{"all day in the calendar's zone", gEvent{ID: "b", Start: &gTime{Date: "2026-12-24"}, End: &gTime{Date: "2026-12-25"}}, zurich,
			true, time.Date(2026, 12, 23, 23, 0, 0, 0, time.UTC)},
		{"all day, zone unknown", gEvent{ID: "c", Start: &gTime{Date: "2026-12-24"}, End: &gTime{Date: "2026-12-25"}}, nil,
			true, time.Date(2026, 12, 24, 0, 0, 0, 0, time.UTC)},
		{"free", gEvent{ID: "d", Transparency: "transparent", Start: &gTime{Date: "2026-12-24"}, End: &gTime{Date: "2026-12-25"}}, nil,
			false, time.Date(2026, 12, 24, 0, 0, 0, 0, time.UTC)},
		{"no times", gEvent{ID: "e", Status: "cancelled"}, nil, false, time.Time{}},
	} {
		c := tc.ev.change(tc.zone)
		if c.Busy != tc.busy || !c.Start.Equal(tc.from) || c.Removed != (tc.ev.Status == "cancelled") {
			t.Errorf("%s: %+v", tc.name, c)
		}
	}
}

func TestIDClaims(t *testing.T) {
	g := newGoogle("gid", "s", "", "", "")
	tok := func(claims string) *oauth2.Token {
		return (&oauth2.Token{}).WithExtra(map[string]any{"id_token": "h." + base64.RawURLEncoding.EncodeToString([]byte(claims)) + ".s",
			"scope": scopeEvents + " " + scopeCalList})
	}
	now := time.Unix(1_800_000_000, 0)
	for _, tc := range []struct {
		name, claims string
		ok           bool
	}{
		{"valid", `{"aud":"gid","nonce":"n","exp":1800000100,"sub":"1","email":"A@x.ch","email_verified":true}`, true},
		{"audience list", `{"aud":["other","gid"],"nonce":"n","sub":"1","email":"a@x.ch","email_verified":true}`, true},
		{"another client", `{"aud":"other","nonce":"n","sub":"1","email":"a@x.ch","email_verified":true}`, false},
		{"another sign-in", `{"aud":"gid","nonce":"m","sub":"1","email":"a@x.ch","email_verified":true}`, false},
		{"expired", `{"aud":"gid","nonce":"n","exp":1799990000,"sub":"1","email":"a@x.ch","email_verified":true}`, false},
		{"unverified email", `{"aud":"gid","nonce":"n","sub":"1","email":"a@x.ch"}`, false},
	} {
		a, err := g.account(tok(tc.claims), "n", now)
		if (err == nil) != tc.ok || (tc.ok && (a.Email != "a@x.ch" || !g.scopesOK(a.Scopes))) {
			t.Errorf("%s: %+v %v", tc.name, a, err)
		}
	}
	if _, err := g.account(&oauth2.Token{}, "n", now); err == nil {
		t.Error("no id token")
	}
}

func TestFakeControl(t *testing.T) {
	f := NewFake()
	srv := httptest.NewServer(f.Handler())
	defer srv.Close()
	post := func(path, body string) (int, map[string]string) {
		res, err := http.Post(srv.URL+path, "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]string
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	status, out := post("/microsoft/_test/busy", `{"start":"2026-12-01T09:00:00Z","end":"2026-12-01T10:00:00Z"}`)
	if status != 200 || out["calendar"] != "AAMk-default" || len(f.Events("microsoft", "AAMk-default")) != 1 {
		t.Fatalf("busy: %d %v", status, out)
	}
	if status, _ := post("/microsoft/_test/move", `{"id":"`+out["id"]+`","start":"2026-12-01T11:00:00Z","end":"2026-12-01T12:00:00Z"}`); status != 200 ||
		f.Events("microsoft", "AAMk-default")[0].Start.Hour() != 11 {
		t.Fatalf("move: %d", status)
	}
	if status, _ := post("/microsoft/_test/remove", `{"id":"`+out["id"]+`"}`); status != 200 || len(f.Events("microsoft", "AAMk-default")) != 0 {
		t.Fatalf("remove: %d", status)
	}
	for _, path := range []string{"/microsoft/_test/remove", "/microsoft/_test/nope"} {
		if status, _ := post(path, `{"id":"missing"}`); status != 404 {
			t.Fatalf("%s: %d", path, status)
		}
	}
	if status, _ := post("/google/_test/busy", `not json`); status != 400 {
		t.Fatalf("bad body: %d", status)
	}
	id := f.AddEvent("google", f.PrimaryCalendar("google"), time.Date(2026, 12, 1, 9, 0, 0, 0, time.UTC), time.Date(2026, 12, 1, 10, 0, 0, 0, time.UTC), false)
	res, err := http.Post(srv.URL+"/google/_test/events", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var listed struct{ Events []FakeEvent }
	if err := json.NewDecoder(res.Body).Decode(&listed); err != nil || res.StatusCode != 200 || len(listed.Events) != 1 || listed.Events[0].ID != id {
		t.Fatalf("events: %d %+v %v", res.StatusCode, listed, err)
	}
}

func TestHexColor(t *testing.T) {
	for raw, want := range map[string]string{"#A47AE2": "#a47ae2", " #9fe1e7 ": "#9fe1e7", "": "", "red": "", "#fff": "", "#12345g": "", "#a47ae2; x": ""} {
		if got := hexColor(raw); got != want {
			t.Errorf("hexColor(%q) = %q, want %q", raw, got, want)
		}
	}
}
