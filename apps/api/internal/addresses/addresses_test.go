package addresses

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

const photonBerlin = `{"features":[
 {"geometry":{"coordinates":[13.3777,52.5163]},"properties":{"name":"Brandenburger Tor","street":"Pariser Platz","housenumber":"1","postcode":"10117","city":"Berlin","country":"Germany","countrycode":"DE"}},
 {"geometry":{"coordinates":[8.5417,47.3769]},"properties":{"street":"Bahnhofstrasse","housenumber":"1","postcode":"8001","city":"Zürich","country":"Switzerland","countrycode":"CH"}},
 {"geometry":{"coordinates":[8.5417,47.3769]},"properties":{"street":"Bahnhofstrasse","housenumber":"1","postcode":"8001","city":"Zürich","country":"Switzerland","countrycode":"CH"}},
 {"geometry":{"coordinates":[11.0,48.0]},"properties":{"name":"Seehof","village":"Kochel","postcode":"82431","country":"Germany","countrycode":"DE"}}]}`

// fake answers like one provider: its body, a status, or a delay; it records the queries it got.
type fake struct {
	body    string
	status  int
	delay   time.Duration
	calls   atomic.Int32
	queries chan string
	agents  chan string
}

func (f *fake) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	if f.queries != nil {
		f.queries <- r.URL.RawQuery
	}
	if f.agents != nil {
		f.agents <- r.UserAgent()
	}
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if f.status != 0 {
		w.WriteHeader(f.status)
		return
	}
	_, _ = io.WriteString(w, f.body)
}

func serve(t *testing.T, f *fake) string {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return srv.URL + "/api/"
}

func TestSuggest(t *testing.T) {
	for _, tc := range []struct {
		name           string
		photon         *fake
		query, country string
		want           []string // labels
		calls          int32
	}{
		{name: "own country first", photon: &fake{body: photonBerlin}, query: "Pariser Platz", country: "de",
			want:  []string{"Brandenburger Tor, Pariser Platz 1, 10117 Berlin", "Seehof, 82431 Kochel", "Bahnhofstrasse 1, 8001 Zürich, Switzerland"},
			calls: 1},
		{name: "another country names its country", photon: &fake{body: photonBerlin}, query: "Bahnhofstrasse", country: "CH",
			want:  []string{"Bahnhofstrasse 1, 8001 Zürich", "Brandenburger Tor, Pariser Platz 1, 10117 Berlin, Germany", "Seehof, 82431 Kochel, Germany"},
			calls: 1},
		{name: "down: empty", photon: &fake{status: 503}, query: "Bahnhofstrasse", country: "CH", want: []string{}, calls: 1},
		{name: "not JSON: empty", photon: &fake{body: "<html>"}, query: "Bahnhofstrasse", country: "CH", want: []string{}, calls: 1},
		{name: "too short", photon: &fake{body: photonBerlin}, query: " Bu ", country: "CH", want: []string{}},
		{name: "too long", photon: &fake{body: photonBerlin}, query: strings.Repeat("a", 201), country: "CH", want: []string{}},
		{name: "slow answer times out", photon: &fake{body: photonBerlin, delay: 300 * time.Millisecond},
			query: "Bahnhofstrasse", country: "CH", want: []string{}, calls: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := New(serve(t, tc.photon))
			s.http.Timeout = 100 * time.Millisecond
			labels := []string{}
			for _, a := range s.Suggest(context.Background(), "ws1", tc.query, tc.country, "en") {
				labels = append(labels, a.Label)
			}
			if strings.Join(labels, "|") != strings.Join(tc.want, "|") {
				t.Errorf("labels %q, want %q", labels, tc.want)
			}
			if n := tc.photon.calls.Load(); n != tc.calls {
				t.Errorf("calls %d, want %d", n, tc.calls)
			}
		})
	}
}

func TestSuggestRequest(t *testing.T) {
	for _, tc := range []struct {
		name, country, lang string
		has, lacks          []string
	}{
		{"biased to the country, in the language", "CH", "de", []string{"q=Bahnhofstrasse+1", "lang=de", "lat=46.8", "lon=8.2", "zoom=6", "limit=10"}, nil},
		{"unknown country, unsupported language", "XX", "pl", []string{"q=Bahnhofstrasse+1"}, []string{"lang=", "lat=", "lon="}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &fake{body: photonBerlin, queries: make(chan string, 1), agents: make(chan string, 1)}
			got := New(serve(t, f)).Suggest(context.Background(), "ws1", "Bahnhofstrasse 1", tc.country, tc.lang)
			if len(got) != 3 {
				t.Fatalf("got %d", len(got))
			}
			q := <-f.queries
			for _, part := range tc.has {
				if !strings.Contains(q, part) {
					t.Errorf("query %q lacks %q", q, part)
				}
			}
			for _, part := range tc.lacks {
				if strings.Contains(q, part) {
					t.Errorf("query %q has %q", q, part)
				}
			}
			if ua := <-f.agents; !strings.HasPrefix(ua, "Helvetly address suggestions") {
				t.Errorf("User-Agent %q", ua)
			}
		})
	}
}

func TestSuggestFields(t *testing.T) {
	got := New(serve(t, &fake{body: photonBerlin})).Suggest(context.Background(), "ws1", "Bahnhofstrasse", "CH", "en")
	want := Address{Label: "Bahnhofstrasse 1, 8001 Zürich", Street: "Bahnhofstrasse", HouseNumber: "1", Postcode: "8001", City: "Zürich",
		Country: "CH", Lat: 47.3769, Lon: 8.5417}
	if len(got) != 3 || got[0] != want {
		t.Fatalf("got %+v, want first %+v", got, want)
	}
	if got[2].City != "Kochel" || got[2].Street != "Seehof" {
		t.Errorf("a village's place without a street: %+v", got[2])
	}
}

func TestCache(t *testing.T) {
	ph := &fake{body: photonBerlin}
	s := New(serve(t, ph))
	now := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	for _, q := range []string{"Bundesplatz 3", "bundesplatz  3 "} {
		if got := s.Suggest(context.Background(), "ws1", q, "CH", "en"); len(got) != 3 {
			t.Fatalf("%q: %d results", q, len(got))
		}
	}
	if n := ph.calls.Load(); n != 1 {
		t.Fatalf("calls %d, want 1 (cached)", n)
	}
	s.Suggest(context.Background(), "ws1", "Bundesplatz 3", "DE", "en") // another country, another key
	s.Suggest(context.Background(), "ws1", "Bundesplatz 3", "CH", "de") // another language too
	if n := ph.calls.Load(); n != 3 {
		t.Fatalf("calls %d, want 3 (country and language keyed)", n)
	}
	now = now.Add(ttl + time.Second)
	s.Suggest(context.Background(), "ws1", "Bundesplatz 3", "CH", "en")
	if n := ph.calls.Load(); n != 4 {
		t.Fatalf("calls %d after expiry, want 4", n)
	}
}

func TestFailureNotCached(t *testing.T) {
	ph := &fake{status: 500}
	s := New(serve(t, ph))
	s.Suggest(context.Background(), "ws1", "Bundesplatz", "CH", "en")
	ph.status, ph.body = 0, photonBerlin
	if got := s.Suggest(context.Background(), "ws1", "Bundesplatz", "CH", "en"); len(got) != 3 {
		t.Fatalf("got %d after recovery, want 3", len(got))
	}
}

func TestRateLimit(t *testing.T) {
	ph := &fake{body: photonBerlin}
	s := New(serve(t, ph))
	now := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	ask := func(ws string, i int) []Address {
		return s.Suggest(context.Background(), ws, "Bundesplatz "+strconv.Itoa(i), "CH", "en")
	}
	for i := range perWorkspace {
		if len(ask("ws1", i)) == 0 {
			t.Fatalf("call %d refused", i)
		}
	}
	if got := ask("ws1", perWorkspace); len(got) != 0 {
		t.Fatalf("workspace over its limit got %d", len(got))
	}
	if got := s.Suggest(context.Background(), "ws1", "Bundesplatz new", "CH", "en"); len(got) != 0 {
		t.Fatalf("new query over the limit got %d", len(got))
	}
	if got := s.Suggest(context.Background(), "ws1", "Bundesplatz 0", "CH", "en"); len(got) != 3 {
		t.Fatalf("a cached answer is free, got %d", len(got))
	}
	// Other workspaces share the instance's budget only.
	for i := range perMinute - perWorkspace {
		if len(ask(string(rune('a'+i%26))+strings.Repeat("w", i/26), i+100)) == 0 {
			t.Fatalf("instance call %d refused", i)
		}
	}
	if got := ask("fresh", 999); len(got) != 0 {
		t.Fatalf("instance over its limit got %d", len(got))
	}
	now = now.Add(time.Minute)
	if got := ask("ws1", 1000); len(got) != 3 {
		t.Fatalf("a minute later got %d", len(got))
	}
}

type fakeAuth struct{}

func (fakeAuth) SignedIn(h func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h(w, r, store.Session{Workspace: store.Workspace{ID: "ws1"}})
	}
}

func TestRoutes(t *testing.T) {
	ph := &fake{body: photonBerlin}
	for _, tc := range []struct {
		name string
		svc  *Service
		path string
		want string
	}{
		{"suggest", New(serve(t, ph)), "/api/v1/addresses/suggest?q=Bundesplatz+3&country=CH", `"label":"Bahnhofstrasse 1, 8001 Zürich"`},
		{"too short", New(serve(t, ph)), "/api/v1/addresses/suggest?q=Bu&country=CH", `{"data":[]}`},
		{"turned off", nil, "/api/v1/addresses/suggest?q=Bundesplatz&country=CH", `{"data":[]}`},
		{"provider down", New(serve(t, &fake{status: 500})), "/api/v1/addresses/suggest?q=Bundesplatz&country=CH", `{"data":[]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mux := http.NewServeMux()
			Routes(mux, fakeAuth{}, tc.svc)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), tc.want) || !json.Valid(rec.Body.Bytes()) {
				t.Fatalf("%d %s, want 200 with %s", rec.Code, rec.Body.String(), tc.want)
			}
		})
	}
}
