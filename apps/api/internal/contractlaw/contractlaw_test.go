package contractlaw

import (
	"slices"
	"strings"
	"testing"
)

func law(t *testing.T, code string) Law {
	t.Helper()
	l, ok := Lookup(code)
	if !ok {
		t.Fatalf("Lookup(%q) not found", code)
	}
	return l
}

func ids(cs []Clause) []string {
	var out []string
	for _, c := range cs {
		out = append(out, c.ID)
	}
	return out
}

func TestLookupAndDefault(t *testing.T) {
	for code, family := range map[string]string{"CH": "CH", "DE": "EU", "FR": "EU", "US-CA": "US", "US-NY": "US"} {
		if l := law(t, code); l.Family != family {
			t.Errorf("%s: family %s, want %s", code, l.Family, family)
		}
	}
	for _, code := range []string{"GB", "US", "US-XX", "CH-ZH", "", "NO"} {
		if _, ok := Lookup(code); ok {
			t.Errorf("Lookup(%q) found, want none", code)
		}
	}
	tests := []struct{ seller, sellerRegion, client, clientRegion, want string }{
		{"CH", "", "DE", "", "CH"},
		{"DE", "", "CH", "", "DE"},
		{"US", "US-TX", "CH", "", "US-TX"},
		{"US", "", "AT", "", "AT"}, // no state: the client's law
		{"GB", "", "GB", "", "CH"},
	}
	for _, tt := range tests {
		if got := Default(tt.seller, tt.sellerRegion, tt.client, tt.clientRegion).Code; got != tt.want {
			t.Errorf("Default(%s %s, %s) = %s, want %s", tt.seller, tt.sellerRegion, tt.client, got, tt.want)
		}
	}
	opts := Options("CH", "IT")
	if opts[0].Code != "CH" || opts[1].Code != "IT" || !slices.ContainsFunc(opts, func(l Law) bool { return l.Code == "US-CA" }) {
		t.Errorf("Options = %v", opts[:3])
	}
}

func TestClausesPerJurisdiction(t *testing.T) {
	common := []string{"parties", "subject", "price", "payment", "term", "duties", "liability", "data", "law", "language", "esign", "final"}
	for _, code := range []string{"CH", "DE", "US-CA"} {
		for _, b2c := range []bool{false, true} {
			s := Situation{Law: law(t, code), B2C: b2c, Distance: true}
			got := ids(Clauses(s, "de"))
			for _, id := range common {
				if !slices.Contains(got, id) {
					t.Errorf("%s b2c=%t: no %s clause in %v", code, b2c, id, got)
				}
			}
			withdrawal := slices.Contains(got, "withdrawal")
			if want := b2c && code != "US-CA"; withdrawal != want {
				t.Errorf("%s b2c=%t: withdrawal %t, want %t", code, b2c, withdrawal, want)
			}
		}
	}
}

func TestEUWithdrawalOnlyForConsumerDistanceContracts(t *testing.T) {
	de := law(t, "DE")
	for _, tt := range []struct {
		b2c, distance, want bool
	}{{true, true, true}, {true, false, false}, {false, true, false}} {
		got := slices.Contains(ids(Clauses(Situation{Law: de, B2C: tt.b2c, Distance: tt.distance}, "en")), "withdrawal")
		if got != tt.want {
			t.Errorf("b2c=%t distance=%t: withdrawal %t, want %t", tt.b2c, tt.distance, got, tt.want)
		}
	}
	out := Outline(Situation{Law: de, B2C: true, Distance: true}, "en")
	if !strings.Contains(out, "14 days") || !strings.Contains(out, "Right of withdrawal") {
		t.Errorf("outline lacks the withdrawal information:\n%s", out)
	}
}

func TestSituationalPoints(t *testing.T) {
	ch := Outline(Situation{Law: law(t, "CH"), Sessions: true}, "de")
	for _, want := range []string{"Art. 404 OR", "Art. 104 OR", "Absage von Terminen", "Gerichtsstand"} {
		if !strings.Contains(ch, want) {
			t.Errorf("CH sessions outline lacks %q", want)
		}
	}
	if strings.Contains(Outline(Situation{Law: law(t, "CH")}, "de"), "Art. 404 OR") {
		t.Error("Art. 404 OR without sessions")
	}
	eu := Outline(Situation{Law: law(t, "AT"), CrossBorderEU: true}, "en")
	for _, want := range []string{"reverse charge", "EUR 40", "law of Austria"} {
		if !strings.Contains(eu, want) {
			t.Errorf("EU B2B cross-border outline lacks %q", want)
		}
	}
	if strings.Contains(Outline(Situation{Law: law(t, "AT"), B2C: true, CrossBorderEU: true}, "en"), "reverse charge") {
		t.Error("reverse charge for a consumer")
	}
	us := Outline(Situation{Law: law(t, "US-NY")}, "en")
	if !strings.Contains(us, "State of New York") || !strings.Contains(us, "ESIGN") {
		t.Errorf("US outline:\n%s", us)
	}
}

// Every statute an outline cites is one the validator knows: the data agrees with itself.
func TestOutlinesCiteOnlyKnownStatutes(t *testing.T) {
	for _, code := range []string{"CH", "DE", "US-CA"} {
		for _, b2c := range []bool{false, true} {
			s := Situation{Law: law(t, code), B2C: b2c, Distance: true, Sessions: true, CrossBorderEU: true}
			for _, lang := range []string{"de", "fr", "it", "en"} {
				if bad := UnknownStatutes(Outline(s, lang), s.Law); len(bad) > 0 {
					t.Errorf("%s b2c=%t %s: outline cites unknown %v", code, b2c, lang, bad)
				}
			}
		}
	}
}

func TestUnknownStatutes(t *testing.T) {
	ch, de, us := law(t, "CH"), law(t, "DE"), law(t, "US-CA")
	tests := []struct {
		law  Law
		text string
		want []string
	}{
		{ch, "Verzugszins gemäss Art. 104 OR; Kündigung nach Art. 404 Abs. 1 OR.", nil},
		{ch, "Es gilt Art. 999 OR und das revDSG.", []string{"Art. 999 OR"}},
		{ch, "Daten nach der DSGVO.", []string{"DSGVO"}},
		{ch, "Gemäss § 286 BGB.", []string{"§ 286 BGB"}},
		{de, "Under the GDPR (Regulation (EU) 2016/679) and Directive 2011/7/EU.", nil},
		{de, "See Directive 1999/44/EC.", []string{"Directive 1999/44/EC"}},
		{us, "Under the ESIGN Act (15 U.S.C. § 7001) and UETA.", nil},
		{us, "Per 15 U.S.C. § 1601.", []string{"15 U.S.C. § 1601"}},
		{ch, "Die Parteien vereinbaren 30 Tage Zahlungsfrist. Ort: Zürich.", nil},
	}
	for _, tt := range tests {
		if got := UnknownStatutes(tt.text, tt.law); !slices.Equal(got, tt.want) {
			t.Errorf("UnknownStatutes(%q) = %q, want %q", tt.text, got, tt.want)
		}
	}
}

func TestFormatsAndPages(t *testing.T) {
	ch, de, us := law(t, "CH"), law(t, "DE"), law(t, "US-TX")
	for _, tt := range []struct {
		law        Law
		lang, want string
		page       string
	}{
		{ch, "de", "1'234'567.50", "A4"},
		{de, "de", "1.234.567,50", "A4"},
		{law(t, "FR"), "fr", "1 234 567,50", "A4"},
		{us, "en", "1,234,567.50", "Letter"},
	} {
		if got := FormatFor(tt.law, tt.lang).Money("1234567.50"); got != tt.want {
			t.Errorf("%s %s: %q, want %q", tt.law.Code, tt.lang, got, tt.want)
		}
		if got := PageSize(tt.law); got != tt.page {
			t.Errorf("%s: page %s, want %s", tt.law.Code, got, tt.page)
		}
	}
	if FormatFor(us, "en").Date != "01/02/2006" || FormatFor(ch, "fr").Date != "02.01.2006" {
		t.Error("date layouts")
	}
	if FormatFor(ch, "de").Money("-12.00") != "-12.00" || PartyID(ch) != "UID" || PartyID(us) != "EIN" {
		t.Error("small amounts or party ids")
	}
}
