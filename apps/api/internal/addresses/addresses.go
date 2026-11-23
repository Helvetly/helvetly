// Package addresses suggests postal addresses as one types a session's location, through Photon (komoot's
// OpenStreetMap geocoder built for search-as-you-type; the public Nominatim server's policy forbids autocomplete).
// No key, no map and nothing about the user goes out: only the typed text, a country bias and a language.
// Suggestions are a convenience, so every failure is an empty list, never an error.
package addresses

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
)

// Address is one suggestion; Label is what the location field is filled with.
type Address struct {
	Label       string  `json:"label"`
	Street      string  `json:"street,omitempty"`
	HouseNumber string  `json:"house_number,omitempty"`
	Postcode    string  `json:"postcode,omitempty"`
	City        string  `json:"city,omitempty"`
	Country     string  `json:"country,omitempty"` // ISO 3166-1 alpha-2
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
}

const (
	minChars     = 3
	maxChars     = 200
	maxResults   = 5
	callTimeout  = 3 * time.Second
	ttl          = 10 * time.Minute
	maxCached    = 2000
	perMinute    = 120 // per instance: the public Photon is free and asks for fair use
	perWorkspace = 30  // per workspace and minute: one person typing with the browser's debounce stays well below
	maxBody      = 1 << 20
)

// Service calls Photon at one URL (the public instance or a self-hosted one).
type Service struct {
	url  string
	http *http.Client
	now  func() time.Time

	mu     sync.Mutex
	calls  []time.Time            // this instance's calls of the last minute
	byWS   map[string][]time.Time // each workspace's calls of the last minute
	cache  map[string]cached
	expiry time.Time // the next sweep of expired cache entries and idle workspaces
}

type cached struct {
	found []Address
	until time.Time
}

// New asks the Photon API at url.
func New(url string) *Service {
	return &Service{url: url, http: &http.Client{Timeout: callTimeout}, now: time.Now,
		byWS: map[string][]time.Time{}, cache: map[string]cached{}}
}

// Suggest answers up to five addresses for what is typed, preferring country (ISO code), in lang where Photon has
// it. Fewer than three characters, Photon down or a rate limit reached: an empty list.
func (s *Service) Suggest(ctx context.Context, workspace, query, country, lang string) []Address {
	query = strings.Join(strings.Fields(query), " ")
	country = strings.ToUpper(strings.TrimSpace(country))
	if n := len([]rune(query)); n < minChars || n > maxChars {
		return []Address{}
	}
	if !slices.Contains(languages, lang) {
		lang = "" // Photon's default: each place's own name
	}
	key := country + ":" + lang + ":" + strings.ToLower(query)
	if hit, ok := s.cached(key); ok {
		return hit
	}
	var found []Address
	if s.admit(workspace) {
		found = s.photon(ctx, query, country, lang)
	}
	if found == nil {
		return []Address{} // not cached: a failure or the limit, so the next keystroke may ask again
	}
	s.store(key, found)
	return found
}

// admit counts a call against the instance's and the workspace's per-minute budgets.
func (s *Service) admit(workspace string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	recent := func(calls []time.Time) []time.Time {
		return slices.DeleteFunc(calls, func(t time.Time) bool { return now.Sub(t) >= time.Minute })
	}
	s.calls, s.byWS[workspace] = recent(s.calls), recent(s.byWS[workspace])
	if len(s.calls) >= perMinute || len(s.byWS[workspace]) >= perWorkspace {
		return false
	}
	s.calls = append(s.calls, now)
	s.byWS[workspace] = append(s.byWS[workspace], now)
	return true
}

func (s *Service) cached(key string) ([]Address, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	hit, ok := s.cache[key]
	if !ok || s.now().After(hit.until) {
		return nil, false
	}
	return hit.found, true
}

func (s *Service) store(key string, found []Address) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if now.After(s.expiry) || len(s.cache) >= maxCached {
		for k, c := range s.cache {
			if now.After(c.until) {
				delete(s.cache, k)
			}
		}
		for ws, calls := range s.byWS {
			if len(calls) == 0 || now.Sub(calls[len(calls)-1]) >= time.Minute {
				delete(s.byWS, ws)
			}
		}
		s.expiry = now.Add(ttl)
		if len(s.cache) >= maxCached {
			clear(s.cache) // shortcut: drops every entry when full of fresh ones; an LRU only if this ever shows up
		}
	}
	s.cache[key] = cached{found, now.Add(ttl)}
}

// get fetches u and decodes its JSON into v; false on any failure.
func (s *Service) get(ctx context.Context, u string, v any) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Helvetly address suggestions (https://github.com/Helvetly/helvetly)")
	res, err := s.http.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return false
	}
	return json.NewDecoder(io.LimitReader(res.Body, maxBody)).Decode(v) == nil
}

func withQuery(base string, q url.Values) string {
	sep := "?"
	if strings.Contains(base, "?") {
		sep = "&"
	}
	return base + sep + q.Encode()
}

type photonAnswer struct {
	Features []struct {
		Geometry struct {
			Coordinates []float64 `json:"coordinates"` // lon, lat
		} `json:"geometry"`
		Properties struct {
			Name        string `json:"name"`
			Street      string `json:"street"`
			HouseNumber string `json:"housenumber"`
			Postcode    string `json:"postcode"`
			City        string `json:"city"`
			Town        string `json:"town"`
			Village     string `json:"village"`
			Country     string `json:"country"`
			CountryCode string `json:"countrycode"`
		} `json:"properties"`
	} `json:"features"`
}

// languages Photon's public instance has names in.
var languages = []string{"en", "de", "fr", "it"}

// centres bias Photon towards a workspace's country; elsewhere only the ordering below prefers it.
var centres = map[string][2]float64{ // lat, lon
	"CH": {46.8, 8.2}, "LI": {47.16, 9.55}, "DE": {51.1, 10.4}, "AT": {47.6, 14.1}, "FR": {46.6, 2.4},
	"IT": {42.8, 12.6}, "PL": {52.1, 19.4}, "NL": {52.2, 5.3}, "BE": {50.6, 4.6}, "LU": {49.8, 6.1},
	"GB": {54.0, -2.0}, "IE": {53.2, -8.0}, "ES": {40.2, -3.6}, "PT": {39.6, -8.0}, "CZ": {49.8, 15.5},
	"DK": {56.0, 10.0}, "SE": {62.0, 15.0}, "NO": {64.0, 12.0}, "FI": {64.0, 26.0}, "US": {39.8, -98.6},
}

func (s *Service) photon(ctx context.Context, query, country, lang string) []Address {
	var a photonAnswer
	q := url.Values{"q": {query}, "limit": {fmt.Sprint(maxResults * 2)}}
	if lang != "" {
		q.Set("lang", lang)
	}
	if c, ok := centres[country]; ok {
		q.Set("lat", fmt.Sprint(c[0]))
		q.Set("lon", fmt.Sprint(c[1]))
		q.Set("zoom", "6") // a country's scale, so a nearby town still beats a famous far one
	}
	if !s.get(ctx, withQuery(s.url, q), &a) {
		return nil
	}
	found := []Address{}
	for _, f := range a.Features {
		p := f.Properties
		ad := Address{Street: p.Street, HouseNumber: p.HouseNumber, Postcode: p.Postcode,
			City: cmp.Or(p.City, p.Town, p.Village), Country: strings.ToUpper(p.CountryCode)}
		if len(f.Geometry.Coordinates) == 2 {
			ad.Lon, ad.Lat = f.Geometry.Coordinates[0], f.Geometry.Coordinates[1]
		}
		if ad.Street == "" {
			ad.Street = p.Name // a square, a station or a building without a street of its own
		}
		name := ""
		if p.Name != "" && p.Name != ad.Street && p.Name != ad.City {
			name = p.Name
		}
		other := ""
		if ad.Country != country {
			other = p.Country
		}
		if ad.Label = ad.format(name, other); ad.Label == "" || slices.ContainsFunc(found, func(b Address) bool { return b.Label == ad.Label }) {
			continue
		}
		found = append(found, ad)
	}
	// Photon only biases: the asked country's addresses come first.
	slices.SortStableFunc(found, func(x, y Address) int {
		return boolRank(x.Country != country) - boolRank(y.Country != country)
	})
	return found[:min(len(found), maxResults)]
}

func boolRank(b bool) int {
	if b {
		return 1
	}
	return 0
}

// format writes the address one line, as it is written in the countries we serve: "Name, Street 1, 8001 Zürich".
func (a Address) format(name string, extra ...string) string {
	parts := []string{name, strings.TrimSpace(a.Street + " " + a.HouseNumber), strings.TrimSpace(a.Postcode + " " + a.City)}
	return strings.Join(slices.DeleteFunc(append(parts, extra...), func(p string) bool { return p == "" }), ", ")
}
