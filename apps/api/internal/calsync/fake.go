package calsync

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Fake is an in-memory Google Calendar and Microsoft Graph, OAuth included: the Go tests run calsync against it, and
// with HELVETLY_E2E_FAKE_CALENDARS the binary serves it under /api/test/fake-calendars for end-to-end tests (connect,
// push, an outside move, disconnect) with no real account. It keeps only what calsync uses.
type Fake struct {
	mu        sync.Mutex
	accounts  map[string]*FakeAccount // per provider
	grants    map[string]fakeGrant    // code or refresh token → grant
	access    map[string]string       // access token → provider
	events    map[string]map[string]*FakeEvent
	watches   map[string]string // channel or subscription id → its secret (channel token or clientState)
	version   int
	failures  map[string][]int // per provider: statuses to answer the next API calls with
	expireAll bool             // sync tokens and delta links answer 410
}

// FakeAccount is the account a provider's sign-in connects. Scope "" grants what was asked for.
type FakeAccount struct {
	Subject, Email string
	Scope          string
	Personal       bool // a personal Microsoft account: no Teams meetings
}

// FakeEvent is an event in a fake calendar.
type FakeEvent struct {
	ID, Summary, Location, Meeting string
	Start, End                     time.Time
	Free, Removed                  bool
	Props                          map[string]string
	version                        int
}

type fakeGrant struct{ provider, clientID, nonce, scope string }

const fakePath = "/api/test/fake-calendars"

func NewFake() *Fake {
	return &Fake{accounts: map[string]*FakeAccount{
		"google":    {Subject: "g-100", Email: "host@gmail.test"},
		"microsoft": {Subject: "m-100", Email: "host@outlook.test"},
	}, grants: map[string]fakeGrant{}, access: map[string]string{}, events: map[string]map[string]*FakeEvent{},
		watches: map[string]string{}, failures: map[string][]int{}}
}

// Account changes the account a provider's next sign-in connects.
func (f *Fake) Account(provider string, a FakeAccount) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.accounts[provider] = &a
}

// Revoke makes every token of the provider invalid, as a member removing the app's access does.
func (f *Fake) Revoke(provider string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for k, g := range f.grants {
		if g.provider == provider {
			delete(f.grants, k)
		}
	}
	for k, p := range f.access {
		if p == provider {
			delete(f.access, k)
		}
	}
}

// Fail answers the provider's next API calls with these statuses (429 and 503 carry Retry-After: 1).
func (f *Fake) Fail(provider string, statuses ...int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failures[provider] = append(f.failures[provider], statuses...)
}

// ExpireSync makes every sync token and delta link invalid (410) until a full sync made new ones.
func (f *Fake) ExpireSync() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.expireAll = true
}

// PrimaryCalendar is the id of the provider's default calendar.
func (f *Fake) PrimaryCalendar(provider string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.primary(provider)
}

func (f *Fake) primary(provider string) string {
	if provider == "google" {
		return f.accounts["google"].Email
	}
	return "AAMk-default"
}

func (f *Fake) calendars(provider string) [][2]string {
	if provider == "google" {
		return [][2]string{{f.primary(provider), f.accounts["google"].Email}, {"work@group.calendar.google.test", "Work"}}
	}
	return [][2]string{{"AAMk-default", "Calendar"}, {"AAMk-work", "Work"}}
}

func (f *Fake) cal(provider, cal string) map[string]*FakeEvent {
	key := provider + "|" + cal
	if f.events[key] == nil {
		f.events[key] = map[string]*FakeEvent{}
	}
	return f.events[key]
}

// Events lists a calendar's events that were not removed, by start.
func (f *Fake) Events(provider, cal string) []FakeEvent {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []FakeEvent
	for _, e := range f.cal(provider, cal) {
		if !e.Removed {
			out = append(out, *e)
		}
	}
	slices.SortFunc(out, func(a, b FakeEvent) int { return a.Start.Compare(b.Start) })
	return out
}

// AddEvent puts an event of the member's own in a calendar and returns its id.
func (f *Fake) AddEvent(provider, cal string, start, end time.Time, free bool) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := "ev" + strings.ToLower(rand.Text()[:10])
	f.version++
	f.cal(provider, cal)[id] = &FakeEvent{ID: id, Summary: "Private", Start: start.UTC(), End: end.UTC(), Free: free, version: f.version}
	return id
}

// Move changes an event's times, as the member dragging it in their calendar.
func (f *Fake) Move(provider, cal, id string, start, end time.Time) bool {
	return f.change(provider, cal, id, func(e *FakeEvent) { e.Start, e.End = start.UTC(), end.UTC() })
}

// Remove deletes an event, as the member deleting it in their calendar.
func (f *Fake) Remove(provider, cal, id string) bool {
	return f.change(provider, cal, id, func(e *FakeEvent) { e.Removed = true })
}

func (f *Fake) change(provider, cal, id string, fn func(*FakeEvent)) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	e := f.cal(provider, cal)[id]
	if e == nil {
		return false
	}
	f.version++
	fn(e)
	e.version = f.version
	return true
}

// Watches maps the open channels and subscriptions to the secret each notification carries.
func (f *Fake) Watches() map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return maps.Clone(f.watches)
}

// Handler serves both providers: /google/… and /microsoft/…, plus /{provider}/_test/{move,remove,busy} for
// end-to-end tests.
func (f *Fake) Handler() http.Handler {
	mux := http.NewServeMux()
	for _, p := range []string{"google", "microsoft"} {
		authorize := map[string]string{"google": "/google/auth", "microsoft": "/microsoft/authorize"}[p]
		mux.HandleFunc("GET "+authorize, f.authorize(p))
		mux.HandleFunc("POST /"+p+"/token", f.token(p))
		mux.HandleFunc("POST /"+p+"/_test/{action}", f.control(p))
	}
	g := "/google/calendar/v3"
	mux.HandleFunc("POST /google/revoke", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		delete(f.grants, r.FormValue("token"))
		f.mu.Unlock()
	})
	mux.HandleFunc("GET "+g+"/users/me/calendarList", f.api("google", f.googleCalendars))
	mux.HandleFunc("GET "+g+"/calendars/{cal}/events", f.api("google", f.googleList))
	mux.HandleFunc("POST "+g+"/calendars/{cal}/events", f.api("google", f.googleCreate))
	mux.HandleFunc("GET "+g+"/calendars/{cal}/events/{id}", f.api("google", f.googleGet))
	mux.HandleFunc("PATCH "+g+"/calendars/{cal}/events/{id}", f.api("google", f.googleUpdate))
	mux.HandleFunc("DELETE "+g+"/calendars/{cal}/events/{id}", f.api("google", f.remove("google")))
	mux.HandleFunc("POST "+g+"/calendars/{cal}/events/watch", f.api("google", f.googleWatch))
	mux.HandleFunc("POST "+g+"/channels/stop", f.api("google", f.googleStop))
	m := "/microsoft/v1.0"
	mux.HandleFunc("GET "+m+"/me/calendars", f.api("microsoft", f.msCalendars))
	mux.HandleFunc("POST "+m+"/me/calendars/{cal}/events", f.api("microsoft", f.msCreate))
	mux.HandleFunc("PATCH "+m+"/me/calendars/{cal}/events/{id}", f.api("microsoft", f.msUpdate))
	mux.HandleFunc("DELETE "+m+"/me/calendars/{cal}/events/{id}", f.api("microsoft", f.remove("microsoft")))
	mux.HandleFunc("GET "+m+"/me/calendars/{cal}/calendarView/delta", f.api("microsoft", f.msDelta))
	mux.HandleFunc("POST "+m+"/subscriptions", f.api("microsoft", f.msSubscribe))
	mux.HandleFunc("DELETE "+m+"/subscriptions/{id}", f.api("microsoft", f.msUnsubscribe))
	return mux
}

func fakeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (f *Fake) authorize(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		redirect, err := url.Parse(q.Get("redirect_uri"))
		if err != nil || q.Get("state") == "" || q.Get("code_challenge") == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		code := "code-" + rand.Text()
		f.mu.Lock()
		scope := q.Get("scope")
		if a := f.accounts[provider]; a.Scope != "" {
			scope = a.Scope
		}
		f.grants[code] = fakeGrant{provider: provider, clientID: q.Get("client_id"), nonce: q.Get("nonce"), scope: scope}
		f.mu.Unlock()
		back := redirect.Query()
		back.Set("code", code)
		back.Set("state", q.Get("state"))
		redirect.RawQuery = back.Encode()
		http.Redirect(w, r, redirect.String(), http.StatusFound)
	}
}

func (f *Fake) token(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.FormValue("code")
		if r.FormValue("grant_type") == "refresh_token" {
			key = r.FormValue("refresh_token")
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		g, ok := f.grants[key]
		if !ok || g.provider != provider {
			fakeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
			return
		}
		access, refresh := "at-"+rand.Text(), key
		f.access[access] = provider
		out := map[string]any{"access_token": access, "token_type": "Bearer", "expires_in": 3600, "scope": g.scope}
		if r.FormValue("grant_type") != "refresh_token" {
			delete(f.grants, key)
			refresh = "rt-" + rand.Text()
			f.grants[refresh] = g
			out["refresh_token"] = refresh
			a := f.accounts[provider]
			claims := map[string]any{"aud": g.clientID, "nonce": g.nonce, "exp": time.Now().Add(time.Hour).Unix(), "sub": a.Subject,
				"oid": a.Subject, "email": a.Email, "email_verified": true, "preferred_username": a.Email}
			raw, _ := json.Marshal(claims)
			out["id_token"] = "eyJhbGciOiJub25lIn0." + base64.RawURLEncoding.EncodeToString(raw) + ".sig"
		}
		fakeJSON(w, http.StatusOK, out)
	}
}

// api checks the bearer token and the queued failures before h.
func (f *Fake) api(provider string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		status := 0
		if q := f.failures[provider]; len(q) > 0 {
			status, f.failures[provider] = q[0], q[1:]
		}
		ok := f.access[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")] == provider
		f.mu.Unlock()
		switch {
		case status != 0:
			if status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable {
				w.Header().Set("Retry-After", "1")
			}
			fakeJSON(w, status, map[string]any{"error": map[string]any{"code": status}})
		case !ok:
			fakeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]any{"code": 401}})
		default:
			h(w, r)
		}
	}
}

func (f *Fake) control(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Calendar string    `json:"calendar"`
			ID       string    `json:"id"`
			Start    time.Time `json:"start"`
			End      time.Time `json:"end"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		in.Calendar = cmpOr(in.Calendar, f.PrimaryCalendar(provider))
		ok := true
		switch r.PathValue("action") {
		case "move":
			ok = f.Move(provider, in.Calendar, in.ID, in.Start, in.End)
		case "remove":
			ok = f.Remove(provider, in.Calendar, in.ID)
		case "busy":
			in.ID = f.AddEvent(provider, in.Calendar, in.Start, in.End, false)
		case "events": // the calendar's events, so an end-to-end test finds the one a session was pushed as
			fakeJSON(w, http.StatusOK, map[string]any{"events": f.Events(provider, in.Calendar), "calendar": in.Calendar})
			return
		default:
			ok = false
		}
		if !ok {
			http.NotFound(w, r)
			return
		}
		fakeJSON(w, http.StatusOK, map[string]string{"id": in.ID, "calendar": in.Calendar})
	}
}

func (f *Fake) remove(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !f.Remove(provider, r.PathValue("cal"), r.PathValue("id")) {
			fakeJSON(w, http.StatusNotFound, map[string]any{})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// sinceToken: the version a sync token names; ok false when it is expired or not one of ours.
func (f *Fake) sinceToken(token string) (int, bool) {
	if f.expireAll {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimPrefix(token, "v"))
	return n, err == nil
}

// changed lists a calendar's events changed after version since (all live ones for since < 0), by id.
func (f *Fake) changed(provider, cal string, since int) []*FakeEvent {
	var out []*FakeEvent
	for _, e := range f.cal(provider, cal) {
		if (since < 0 && !e.Removed) || (since >= 0 && e.version > since) {
			out = append(out, e)
		}
	}
	slices.SortFunc(out, func(a, b *FakeEvent) int { return strings.Compare(a.ID, b.ID) })
	return out
}

func (f *Fake) newEvent(provider, cal string, e FakeEvent) *FakeEvent {
	f.version++
	e.ID, e.version = "ev"+strings.ToLower(rand.Text()[:10]), f.version
	f.cal(provider, cal)[e.ID] = &e
	return &e
}

// Google

type fakeGoogleEvent struct {
	ID                 string `json:"id"`
	Status             string `json:"status,omitempty"`
	Summary            string `json:"summary,omitempty"`
	Location           string `json:"location,omitempty"`
	Transparency       string `json:"transparency,omitempty"`
	HangoutLink        string `json:"hangoutLink,omitempty"`
	ETag               string `json:"etag"`
	Start              gTime  `json:"start"`
	End                gTime  `json:"end"`
	ExtendedProperties gProps `json:"extendedProperties"`
}

func googleView(e *FakeEvent) fakeGoogleEvent {
	v := fakeGoogleEvent{ID: e.ID, Summary: e.Summary, Location: e.Location, HangoutLink: e.Meeting, ETag: fmt.Sprintf(`"%d"`, e.version),
		Start: gTime{DateTime: e.Start.Format(time.RFC3339)}, End: gTime{DateTime: e.End.Format(time.RFC3339)},
		ExtendedProperties: gProps{Private: e.Props}}
	if e.Removed {
		v.Status = "cancelled"
	}
	if e.Free {
		v.Transparency = "transparent"
	}
	return v
}

func (f *Fake) googleCalendars(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var items []map[string]any
	for i, c := range f.calendars("google") {
		items = append(items, map[string]any{"id": c[0], "summary": c[1], "primary": i == 0, "backgroundColor": []string{"#9FE1E7", "#a47ae2"}[i%2]})
	}
	fakeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (f *Fake) googleList(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	since := -1
	if t := r.URL.Query().Get("syncToken"); t != "" {
		n, ok := f.sinceToken(t)
		if !ok {
			fakeJSON(w, http.StatusGone, map[string]any{"error": map[string]any{"code": 410}})
			return
		}
		since = n
	} else {
		f.expireAll = false
	}
	items := []fakeGoogleEvent{}
	for _, e := range f.changed("google", r.PathValue("cal"), since) {
		items = append(items, googleView(e))
	}
	fakeJSON(w, http.StatusOK, map[string]any{"timeZone": "Europe/Zurich", "items": items, "nextSyncToken": fmt.Sprintf("v%d", f.version)})
}

func decodeGoogle(r *http.Request) (gEvent, FakeEvent, error) {
	var in gEvent
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		return in, FakeEvent{}, err
	}
	e := FakeEvent{Summary: in.Summary, Location: in.Location}
	if in.ExtendedProperties != nil {
		e.Props = in.ExtendedProperties.Private
	}
	if in.Start != nil && in.End != nil {
		e.Start, _ = time.Parse(time.RFC3339, in.Start.DateTime)
		e.End, _ = time.Parse(time.RFC3339, in.End.DateTime)
	}
	return in, e, nil
}

func (f *Fake) googleCreate(w http.ResponseWriter, r *http.Request) {
	in, e, err := decodeGoogle(r)
	if err != nil || r.URL.Query().Get("sendUpdates") != "none" || e.End.IsZero() {
		fakeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad event"})
		return
	}
	if in.ConferenceData != nil && in.ConferenceData.CreateRequest != nil && r.URL.Query().Get("conferenceDataVersion") == "1" {
		e.Meeting = "https://meet.google.com/fake-" + strings.ToLower(rand.Text()[:8])
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	fakeJSON(w, http.StatusOK, googleView(f.newEvent("google", r.PathValue("cal"), e)))
}

func (f *Fake) googleGet(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	e := f.cal("google", r.PathValue("cal"))[r.PathValue("id")]
	if e == nil {
		fakeJSON(w, http.StatusNotFound, map[string]any{})
		return
	}
	fakeJSON(w, http.StatusOK, googleView(e))
}

func (f *Fake) googleUpdate(w http.ResponseWriter, r *http.Request) {
	_, in, err := decodeGoogle(r)
	if err != nil || r.URL.Query().Get("sendUpdates") != "none" {
		fakeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad event"})
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	e := f.cal("google", r.PathValue("cal"))[r.PathValue("id")]
	if e == nil {
		fakeJSON(w, http.StatusNotFound, map[string]any{})
		return
	}
	f.version++
	e.Summary, e.Location, e.Start, e.End, e.Props, e.version = in.Summary, in.Location, in.Start, in.End, in.Props, f.version
	fakeJSON(w, http.StatusOK, googleView(e)) // a removed event stays cancelled, as Google answers
}

func (f *Fake) googleWatch(w http.ResponseWriter, r *http.Request) {
	var in struct{ ID, Address, Token string }
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.ID == "" || in.Token == "" || in.Address == "" {
		fakeJSON(w, http.StatusBadRequest, map[string]any{})
		return
	}
	f.mu.Lock()
	f.watches[in.ID] = in.Token
	f.mu.Unlock()
	fakeJSON(w, http.StatusOK, map[string]any{"id": in.ID, "resourceId": "res-" + in.ID,
		"expiration": strconv.FormatInt(time.Now().Add(googleWatchTL).UnixMilli(), 10)})
}

func (f *Fake) googleStop(w http.ResponseWriter, r *http.Request) {
	var in struct{ ID string }
	_ = json.NewDecoder(r.Body).Decode(&in)
	f.mu.Lock()
	_, ok := f.watches[in.ID]
	delete(f.watches, in.ID)
	f.mu.Unlock()
	if !ok {
		fakeJSON(w, http.StatusNotFound, map[string]any{})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Microsoft

func msView(e *FakeEvent) map[string]any {
	if e.Removed {
		return map[string]any{"id": e.ID, "@removed": map[string]string{"reason": "deleted"}}
	}
	v := map[string]any{"id": e.ID, "@odata.etag": fmt.Sprintf(`W/"%d"`, e.version), "subject": e.Summary, "showAs": "busy",
		"start": msTime{DateTime: e.Start.UTC().Format(msTimeFormat) + ".0000000", TimeZone: "UTC"},
		"end":   msTime{DateTime: e.End.UTC().Format(msTimeFormat) + ".0000000", TimeZone: "UTC"}}
	if e.Free {
		v["showAs"] = "free"
	}
	if e.Meeting != "" {
		v["onlineMeeting"] = map[string]string{"joinUrl": e.Meeting}
	}
	return v
}

func (f *Fake) msCalendars(w http.ResponseWriter, _ *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var items []map[string]any
	for i, c := range f.calendars("microsoft") {
		items = append(items, map[string]any{"id": c[0], "name": c[1], "isDefaultCalendar": i == 0})
	}
	fakeJSON(w, http.StatusOK, map[string]any{"value": items})
}

func decodeMS(r *http.Request) (map[string]any, FakeEvent, error) {
	var in struct {
		Subject  string            `json:"subject"`
		Start    msTime            `json:"start"`
		End      msTime            `json:"end"`
		Location map[string]string `json:"location"`
	}
	var raw map[string]any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return nil, FakeEvent{}, err
	}
	b, _ := json.Marshal(raw)
	if err := json.Unmarshal(b, &in); err != nil {
		return nil, FakeEvent{}, err
	}
	e := FakeEvent{Summary: in.Subject, Location: in.Location["displayName"]}
	e.Start, _ = in.Start.instant()
	e.End, _ = in.End.instant()
	return raw, e, nil
}

func (f *Fake) msCreate(w http.ResponseWriter, r *http.Request) {
	raw, e, err := decodeMS(r)
	if err != nil || e.End.IsZero() {
		fakeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad event"})
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if raw["isOnlineMeeting"] == true && !f.accounts["microsoft"].Personal {
		e.Meeting = "https://teams.microsoft.com/l/meetup-join/fake-" + strings.ToLower(rand.Text()[:8])
	}
	fakeJSON(w, http.StatusCreated, msView(f.newEvent("microsoft", r.PathValue("cal"), e)))
}

func (f *Fake) msUpdate(w http.ResponseWriter, r *http.Request) {
	_, in, err := decodeMS(r)
	if err != nil {
		fakeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad event"})
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	e := f.cal("microsoft", r.PathValue("cal"))[r.PathValue("id")]
	if e == nil || e.Removed {
		fakeJSON(w, http.StatusNotFound, map[string]any{})
		return
	}
	f.version++
	e.Summary, e.Location, e.Start, e.End, e.version = in.Summary, in.Location, in.Start, in.End, f.version
	fakeJSON(w, http.StatusOK, msView(e))
}

func (f *Fake) msDelta(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	since := -1
	if t := r.URL.Query().Get("$deltatoken"); t != "" {
		n, ok := f.sinceToken(t)
		if !ok {
			fakeJSON(w, http.StatusGone, map[string]any{"error": map[string]any{"code": "SyncStateNotFound"}})
			return
		}
		since = n
	} else if r.URL.Query().Get("startDateTime") == "" {
		fakeJSON(w, http.StatusBadRequest, map[string]any{})
		return
	} else {
		f.expireAll = false
	}
	items := []map[string]any{}
	for _, e := range f.changed("microsoft", r.PathValue("cal"), since) {
		items = append(items, msView(e))
	}
	self, _, _ := strings.Cut(r.RequestURI, "?")
	fakeJSON(w, http.StatusOK, map[string]any{"value": items,
		"@odata.deltaLink": "http://" + r.Host + self + "?$deltatoken=v" + strconv.Itoa(f.version)})
}

func (f *Fake) msSubscribe(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Resource, NotificationURL, ClientState, LifecycleNotificationURL string
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.ClientState == "" || in.NotificationURL == "" || in.LifecycleNotificationURL == "" {
		fakeJSON(w, http.StatusBadRequest, map[string]any{})
		return
	}
	id := "sub-" + strings.ToLower(rand.Text()[:12])
	f.mu.Lock()
	f.watches[id] = in.ClientState
	f.mu.Unlock()
	fakeJSON(w, http.StatusCreated, map[string]any{"id": id, "expirationDateTime": time.Now().Add(msWatchTTL).UTC().Format(time.RFC3339)})
}

func (f *Fake) msUnsubscribe(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	_, ok := f.watches[r.PathValue("id")]
	delete(f.watches, r.PathValue("id"))
	f.mu.Unlock()
	if !ok {
		fakeJSON(w, http.StatusNotFound, map[string]any{})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
