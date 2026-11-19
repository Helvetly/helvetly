// Package uidregister looks Swiss companies up in the Federal Statistical Office's UID register through its
// public SOAP web service (UID-WSE PublicServices, interface 5.0, no login). The service allows 20 requests a
// minute per caller and blocks callers that go over, so every instance stays below that and caches answers.
package uidregister

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// ErrUnavailable: the register did not answer (down, slow, refused or our own rate limit); the caller carries on without it.
var ErrUnavailable = errors.New("uid register unavailable")

// Company is what the register says about one organisation.
type Company struct {
	UID         string `json:"uid"` // CHE-123.456.789
	Name        string `json:"name"`
	Street      string `json:"street,omitempty"`
	HouseNumber string `json:"house_number,omitempty"`
	Zip         string `json:"zip,omitempty"`
	City        string `json:"city,omitempty"`
	Canton      string `json:"canton,omitempty"`
	Active      bool   `json:"active"` // not deleted or cancelled in the register
	VAT         bool   `json:"vat"`    // registered for Swiss VAT now
}

// VATNumber is the company's Swiss VAT number ("CHE-123.456.789 MWST"), "" when it is not VAT-registered.
func (c Company) VATNumber() string {
	if !c.VAT {
		return ""
	}
	return c.UID + " MWST"
}

const (
	perMinute   = 15 // below the service's 20, leaving room for clock skew and other callers behind the same address
	ttl         = 10 * time.Minute
	maxCached   = 2000
	maxResults  = 8
	callTimeout = 5 * time.Second
)

// Register is the lookup the API needs: name or UID search, and one company by UID (ok false: not in the register).
type Register interface {
	Search(ctx context.Context, query string) ([]Company, error)
	Lookup(ctx context.Context, uid string) (Company, bool, error)
}

// Service calls the web service at url, with a per-instance rate limit and a short cache.
type Service struct {
	url  string
	http *http.Client
	now  func() time.Time

	mu    sync.Mutex
	calls []time.Time // the calls of the last minute
	cache map[string]cached
}

type cached struct {
	companies []Company
	until     time.Time
}

func New(url string) *Service {
	return &Service{url: url, http: &http.Client{Timeout: callTimeout}, now: time.Now, cache: map[string]cached{}}
}

var uidShape = regexp.MustCompile(`(?i)^\s*CHE[-\s]?(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})(\s+(MWST|TVA|IVA))?\s*$`)

// ParseUID returns the nine digits of a well-formed Swiss UID with a right check digit (eCH-0097), or "".
func ParseUID(s string) string {
	m := uidShape.FindStringSubmatch(s)
	if m == nil {
		return ""
	}
	digits := m[1] + m[2] + m[3]
	sum := 0
	for i, w := range []int{5, 4, 3, 2, 7, 6, 5, 4} {
		sum += w * int(digits[i]-'0')
	}
	check := 11 - sum%11
	if check == 10 || check%11 != int(digits[8]-'0') {
		return ""
	}
	return digits
}

// FormatUID writes nine digits the way the register prints them: CHE-123.456.789.
func FormatUID(digits string) string {
	return "CHE-" + digits[0:3] + "." + digits[3:6] + "." + digits[6:9]
}

// Search finds companies by name, or the one company of a UID.
func (s *Service) Search(ctx context.Context, query string) ([]Company, error) {
	query = strings.Join(strings.Fields(query), " ")
	if ParseUID(query) != "" {
		c, ok, err := s.Lookup(ctx, query)
		if err != nil || !ok {
			return []Company{}, err
		}
		return []Company{c}, nil
	}
	if len([]rune(query)) < 2 {
		return []Company{}, nil
	}
	params := `<ns:uidEntitySearchParameters><ns:organisationName>` + escape(query) + `</ns:organisationName></ns:uidEntitySearchParameters>`
	return s.search(ctx, "name:"+strings.ToLower(query), params, maxResults)
}

// Lookup finds the company of a UID (any spelling ParseUID accepts).
func (s *Service) Lookup(ctx context.Context, uid string) (Company, bool, error) {
	digits := ParseUID(uid)
	if digits == "" {
		return Company{}, false, nil
	}
	params := `<ns:uid><e97:uidOrganisationIdCategorie>CHE</e97:uidOrganisationIdCategorie><e97:uidOrganisationId>` + digits + `</e97:uidOrganisationId></ns:uid>`
	found, err := s.search(ctx, "uid:"+digits, params, 1)
	if err != nil || len(found) == 0 {
		return Company{}, false, err
	}
	return found[0], true, nil
}

func (s *Service) search(ctx context.Context, key, params string, limit int) ([]Company, error) {
	if hit, ok := s.cached(key); ok {
		return hit, nil
	}
	if !s.admit() {
		return nil, fmt.Errorf("%w: rate limit", ErrUnavailable)
	}
	body := `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:uid="http://www.uid.admin.ch/xmlns/uid-wse"` +
		` xmlns:ns="http://www.uid.admin.ch/xmlns/uid-wse/5" xmlns:sh="http://www.uid.admin.ch/xmlns/uid-wse-shared/2"` +
		` xmlns:e97="http://www.ech.ch/xmlns/eCH-0097/5"><s:Body><uid:Search><uid:searchParameters>` + params +
		`</uid:searchParameters><uid:config><sh:searchMode>Auto</sh:searchMode><sh:maxNumberOfRecords>` + fmt.Sprint(limit) +
		`</sh:maxNumberOfRecords><sh:searchNameAndAddressHistory>false</sh:searchNameAndAddressHistory></uid:config></uid:Search></s:Body></s:Envelope>`
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, strings.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	req.Header.Set("Content-Type", "text/xml; charset=utf-8")
	req.Header.Set("SOAPAction", `"http://www.uid.admin.ch/xmlns/uid-wse/IPublicServices/Search"`)
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	// A SOAP fault (Request_limit_exceeded among them) comes as a 500: nothing to show, the register is unavailable.
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	companies, err := parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	s.store(key, companies)
	return companies, nil
}

// admit counts a call against the per-minute budget.
func (s *Service) admit() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	recent := s.calls[:0]
	for _, t := range s.calls {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	s.calls = recent
	if len(s.calls) >= perMinute {
		return false
	}
	s.calls = append(s.calls, now)
	return true
}

func (s *Service) cached(key string) ([]Company, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	hit, ok := s.cache[key]
	if !ok || s.now().After(hit.until) {
		return nil, false
	}
	return hit.companies, true
}

func (s *Service) store(key string, companies []Company) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// shortcut: a full cache is emptied at once rather than evicted oldest-first; fine at this size and TTL.
	if len(s.cache) >= maxCached {
		clear(s.cache)
	}
	until := s.now().Add(ttl)
	s.cache[key] = cached{companies, until}
	// Each company found by name is also cached by its UID: picking a suggestion verifies it without another call.
	for _, c := range companies {
		if digits := ParseUID(c.UID); digits != "" {
			s.cache["uid:"+digits] = cached{[]Company{c}, until}
		}
	}
}

func escape(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// The response, matched on local names (the service spreads it over eCH namespaces).
type envelope struct {
	Items []struct {
		Organisation struct {
			Organisation struct {
				Identification struct {
					UID struct {
						Category string `xml:"uidOrganisationIdCategorie"`
						ID       string `xml:"uidOrganisationId"`
					} `xml:"uid"`
					Name      string `xml:"organisationName"`
					LegalName string `xml:"organisationLegalName"`
				} `xml:"organisationIdentification"`
				Addresses []address `xml:"address"`
			} `xml:"organisation"`
			Status string `xml:"uidregInformation>uidregStatusEnterpriseDetail"`
			VAT    string `xml:"vatRegisterInformation>vatStatus"`
		} `xml:"organisation"`
	} `xml:"Body>SearchResponse>SearchResult>uidEntitySearchResultItem"`
}

type address struct {
	Category    string `xml:"addressCategory"`
	Street      string `xml:"street"`
	HouseNumber string `xml:"houseNumber"`
	Town        string `xml:"town"`
	Zip         string `xml:"swissZipCode"`
	Canton      string `xml:"cantonAbbreviation"`
}

func (c *Company) setAddress(a address) {
	c.Street, c.HouseNumber, c.City, c.Zip, c.Canton = a.Street, a.HouseNumber, a.Town, a.Zip, a.Canton
}

func parse(raw []byte) ([]Company, error) {
	var env envelope
	if err := xml.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("parse search response: %w", err)
	}
	companies := []Company{}
	for _, item := range env.Items {
		o := item.Organisation.Organisation
		if o.Identification.UID.Category != "CHE" || len(o.Identification.UID.ID) != 9 {
			continue
		}
		c := Company{
			UID:  FormatUID(o.Identification.UID.ID),
			Name: o.Identification.Name,
			// eCH-0108: 1 provisional, 2 being reactivated, 3 definitive, 4 being changed; 5–7 deleted or cancelled.
			Active: slices.Contains([]string{"1", "2", "3", "4"}, item.Organisation.Status),
			// eCH-0108 vatStatus: 2 = active.
			VAT: item.Organisation.VAT == "2",
		}
		if c.Name == "" {
			c.Name = o.Identification.LegalName
		}
		// The legal seat, else the first address given.
		if i := slices.IndexFunc(o.Addresses, func(a address) bool { return a.Category == "LEGAL" }); i >= 0 {
			c.setAddress(o.Addresses[i])
		} else if len(o.Addresses) > 0 {
			c.setAddress(o.Addresses[0])
		}
		companies = append(companies, c)
	}
	return companies, nil
}
