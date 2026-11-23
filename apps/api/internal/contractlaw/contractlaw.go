// Package contractlaw is the jurisdiction data behind contracts written from quotes: which law governs (Switzerland,
// an EU member state or a US state), which clauses that law and the situation (business or consumer client, distance
// contract, sessions sold) need with their must-include points, which statutes may be cited, and how dates, amounts
// and the page are formatted. Everything is data in rules.json, never prose in Go; it is no legal advice.
package contractlaw

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"helvetly.com/api/internal/employment"
)

// Format: how a contract prints dates (a Go layout) and amounts.
type Format struct {
	Date    string `json:"date"`
	Group   string `json:"group"`
	Decimal string `json:"decimal"`
}

type family struct {
	Page    string            `json:"page"` // A4 | Letter
	PartyID string            `json:"party_id"`
	Formats map[string]Format `json:"formats"`
}

type statute struct {
	ID     string   `json:"id"`
	Family string   `json:"family"`
	Acts   []string `json:"acts"`
	Refs   []string `json:"refs"`
}

// when: the situation a clause entry applies in; a nil field matches any.
type when struct {
	B2B           *bool `json:"b2b"`
	B2C           *bool `json:"b2c"`
	Distance      *bool `json:"distance"`
	Sessions      *bool `json:"sessions"`
	CrossBorderEU *bool `json:"cross_border_eu"`
}

type clauseEntry struct {
	ID       string              `json:"id"`
	When     when                `json:"when"`
	Heading  map[string]string   `json:"heading"`
	Points   map[string]string   `json:"points"` // by family, "*" for every family
	Statutes map[string][]string `json:"statutes"`
}

var (
	//go:embed rules.json
	raw   []byte
	rules = func() (r struct {
		Disclaimer string            `json:"disclaimer"`
		Families   map[string]family `json:"families"`
		Statutes   []statute         `json:"statutes"`
		Clauses    []clauseEntry     `json:"clauses"`
	}) {
		if err := json.Unmarshal(raw, &r); err != nil {
			panic("contractlaw: rules.json: " + err.Error())
		}
		return r
	}()
)

// Law is a governing law: "CH", an EU member state ("DE") or a US state ("US-CA").
type Law struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Family string `json:"family"` // CH | EU | US
}

// Lookup: the law of code, false for one not modelled.
func Lookup(code string) (Law, bool) {
	country, state, _ := strings.Cut(code, "-")
	c, ok := employment.CountryOf(country)
	switch {
	case !ok:
		return Law{}, false
	case c.Group == employment.CH && state == "":
		return Law{Code: "CH", Name: c.Name, Family: "CH"}, true
	case c.Group == employment.EU && state == "":
		return Law{Code: c.Code, Name: c.Name, Family: "EU"}, true
	case c.Group == employment.US:
		for _, r := range c.Regions {
			if r.Code == state {
				return Law{Code: "US-" + r.Code, Name: r.Name, Family: "US"}, true
			}
		}
	}
	return Law{}, false
}

// usState: the state of a party's ISO 3166-2 region ("US-CA" or "CA"), "" for none.
func usState(region string) string {
	return strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(region)), "US-")
}

// Default: the seller's law (for the US the seller's state), else the client's, else Swiss law.
func Default(sellerCountry, sellerRegion, clientCountry, clientRegion string) Law {
	for _, p := range [][2]string{{sellerCountry, sellerRegion}, {clientCountry, clientRegion}} {
		code := strings.ToUpper(p[0])
		if code == "US" {
			code += "-" + usState(p[1])
		}
		if l, ok := Lookup(code); ok {
			return l
		}
	}
	l, _ := Lookup("CH")
	return l
}

// Options: Switzerland, the EU member states of the seller and the client, and every US state.
func Options(sellerCountry, clientCountry string) []Law {
	out := []Law{}
	add := func(code string) {
		if l, ok := Lookup(code); ok && !slices.ContainsFunc(out, func(o Law) bool { return o.Code == l.Code }) {
			out = append(out, l)
		}
	}
	add("CH")
	add(strings.ToUpper(sellerCountry))
	add(strings.ToUpper(clientCountry))
	us, _ := employment.CountryOf("US")
	for _, r := range us.Regions {
		add("US-" + r.Code)
	}
	return out
}

// Situation: what decides the clauses besides the law.
type Situation struct {
	Law           Law
	B2C           bool // the client is a person, not a company
	Distance      bool // concluded without both parties present (emailed or signed online)
	Sessions      bool // the quote sells sessions or lessons (a mandate; the cancellation policy applies)
	CrossBorderEU bool // seller and client in different EU member states
}

func (w when) matches(s Situation) bool {
	is := func(want *bool, v bool) bool { return want == nil || *want == v }
	return is(w.B2B, !s.B2C) && is(w.B2C, s.B2C) && is(w.Distance, s.Distance) && is(w.Sessions, s.Sessions) &&
		is(w.CrossBorderEU, s.CrossBorderEU)
}

// Clause is one required section: its heading in the contract's language, what it must say, the statutes it cites.
type Clause struct {
	ID       string
	Heading  string
	Points   []string
	Statutes []string // ids
}

// Clauses: the outline the law and the situation require, in the data's order.
func Clauses(s Situation, lang string) []Clause {
	var out []Clause
	for _, e := range rules.Clauses {
		if !e.When.matches(s) {
			continue
		}
		point := e.Points[s.Law.Family]
		if point == "" {
			point = e.Points["*"]
		}
		if point == "" {
			continue
		}
		point = strings.NewReplacer("{law}", s.Law.Name, "{language}", languageName(lang)).Replace(point)
		i := slices.IndexFunc(out, func(c Clause) bool { return c.ID == e.ID })
		if i < 0 {
			heading := e.Heading[lang]
			if heading == "" {
				heading = e.Heading["en"]
			}
			out = append(out, Clause{ID: e.ID, Heading: heading})
			i = len(out) - 1
		}
		out[i].Points = append(out[i].Points, point)
		out[i].Statutes = append(out[i].Statutes, e.Statutes[s.Law.Family]...)
	}
	return out
}

func languageName(lang string) string {
	return map[string]string{"de": "German", "fr": "French", "it": "Italian", "en": "English"}[lang]
}

// Outline is the clause list as the model is told it: numbered headings with their must-include points.
func Outline(s Situation, lang string) string {
	var b strings.Builder
	for i, c := range Clauses(s, lang) {
		b.WriteString(strconv.Itoa(i+1) + ". " + c.Heading + "\n")
		for _, p := range c.Points {
			b.WriteString("   - " + p + "\n")
		}
	}
	return b.String()
}

// Citable: the statutes the law's family may cite, as written in the data.
func Citable(l Law) []string {
	var out []string
	for _, st := range rules.Statutes {
		if st.Family == l.Family {
			out = append(out, st.Refs...)
			out = append(out, st.Acts...)
		}
	}
	return out
}

// Statute-like references: articles and paragraphs of a named act, US Code sections, EU directives and regulations,
// and the acts' common abbreviations.
var referencePattern = regexp.MustCompile(`(?i:\bart(?:icle|ikel|icolo)?\.?\s*\d+[a-z]?(?:\s*(?:abs|para|al|cpv|par|lit)\.?\s*\d+[a-z]?)*(?:\s*(?:ff|et\s+seq)\.?)?\s+)[A-Z][A-Za-z]{1,7}\b(?:\s+I\b(?:\s+bis\b)?)?` +
	`|§+\s*\d+[\d.]*[a-z]?(?:\s*(?:Abs|para)\.?\s*\d+)*(?:\s+[A-Z][A-Za-z]{1,7}\b)?` +
	`|\b\d+\s+U\.?\s?S\.?\s?C\.?\s*§*\s*\d+[a-z]?` +
	`|(?i:\b(?:directive|richtlinie|direttiva)\s*(?:\((?:EU|EC|EG|UE|CE)\)\s*)?(?:Nr\.?\s*|No\.?\s*|n\.\s*)?\d{2,4}/\d+(?:/(?:EU|EC|EG|UE|CE|EWG|EEC))?)` +
	`|(?i:\b(?:regulation|verordnung|règlement|regolamento)\s*\((?:EU|EC|EG|UE|CE)\)\s*(?:Nr\.?\s*|No\.?\s*|n\.\s*)?\d{2,4}/\d+)` +
	`|\b(?:OR|CO|ZGB|ZPO|CPC|DSG|revDSG|nDSG|FADP|nLPD|ZertES|MWSTG|UWG|KKG|BGB|HGB|UCC|CCPA|CPRA|ESIGN|UETA|eIDAS|GDPR|DSGVO|RGPD)\b`)

// norm compares references without case, spaces, dots, "article" spelled out or sub-paragraphs.
var normSteps = []struct {
	re   *regexp.Regexp
	with string
}{
	{regexp.MustCompile(`\b(?:abs|para|al|cpv|par|lit)\.?\s*\d+[a-z]?`), ""},
	{regexp.MustCompile(`\bart(?:icle|ikel|icolo)?\b`), "art"},
	{regexp.MustCompile(`\b(?:richtlinie|direttiva)\b`), "directive"},
	{regexp.MustCompile(`(?:verordnung|règlement|regolamento)`), "regulation"},
	{regexp.MustCompile(`\b(?:nr|no|n)\.?\s`), ""},
}

func norm(s string) string {
	s = strings.ToLower(s)
	for _, st := range normSteps {
		s = st.re.ReplaceAllString(s, st.with)
	}
	return strings.NewReplacer(" ", "", ".", "", "§", "", "ff", "", "etseq", "").Replace(s)
}

// UnknownStatutes: the statute references in text that the law's data does not have, in order, each once.
func UnknownStatutes(text string, l Law) []string {
	known := map[string]bool{}
	for _, c := range Citable(l) {
		known[norm(c)] = true
	}
	var out []string
	for _, m := range referencePattern.FindAllString(text, -1) {
		m = strings.TrimSpace(m)
		if !known[norm(m)] && !slices.Contains(out, m) {
			out = append(out, m)
		}
	}
	return out
}

// FormatFor: how the law prints dates and amounts in lang.
func FormatFor(l Law, lang string) Format {
	f := rules.Families[l.Family].Formats
	if v, ok := f[lang]; ok {
		return v
	}
	return f["en"]
}

// PageSize: "A4", or "Letter" in the US.
func PageSize(l Law) string { return rules.Families[l.Family].Page }

// PartyID: what a party's tax or registration number is called (UID, VAT ID, EIN).
func PartyID(l Law) string { return rules.Families[l.Family].PartyID }

// Disclaimer: what the data is and is not.
func Disclaimer() string { return rules.Disclaimer }

// Money writes "1'234.50" as the format groups and separates it; whole is the amount as Swiss "1234.50".
func (f Format) Money(plain string) string {
	sign := ""
	if strings.HasPrefix(plain, "-") {
		sign, plain = "-", plain[1:]
	}
	whole, frac, _ := strings.Cut(plain, ".")
	var b strings.Builder
	for i, r := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteString(f.Group)
		}
		b.WriteRune(r)
	}
	if frac != "" {
		b.WriteString(f.Decimal + frac)
	}
	return sign + b.String()
}
