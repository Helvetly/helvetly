package calsync

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

const publicURL = "https://app.example.com"

type move struct {
	workspace, occurrence, source string
	start, end                    time.Time
}

// mover records the moves calsync hands to the scheduling service.
type mover struct {
	mu    sync.Mutex
	moves []move
	err   error
}

func (m *mover) MoveFromCalendar(_ context.Context, ws, occ string, start, end time.Time, source string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.moves = append(m.moves, move{ws, occ, source, start, end})
	return m.err
}

type env struct {
	t     *testing.T
	st    *store.Store
	raw   *pgxpool.Pool
	srv   *httptest.Server
	fake  *Fake
	svc   *Service
	mover *mover
	clock time.Time
}

func calendarConfig(fakeURL string) config.Config {
	return config.Config{PublicURL: publicURL, SecretKey: bytes.Repeat([]byte{7}, 32), SessionTTL: time.Hour,
		Calendars: config.Calendars{GoogleClientID: "gid", GoogleClientSecret: "gs", MicrosoftClientID: "mid", MicrosoftSecret: "ms",
			MicrosoftTenant: "common", GoogleAPIURL: fakeURL + "/google", MicrosoftGraphURL: fakeURL + "/microsoft"}}
}

func newEnv(t *testing.T) *env {
	return newEnvWith(t, func(*config.Config) {})
}

func newEnvWith(t *testing.T, edit func(*config.Config)) *env {
	t.Helper()
	t.Parallel()
	st, raw := storetest.New(t)
	billingtest.Wire(t, st)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	if testing.Verbose() {
		discard = slog.New(slog.NewTextHandler(os.Stderr, nil))
	}
	fake := NewFake()
	fakeSrv := httptest.NewServer(fake.Handler())
	t.Cleanup(fakeSrv.Close)
	cfg := calendarConfig(fakeSrv.URL)
	edit(&cfg)
	a, err := auth.New(cfg, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	svc := New(st, a, cfg, discard)
	for _, p := range svc.providers { // no spacing between calls in tests
		switch v := p.(type) {
		case *google:
			v.gap = 0
		case *microsoft:
			v.gap = 0
		}
	}
	e := &env{t: t, st: st, raw: raw, fake: fake, svc: svc, mover: &mover{}, clock: time.Now().UTC().Truncate(time.Second)}
	svc.now = func() time.Time { return e.clock }
	svc.async = func(f func()) { f() }
	svc.SetMover(e.mover)
	mux := http.NewServeMux()
	svc.Register(mux)
	e.srv = httptest.NewServer(mux)
	t.Cleanup(e.srv.Close)
	return e
}

type browser struct {
	c      *http.Client
	csrf   string
	userID string
	ws     string
}

// workspace makes a workspace on plan with a person of role, signed in, and a client cli_<ws>.
func (e *env) workspace(plan, role string) *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	b := e.member(ws, role)
	billingtest.On(e.t, e.st, ws, plan)
	if err := e.st.CreateClient(context.Background(), ws, "cli_"+ws, map[string]any{"name": "Müller AG"}, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return b
}

// member adds a signed-in person of role to workspace ws (made when it does not exist yet).
func (e *env) member(ws, role string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna"}
	token, csrf := rand.Text(), rand.Text()
	sum := sha256.Sum256([]byte(token))
	if _, err := e.st.WorkspaceName(ctx, ws); errors.Is(err, store.ErrNotFound) || err != nil {
		if err := e.st.CreateWorkspace(ctx, store.Workspace{ID: ws, Name: "Firma " + ws}, "UTC", now); err != nil {
			e.t.Fatal(err)
		}
	}
	for _, err := range []error{
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	jar, _ := cookiejar.New(nil)
	base, _ := url.Parse(e.srv.URL)
	jar.SetCookies(base, []*http.Cookie{{Name: "helvetly_session", Value: token, Path: "/"}})
	return &browser{c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		csrf: csrf, userID: u.ID, ws: ws}
}

func (e *env) do(b *browser, method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	res := e.request(b, method, e.srv.URL+path, body)
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func (e *env) request(b *browser, method, target string, body any) *http.Response {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, target, rd)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", b.csrf)
	c := http.DefaultClient
	if b != nil {
		c = b.c
	}
	res, err := c.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	return res
}

// connect runs the OAuth flow through the fake and returns where the callback lands.
func (e *env) connect(b *browser, provider string) string {
	e.t.Helper()
	res := e.request(b, "GET", e.srv.URL+"/api/v1/scheduling/calendars/"+provider+"/connect", nil)
	res.Body.Close()
	if res.StatusCode != http.StatusFound {
		e.t.Fatalf("connect %s: %d", provider, res.StatusCode)
	}
	res = e.request(b, "GET", res.Header.Get("Location"), nil) // the provider's consent screen
	res.Body.Close()
	callback := res.Header.Get("Location")
	if !strings.HasPrefix(callback, publicURL+"/api/v1/scheduling/calendars/"+provider+"/callback?") {
		e.t.Fatalf("callback %q", callback)
	}
	return e.land(b, strings.Replace(callback, publicURL, e.srv.URL, 1))
}

func (e *env) land(b *browser, callback string) string {
	e.t.Helper()
	res := e.request(b, "GET", callback, nil)
	res.Body.Close()
	if res.StatusCode != http.StatusFound {
		e.t.Fatalf("callback: %d", res.StatusCode)
	}
	return res.Header.Get("Location")
}

// connection is the person's only connection of provider.
func (e *env) connection(b *browser, provider string) store.CalendarConnection {
	e.t.Helper()
	list, err := e.st.CalendarConnections(context.Background(), b.ws, b.userID)
	if err != nil {
		e.t.Fatal(err)
	}
	for _, c := range list {
		if c.Provider == provider {
			return c
		}
	}
	e.t.Fatalf("no %s connection", provider)
	return store.CalendarConnection{}
}

// session makes a one-off session of b's workspace hosted by host, an hour long.
func (e *env) session(b *browser, host string, start time.Time) store.SchedOccurrence {
	e.t.Helper()
	ctx := context.Background()
	ev := store.SchedEvent{ID: auth.NewID("sev"), WorkspaceID: b.ws, ClientID: "cli_" + b.ws, HostUserID: &host, Title: "Lesson", Mode: "live",
		Location: new("Bahnhofstrasse 1"), TimeZone: "Europe/Zurich", StartsLocal: start, DurationMinutes: 60, Attendees: []string{"c@x.ch"},
		CreatedAt: e.clock, UpdatedAt: e.clock}
	occID := auth.NewID("soc")
	err := e.st.Tx(ctx, func(q store.Q) error {
		if err := q.CreateSchedEvent(ctx, ev); err != nil {
			return err
		}
		_, err := q.MaterialiseOccurrences(ctx, b.ws, ev.ID, []store.SchedSlot{{ID: occID, OriginalStart: start, StartsAt: start,
			EndsAt: start.Add(time.Hour)}}, "scheduled", nil, e.clock)
		return err
	})
	if err != nil {
		e.t.Fatal(err)
	}
	o, err := e.st.SchedOccurrence(ctx, b.ws, occID, false)
	if err != nil {
		e.t.Fatal(err)
	}
	return o
}

// change saves the occurrence through fn and queues its push, as the scheduling service does.
func (e *env) change(o store.SchedOccurrence, fn func(*store.SchedOccurrence)) store.SchedOccurrence {
	e.t.Helper()
	ctx := context.Background()
	fn(&o)
	o.Sequence++
	err := e.st.Tx(ctx, func(q store.Q) error {
		if err := q.SaveSchedOccurrence(ctx, o); err != nil {
			return err
		}
		return e.svc.Enqueue(ctx, q, o.WorkspaceID, []string{o.ID})
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return o
}

func (e *env) count(sql string, args ...any) int {
	e.t.Helper()
	var n int
	if err := e.raw.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func (e *env) notifications(userID, event string) int {
	return e.count(`SELECT count(*) FROM notifications WHERE user_id = $1 AND event = $2`, userID, event)
}

func (e *env) queued(connectionID string) int {
	return e.count(`SELECT count(*) FROM calendar_push_queue WHERE connection_id = $1`, connectionID)
}

// makeDue makes every imported calendar due now.
func (e *env) makeDue() {
	e.t.Helper()
	if _, err := e.raw.Exec(context.Background(), `UPDATE calendar_sources SET due_at = $1`, e.clock); err != nil {
		e.t.Fatal(err)
	}
}

var pro = billing.Pro
