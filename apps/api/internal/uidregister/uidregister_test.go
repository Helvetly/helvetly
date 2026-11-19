package uidregister

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

const emptyResult = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><SearchResponse xmlns="http://www.uid.admin.ch/xmlns/uid-wse"><SearchResult/></SearchResponse></s:Body></s:Envelope>`

const fault = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>Request_limit_exceeded</faultstring></s:Fault></s:Body></s:Envelope>`

// fakeRegister answers like UID-WSE: the recorded search response for a name, an empty result for an unknown UID.
type fakeRegister struct {
	calls  atomic.Int32
	status int
	delay  time.Duration
	bodies []string
}

func (f *fakeRegister) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	raw, _ := io.ReadAll(r.Body)
	f.bodies = append(f.bodies, string(raw))
	if r.Header.Get("SOAPAction") != `"http://www.uid.admin.ch/xmlns/uid-wse/IPublicServices/Search"` {
		http.Error(w, "unknown action", http.StatusBadRequest)
		return
	}
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if f.status != 0 {
		w.WriteHeader(f.status)
		_, _ = io.WriteString(w, fault)
		return
	}
	switch {
	case strings.Contains(string(raw), "<e97:uidOrganisationId>102753938<"),
		strings.Contains(string(raw), "<ns:organisationName>Swisscom</ns:organisationName>"):
		recorded, _ := os.ReadFile("testdata/search.xml")
		_, _ = w.Write(recorded)
	default:
		_, _ = io.WriteString(w, emptyResult)
	}
}

func newService(t *testing.T, f *fakeRegister) *Service {
	t.Helper()
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	s := New(srv.URL)
	s.http.Timeout = 200 * time.Millisecond
	return s
}

var swisscom = Company{UID: "CHE-102.753.938", Name: "Swisscom AG", Street: "Alte Tiefenaustrasse", HouseNumber: "6",
	Zip: "3050", City: "Bern", Canton: "BE", Active: true, VAT: true}

func TestSearch(t *testing.T) {
	for _, tc := range []struct {
		name    string
		query   string
		status  int
		delay   time.Duration
		first   *Company
		count   int
		calls   int32
		wantErr error
	}{
		{"by name", "Swisscom", 0, 0, &swisscom, 3, 1, nil},
		{"by name, extra spaces", "  Swisscom ", 0, 0, &swisscom, 3, 1, nil},
		{"by UID", "CHE-102.753.938", 0, 0, &swisscom, 1, 1, nil},
		{"by UID with VAT suffix and no dots", "che102753938 MWST", 0, 0, &swisscom, 1, 1, nil},
		{"unknown name", "Nobody GmbH", 0, 0, nil, 0, 1, nil},
		{"wrong check digit is a name search", "CHE-102.753.939", 0, 0, nil, 0, 1, nil},
		{"too short: no call", "S", 0, 0, nil, 0, 0, nil},
		{"fault", "Swisscom", http.StatusInternalServerError, 0, nil, 0, 1, ErrUnavailable},
		{"timeout", "Swisscom", 0, time.Second, nil, 0, 1, ErrUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeRegister{status: tc.status, delay: tc.delay}
			s := newService(t, f)
			got, err := s.Search(context.Background(), tc.query)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			if f.calls.Load() != tc.calls {
				t.Errorf("calls = %d, want %d", f.calls.Load(), tc.calls)
			}
			if tc.wantErr != nil {
				return
			}
			if tc.first == nil {
				if len(got) != 0 {
					t.Fatalf("got %v, want none", got)
				}
				return
			}
			// A UID search keeps the one company asked for, though the recorded answer has three.
			if len(got) != tc.count || got[0] != *tc.first {
				t.Errorf("got %d, first %+v; want %d, first %+v", len(got), got[0], tc.count, *tc.first)
			}
		})
	}
}

func TestParseOtherCompanies(t *testing.T) {
	raw, _ := os.ReadFile("testdata/search.xml")
	got, err := parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	// Ibs-swiss.com: an association with no VAT entry.
	if got[1].UID != "CHE-398.551.302" || got[1].VAT || !got[1].Active || got[1].City != "Saxon" {
		t.Errorf("second = %+v", got[1])
	}
	if got[0].VATNumber() != "CHE-102.753.938 MWST" || got[1].VATNumber() != "" {
		t.Errorf("VAT numbers = %q, %q", got[0].VATNumber(), got[1].VATNumber())
	}
}

func TestStatuses(t *testing.T) {
	for _, tc := range []struct {
		status, vat   string
		active, vatOn bool
	}{
		{"3", "2", true, true},
		{"1", "1", true, false},
		{"4", "3", true, false},
		{"5", "2", false, true},
		{"7", "", false, false},
	} {
		raw := `<Envelope><Body><SearchResponse><SearchResult><uidEntitySearchResultItem><organisation><organisation>` +
			`<organisationIdentification><uid><uidOrganisationIdCategorie>CHE</uidOrganisationIdCategorie><uidOrganisationId>116281710</uidOrganisationId></uid>` +
			`<organisationName>Muster AG</organisationName></organisationIdentification>` +
			`<address><addressCategory>POBOX</addressCategory><town>Zürich</town><swissZipCode>8001</swissZipCode></address></organisation>` +
			`<uidregInformation><uidregStatusEnterpriseDetail>` + tc.status + `</uidregStatusEnterpriseDetail></uidregInformation>` +
			`<vatRegisterInformation><vatStatus>` + tc.vat + `</vatStatus></vatRegisterInformation>` +
			`</organisation></uidEntitySearchResultItem></SearchResult></SearchResponse></Body></Envelope>`
		got, err := parse([]byte(raw))
		if err != nil || len(got) != 1 {
			t.Fatalf("parse: %v %v", got, err)
		}
		if got[0].Active != tc.active || got[0].VAT != tc.vatOn || got[0].City != "Zürich" {
			t.Errorf("status %s vat %s: %+v", tc.status, tc.vat, got[0])
		}
	}
}

func TestLookup(t *testing.T) {
	for _, tc := range []struct {
		uid    string
		found  bool
		calls  int32
		status int
	}{
		{"CHE-102.753.938", true, 1, 0},
		{"CHE-102.753.938 MWST", true, 1, 0},
		{"CHE-116.281.710", false, 1, 0},
		{"CHE-123.456.789", false, 0, 0}, // wrong check digit: not asked
		{"DE123456789", false, 0, 0},
	} {
		t.Run(tc.uid, func(t *testing.T) {
			f := &fakeRegister{status: tc.status}
			s := newService(t, f)
			c, ok, err := s.Lookup(context.Background(), tc.uid)
			if err != nil || ok != tc.found || f.calls.Load() != tc.calls {
				t.Fatalf("Lookup = %+v %v %v (calls %d)", c, ok, err, f.calls.Load())
			}
			if ok && c != swisscom {
				t.Errorf("company = %+v", c)
			}
		})
	}
}

func TestCacheAndRateLimit(t *testing.T) {
	f := &fakeRegister{}
	s := newService(t, f)
	now := time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	ctx := context.Background()

	if _, err := s.Search(ctx, "Swisscom"); err != nil {
		t.Fatal(err)
	}
	// The same search and each company it found (by UID) come from the cache.
	if _, err := s.Search(ctx, "swisscom"); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := s.Lookup(ctx, "CHE-398.551.302"); !ok || err != nil {
		t.Fatalf("cached lookup: %v %v", ok, err)
	}
	if f.calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1", f.calls.Load())
	}

	// The per-minute budget: 15 calls, then the register counts as unavailable until a minute has passed.
	for i := range perMinute - 1 {
		if _, err := s.Search(ctx, "Company "+string(rune('a'+i))); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if _, err := s.Search(ctx, "One too many"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("over the limit: %v", err)
	}
	if f.calls.Load() != perMinute {
		t.Fatalf("calls = %d, want %d", f.calls.Load(), perMinute)
	}
	now = now.Add(time.Minute)
	if _, err := s.Search(ctx, "One too many"); err != nil {
		t.Fatalf("a minute later: %v", err)
	}
	// The cache expires.
	now = now.Add(ttl + time.Second)
	if _, err := s.Search(ctx, "Swisscom"); err != nil || f.calls.Load() != perMinute+2 {
		t.Fatalf("after the TTL: %v, calls %d", err, f.calls.Load())
	}
}

func TestEscapesQuery(t *testing.T) {
	f := &fakeRegister{}
	s := newService(t, f)
	if _, err := s.Search(context.Background(), "A&B <AG>"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f.bodies[0], "<ns:organisationName>A&amp;B &lt;AG&gt;</ns:organisationName>") {
		t.Errorf("body = %s", f.bodies[0])
	}
}

func TestParseUID(t *testing.T) {
	for in, want := range map[string]string{
		"CHE-102.753.938":      "102753938",
		"che102753938":         "102753938",
		"CHE 102 753 938 TVA":  "102753938",
		"CHE-102.753.939":      "",
		"CHE-102.753.93":       "",
		"102753938":            "",
		"CHE-116.281.710 MWST": "116281710",
	} {
		if got := ParseUID(in); got != want {
			t.Errorf("ParseUID(%q) = %q, want %q", in, got, want)
		}
	}
}

// ---- handlers ----

type fakeAuth struct{}

func (fakeAuth) SignedIn(h func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { h(w, r, store.Session{}) }
}

func (fakeAuth) WriteError(w http.ResponseWriter, _ *http.Request, err error) {
	status, code, _, ok := auth.Describe(err)
	if !ok {
		status, code = http.StatusInternalServerError, "internal"
	}
	auth.WriteJSON(w, status, map[string]any{"error": map[string]string{"code": code}})
}

func TestRoutes(t *testing.T) {
	for _, tc := range []struct {
		name, path string
		down       bool
		status     int
		want       string
	}{
		{"search", "/api/v1/uid-register/search?q=Swisscom", false, 200, `"uid":"CHE-102.753.938"`},
		{"search nothing", "/api/v1/uid-register/search?q=Nobody", false, 200, `{"data":[]}`},
		{"search down", "/api/v1/uid-register/search?q=Swisscom", true, 503, `"uid_register_unavailable"`},
		{"search too long", "/api/v1/uid-register/search?q=" + strings.Repeat("a", 201), false, 400, `"invalid_request"`},
		{"company", "/api/v1/uid-register/companies/CHE-102.753.938", false, 200, `"vat":true`},
		{"company unknown", "/api/v1/uid-register/companies/CHE-116.281.710", false, 404, `"not_found"`},
		{"company down", "/api/v1/uid-register/companies/CHE-102.753.938", true, 503, `"uid_register_unavailable"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeRegister{}
			if tc.down {
				f.status = http.StatusInternalServerError
			}
			mux := http.NewServeMux()
			Routes(mux, fakeAuth{}, newService(t, f))
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if rec.Code != tc.status || !strings.Contains(rec.Body.String(), tc.want) {
				t.Fatalf("%d %s, want %d with %s", rec.Code, rec.Body.String(), tc.status, tc.want)
			}
			if tc.status == 200 && !json.Valid(rec.Body.Bytes()) {
				t.Fatalf("invalid JSON")
			}
		})
	}
}

func TestRoutesTurnedOff(t *testing.T) {
	mux := http.NewServeMux()
	Routes(mux, fakeAuth{}, nil)
	for _, path := range []string{"/api/v1/uid-register/search?q=Swisscom", "/api/v1/uid-register/companies/CHE-102.753.938"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "uid_register_unavailable") {
			t.Errorf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
	}
}
