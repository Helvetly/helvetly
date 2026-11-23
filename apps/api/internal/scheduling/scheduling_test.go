package scheduling

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"helvetly.com/api/internal/auth"

	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/store/storetest"
)

// Monday 16 Nov 2026, 10:00 in Zurich.
var fixedNow = time.Date(2026, 11, 16, 9, 0, 0, 0, time.UTC)

type env struct {
	t   *testing.T
	st  *store.Store
	db  *pgxpool.Pool
	svc *Service
	srv *httptest.Server
	mu  sync.Mutex
	now time.Time
}

func newEnv(t *testing.T) *env {
	t.Helper()
	t.Parallel()
	st, db := storetest.New(t)
	discard := slog.New(slog.NewTextHandler(io.Discard, nil))
	a, err := auth.New(config.Config{PublicURL: "https://helvetly.example.com", SecretKey: bytes.Repeat([]byte{7}, 32),
		SessionTTL: time.Hour}, st, discard)
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, st: st, db: db, now: fixedNow}
	e.svc = New(st, a, invoices.New(st, a, nil, nil, discard), bytes.Repeat([]byte{7}, 32), "https://app.example.com", "https://portal.example.com", discard)
	e.svc.now = func() time.Time { e.mu.Lock(); defer e.mu.Unlock(); return e.now }
	mux := http.NewServeMux()
	a.Register(mux)
	e.svc.Register(mux)
	inv := invoices.New(st, a, nil, nil, discard)
	inv.Register(mux)
	engagements.New(st, a, inv, discard).Register(mux)
	e.srv = httptest.NewServer(permissions.Guard(a, mux))
	t.Cleanup(e.srv.Close)
	return e
}

func (e *env) at(t time.Time) { e.mu.Lock(); e.now = t; e.mu.Unlock() }

type browser struct{ token, csrf, workspace, user string }

func (e *env) workspace() *browser {
	e.t.Helper()
	ws := auth.NewID("wsp")
	if err := e.st.CreateWorkspace(context.Background(), store.Workspace{ID: ws, Name: "Acme"}, "Europe/Zurich", time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return e.join(ws, "owner", nil)
}

func (e *env) join(ws, role string, scopes []string) *browser {
	e.t.Helper()
	ctx, now := context.Background(), time.Now()
	u := store.User{ID: auth.NewID("usr"), Email: strings.ToLower(rand.Text()) + "@example.com", Name: "Anna " + role}
	b := &browser{token: rand.Text(), csrf: rand.Text(), workspace: ws, user: u.ID}
	sum := sha256.Sum256([]byte(b.token))
	for _, err := range []error{
		e.st.CreateUser(ctx, u, now),
		e.st.AddMember(ctx, ws, u.ID, role, now),
		e.st.CreateSession(ctx, auth.NewID("ses"), hex.EncodeToString(sum[:]), b.csrf, u.ID, ws, now, now.Add(time.Hour)),
	} {
		if err != nil {
			e.t.Fatal(err)
		}
	}
	if scopes != nil {
		if err := e.st.SetMemberRole(ctx, ws, u.ID, role, scopes); err != nil {
			e.t.Fatal(err)
		}
	}
	return b
}

func (e *env) client(b *browser, email string) string {
	e.t.Helper()
	id := auth.NewID("cli")
	fields := map[string]any{"name": "Müller AG"}
	if email != "" {
		fields["email"] = email
	}
	if err := e.st.CreateClient(context.Background(), b.workspace, id, fields, time.Now()); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) send(b *browser, method, path string, body any) (*http.Response, []byte) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			e.t.Fatal(err)
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rd)
	if err != nil {
		e.t.Fatal(err)
	}
	if rd != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp, raw
}

func (e *env) do(b *browser, method, path string, body any, want int, out any) {
	e.t.Helper()
	resp, raw := e.send(b, method, path, body)
	if resp.StatusCode != want {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, want, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
}

func (e *env) fails(b *browser, method, path string, body any, status int, code string) map[string]string {
	e.t.Helper()
	var out struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				Fields map[string]string `json:"fields"`
			} `json:"details"`
		} `json:"error"`
	}
	e.do(b, method, path, body, status, &out)
	if out.Error.Code != code {
		e.t.Fatalf("%s %s: code %q, want %q", method, path, out.Error.Code, code)
	}
	return out.Error.Details.Fields
}

type created struct {
	Data struct {
		Event       Event        `json:"event"`
		Occurrences []Occurrence `json:"occurrences"`
		Conflicts   []Conflict   `json:"conflicts"`
	} `json:"data"`
}

func (e *env) create(b *browser, body map[string]any) created {
	e.t.Helper()
	var out created
	e.do(b, "POST", "/api/v1/scheduling/events", body, http.StatusCreated, &out)
	return out
}

func (e *env) occurrence(b *browser, id string) Occurrence {
	e.t.Helper()
	var out struct{ Data Occurrence }
	e.do(b, "GET", "/api/v1/scheduling/occurrences/"+id, nil, http.StatusOK, &out)
	return out.Data
}

func (e *env) list(b *browser, query string) []Occurrence {
	e.t.Helper()
	var out struct{ Data []Occurrence }
	e.do(b, "GET", "/api/v1/scheduling/occurrences?"+query, nil, http.StatusOK, &out)
	return out.Data
}

func mustTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestCreateOneOffAndConflicts(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "anna@mueller.example")
	first := e.create(b, map[string]any{"client_id": c, "title": "Intro", "starts_local": "2026-12-01T09:00", "duration_minutes": 60})
	if len(first.Data.Occurrences) != 1 || first.Data.Event.Recurrence != nil {
		t.Fatalf("one-off: %+v", first.Data)
	}
	o := first.Data.Occurrences[0]
	if !o.StartsAt.Equal(mustTime("2026-12-01T08:00:00Z")) || o.Status != "scheduled" || o.Host == nil || o.Host.ID != b.user {
		t.Fatalf("occurrence: %+v", o)
	}
	if got := first.Data.Event.Attendees; len(got) != 1 || got[0] != "anna@mueller.example" {
		t.Fatalf("attendees default to the client's address: %v", got)
	}
	second := e.create(b, map[string]any{"client_id": c, "title": "Overlap", "starts_local": "2026-12-01T09:30", "duration_minutes": 30})
	if cs := second.Data.Conflicts; len(cs) != 1 || cs[0].Kind != "event" || cs[0].OccurrenceID != o.ID || cs[0].Title != "Intro" {
		t.Fatalf("conflicts are a warning, the write goes through: %+v", cs)
	}
	var cs struct{ Data []Conflict }
	e.do(b, "GET", "/api/v1/scheduling/conflicts?host_id="+b.user+"&starts_at=2026-12-01T08:15:00Z&ends_at=2026-12-01T08:45:00Z", nil, 200, &cs)
	if len(cs.Data) != 2 {
		t.Fatalf("conflicts endpoint: %+v", cs.Data)
	}
	if got := e.occurrence(b, o.ID); len(got.Conflicts) != 1 {
		t.Fatalf("single read carries conflicts: %+v", got.Conflicts)
	}
}

func TestCreateValidation(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	other := e.workspace()
	foreign := e.client(other, "")
	for name, tc := range map[string]struct {
		body   map[string]any
		status int
		code   string
		field  string
	}{
		"no client":       {map[string]any{"title": "x", "starts_local": "2026-12-01T09:00", "duration_minutes": 60}, 422, "validation_failed", "client_id"},
		"foreign client":  {map[string]any{"client_id": foreign, "title": "x", "starts_local": "2026-12-01T09:00", "duration_minutes": 60}, 422, "validation_failed", "client_id"},
		"duration":        {map[string]any{"client_id": c, "title": "x", "starts_local": "2026-12-01T09:00", "duration_minutes": 721}, 422, "validation_failed", "duration_minutes"},
		"zone":            {map[string]any{"client_id": c, "title": "x", "starts_local": "2026-12-01T09:00", "duration_minutes": 60, "time_zone": "Mars/Base"}, 422, "validation_failed", "time_zone"},
		"until and count": {map[string]any{"client_id": c, "title": "x", "starts_local": "2026-12-01T09:00", "duration_minutes": 60, "recurrence": map[string]any{"freq": "weekly", "until": "2027-01-01", "count": 3}}, 422, "validation_failed", "recurrence"},
		"live meeting":    {map[string]any{"client_id": c, "title": "x", "starts_local": "2026-12-01T09:00", "duration_minutes": 60, "mode": "live", "meeting": map[string]any{"provider": "manual"}}, 422, "validation_failed", "meeting"},
		"meet without connection": {map[string]any{"client_id": c, "title": "x", "starts_local": "2026-12-01T09:00", "duration_minutes": 60, "mode": "online",
			"meeting": map[string]any{"provider": "google_meet"}}, 422, "meeting_provider", ""},
		"unknown field": {map[string]any{"client_id": c, "nope": 1}, 400, "invalid_request", ""},
	} {
		t.Run(name, func(t *testing.T) {
			fields := e.fails(b, "POST", "/api/v1/scheduling/events", tc.body, tc.status, tc.code)
			if tc.field != "" && fields[tc.field] == "" {
				t.Fatalf("fields %v, want %s", fields, tc.field)
			}
		})
	}
	if got := e.list(b, "from=2026-11-01T00:00:00Z&to=2027-01-01T00:00:00Z"); len(got) != 0 {
		t.Fatalf("a refused meeting rolls the event back: %+v", got)
	}
}

func TestSeriesAcrossSummerTime(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	out := e.create(b, map[string]any{"client_id": c, "title": "Lesson", "starts_local": "2027-03-22T09:00", "duration_minutes": 45,
		"recurrence": map[string]any{"freq": "weekly", "count": 3}})
	occs := out.Data.Occurrences
	if len(occs) != 3 || out.Data.Event.Recurrence.RRule != "FREQ=WEEKLY;BYDAY=MO;COUNT=3" {
		t.Fatalf("series: %d %+v", len(occs), out.Data.Event.Recurrence)
	}
	// 09:00 in Zurich stays 09:00 over the switch on 28 March: 08:00Z, then 07:00Z.
	for i, want := range []string{"2027-03-22T08:00:00Z", "2027-03-29T07:00:00Z", "2027-04-05T07:00:00Z"} {
		if !occs[i].StartsAt.Equal(mustTime(want)) || !occs[i].OriginalStart.Equal(occs[i].StartsAt) {
			t.Fatalf("occurrence %d at %s, want %s", i, occs[i].StartsAt, want)
		}
	}
}

func TestEditScopes(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	series := func() []Occurrence {
		out := e.create(b, map[string]any{"client_id": c, "title": "Lesson", "starts_local": "2026-12-01T09:00", "duration_minutes": 60,
			"recurrence": map[string]any{"freq": "weekly", "count": 6}})
		return out.Data.Occurrences
	}
	patch := func(id string, body map[string]any) (Occurrence, int) {
		var out struct {
			Data    Occurrence     `json:"data"`
			Details map[string]int `json:"details"`
		}
		e.do(b, "PATCH", "/api/v1/scheduling/occurrences/"+id, body, 200, &out)
		return out.Data, out.Details["kept"]
	}

	t.Run("this", func(t *testing.T) {
		occs := series()
		got, _ := patch(occs[1].ID, map[string]any{"scope": "this", "starts_local": "2026-12-08T11:00", "title": "Moved"})
		if !got.StartsAt.Equal(mustTime("2026-12-08T10:00:00Z")) || got.Status != "rescheduled" || !got.IsException ||
			!got.OriginalStart.Equal(occs[1].OriginalStart) || got.Title != "Moved" || got.Sequence != occs[1].Sequence+1 {
			t.Fatalf("this: %+v", got)
		}
		if other := e.occurrence(b, occs[2].ID); other.Title != "Lesson" || !other.StartsAt.Equal(occs[2].StartsAt) {
			t.Fatalf("others untouched: %+v", other)
		}
		e.fails(b, "PATCH", "/api/v1/scheduling/occurrences/"+occs[2].ID, map[string]any{"scope": "this", "client_note": "x"}, 422, "validation_failed")
	})

	t.Run("all keeps ids and changed sessions' times", func(t *testing.T) {
		occs := series()
		patch(occs[3].ID, map[string]any{"scope": "this", "starts_local": "2026-12-22T15:00"})
		got, kept := patch(occs[0].ID, map[string]any{"scope": "all", "starts_local": "2026-12-01T10:30", "title": "Renamed"})
		if kept != 1 || !got.StartsAt.Equal(mustTime("2026-12-01T09:30:00Z")) || got.Title != "Renamed" {
			t.Fatalf("all: kept %d %+v", kept, got)
		}
		after := e.list(b, "from=2026-11-30T00:00:00Z&to=2027-01-31T00:00:00Z&client_id="+c+"&status=scheduled,rescheduled")
		byID := map[string]Occurrence{}
		for _, o := range after {
			byID[o.ID] = o
		}
		for i, o := range occs {
			n, ok := byID[o.ID]
			if !ok {
				t.Fatalf("occurrence %d lost its row", i)
			}
			if i == 3 {
				if !n.StartsAt.Equal(mustTime("2026-12-22T14:00:00Z")) || n.Title != "Renamed" {
					t.Fatalf("the changed session keeps its time and gets the title: %+v", n)
				}
				continue
			}
			if n.StartsAt.UTC().Hour() != 9 || n.StartsAt.Minute() != 30 {
				t.Fatalf("occurrence %d at %s", i, n.StartsAt)
			}
		}
	})

	t.Run("following splits and keeps ids", func(t *testing.T) {
		occs := series()
		got, _ := patch(occs[2].ID, map[string]any{"scope": "following", "title": "Advanced", "duration_minutes": 90})
		if got.EventID == occs[2].EventID || got.ID != occs[2].ID || got.Title != "Advanced" || got.EndsAt.Sub(got.StartsAt) != 90*time.Minute {
			t.Fatalf("following: %+v", got)
		}
		var old, fresh struct{ Data Event }
		e.do(b, "GET", "/api/v1/scheduling/events/"+occs[0].EventID, nil, 200, &old)
		e.do(b, "GET", "/api/v1/scheduling/events/"+got.EventID, nil, 200, &fresh)
		if r := old.Data.Recurrence; r == nil || r.Count != 2 || old.Data.Sequence != 1 {
			t.Fatalf("old series ends before the split: %+v", r)
		}
		if r := fresh.Data.Recurrence; r == nil || r.Count != 4 || fresh.Data.StartsLocal != "2026-12-15T09:00" {
			t.Fatalf("new series: %+v", fresh.Data)
		}
		for i := 2; i < 6; i++ {
			if o := e.occurrence(b, occs[i].ID); o.EventID != got.EventID || o.Title != "Advanced" {
				t.Fatalf("occurrence %d not moved: %+v", i, o)
			}
		}
		if o := e.occurrence(b, occs[1].ID); o.EventID != occs[1].EventID || o.Title != "Lesson" {
			t.Fatalf("earlier ones stay: %+v", o)
		}
	})

	t.Run("rule change cancels slots that are gone", func(t *testing.T) {
		occs := series()
		patch(occs[0].ID, map[string]any{"scope": "all", "recurrence": map[string]any{"freq": "weekly", "interval": 2, "count": 3}})
		var cancelled, open int
		for _, o := range occs {
			switch e.occurrence(b, o.ID).Status {
			case "cancelled_on_time":
				cancelled++
			case "scheduled":
				open++
			}
		}
		if cancelled != 3 || open != 3 {
			t.Fatalf("every 2 weeks, 3 sessions: %d cancelled, %d open", cancelled, open)
		}
	})

	t.Run("closed sessions refuse edits", func(t *testing.T) {
		occs := series()
		e.do(b, "POST", "/api/v1/scheduling/occurrences/"+occs[0].ID+"/cancel", map[string]any{"as": "on_time"}, 200, nil)
		e.fails(b, "PATCH", "/api/v1/scheduling/occurrences/"+occs[0].ID, map[string]any{"title": "x"}, 409, "occurrence_closed")
	})
}

func TestCancelPolicyAndScopes(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	out := e.create(b, map[string]any{"client_id": c, "title": "Lesson", "starts_local": "2026-11-17T09:00", "duration_minutes": 60,
		"recurrence": map[string]any{"freq": "weekly", "count": 4}})
	occs := out.Data.Occurrences
	// Tuesday 09:00, 24 h notice: now (Monday 10:00) is past the deadline, so the default is late.
	var got struct{ Data Occurrence }
	e.do(b, "POST", "/api/v1/scheduling/occurrences/"+occs[0].ID+"/cancel", map[string]any{}, 200, &got)
	if got.Data.Status != "cancelled_late" || !got.Data.Late || !got.Data.Counts {
		t.Fatalf("late by policy: %+v", got.Data)
	}
	e.do(b, "POST", "/api/v1/scheduling/occurrences/"+occs[1].ID+"/cancel", map[string]any{"scope": "following"}, 200, &got)
	for _, o := range occs[1:] {
		if st := e.occurrence(b, o.ID).Status; st != "cancelled_on_time" {
			t.Fatalf("following: %s", st)
		}
	}
}
