package clients

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/mail"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/eaddress"
	"helvetly.com/api/internal/store"
)

// A field parser normalises one JSON value from ClientInput: value nil means NULL, a message means invalid.
type fieldParser func(raw json.RawMessage) (value any, message string)

var clientFields = map[string]fieldParser{
	"name":                text(200, nil),
	"preferred_name":      text(200, nil),
	"is_company":          boolean,
	"is_active":           boolean,
	"email":               text(254, email),
	"billing_email":       text(254, email),
	"phone":               text(30, phone),
	"website":             text(255, website),
	"street":              text(200, nil),
	"street_number":       text(20, nil),
	"apt":                 text(50, nil),
	"zip":                 text(20, nil),
	"city":                text(100, nil),
	"country":             text(10, country),
	"vat_number":          text(30, vatNumber),
	"electronic_address":  electronicAddress,
	"registration_number": text(100, nil),
	"language":            text(10, language),
	"currency":            text(10, currency),
	"payment_terms_days":  paymentTerms,
	"internal_id":         text(100, nil),
	"note":                text(1000, nil),
	"tags":                tags,
	"dunning_enabled":     boolean,
	"region":              text(6, region),
	"einvoice_format":     einvoiceFormat,
	"leitweg_id":          text(46, LeitwegID),
	"portal_enabled":      boolean,
}

// EInvoiceFormats: the XML a client wants attached to its invoice emails ("none" for the PDF alone).
var EInvoiceFormats = []string{"none", "xrechnung_ubl", "xrechnung_cii", "peppol"}

func einvoiceFormat(raw json.RawMessage) (any, string) {
	var v string
	if isNull(raw) || json.Unmarshal(raw, &v) != nil || !slices.Contains(EInvoiceFormats, v) {
		return nil, "Choose none, xrechnung_ubl, xrechnung_cii or peppol."
	}
	return v, ""
}

var leitwegShape = regexp.MustCompile(`^[0-9]{2,12}(-[A-Z0-9]{1,30})?-[0-9]{2}$`)

// LeitwegID checks a German public body's routing ID (KoSIT Leitweg-ID format): coarse part, optional fine part
// and two check digits, ISO/IEC 7064 MOD 97-10 over the whole ID with letters as 10–35.
func LeitwegID(v string) (string, string) {
	v = strings.ToUpper(v)
	const msg = "Enter the Leitweg-ID as the authority gave it, e.g. 04011000-1234512345-06."
	if !leitwegShape.MatchString(v) {
		return "", msg
	}
	rest := 0
	for _, c := range strings.ReplaceAll(v, "-", "") {
		if c >= 'A' {
			rest = (rest*100 + int(c-'A') + 10) % 97
		} else {
			rest = (rest*10 + int(c-'0')) % 97
		}
	}
	if rest != 1 {
		return "", "This Leitweg-ID's check digits don’t match. Check for a typo."
	}
	return v, ""
}

func electronicAddress(raw json.RawMessage) (any, string) {
	a, msg := NormaliseElectronicAddress(raw)
	if a == nil {
		return nil, msg
	}
	return a, msg
}

// NormaliseElectronicAddress is shared with invoice seller settings.
func NormaliseElectronicAddress(raw json.RawMessage) (*eaddress.Address, string) {
	if isNull(raw) {
		return nil, ""
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || len(fields) != 2 || fields["scheme"] == nil || fields["id"] == nil {
		return nil, "Enter an electronic address with scheme and id."
	}
	var a eaddress.Address
	if json.Unmarshal(raw, &a) != nil {
		return nil, "Enter an electronic address with text scheme and id."
	}
	a, err := eaddress.Normalise(a)
	if err != nil {
		return nil, err.Error()
	}
	return &a, ""
}

var contactFields = map[string]fieldParser{
	"name":  text(200, nil),
	"role":  text(100, nil),
	"email": text(254, email),
	"phone": text(30, phone),
}

// parseFields validates a JSON object against parsers. `name` must be given on create and is never cleared.
func parseFields(body map[string]json.RawMessage, parsers map[string]fieldParser, create bool) (map[string]any, error) {
	keys := slices.Sorted(maps.Keys(body))
	for _, k := range keys {
		if parsers[k] == nil {
			return nil, auth.Error(http.StatusBadRequest, "invalid_request", fmt.Sprintf("Unknown field %q.", k), nil)
		}
	}
	fields, invalid := checkFields(body, parsers, create)
	if len(invalid) > 0 {
		return nil, validationFailed(invalid)
	}
	return fields, nil
}

// CheckCreate applies the create rules to a client input of known fields: the normalised fields, and a message per
// invalid field. AI import uses it to review a record before creating it.
func CheckCreate(body map[string]json.RawMessage) (map[string]any, map[string]string) {
	return checkFields(body, clientFields, true)
}

func checkFields(body map[string]json.RawMessage, parsers map[string]fieldParser, create bool) (map[string]any, map[string]string) {
	fields, invalid := map[string]any{}, map[string]string{}
	for k, raw := range body {
		if v, msg := parsers[k](raw); msg != "" {
			invalid[k] = msg
		} else {
			fields[k] = v
		}
	}
	if v, ok := fields["name"]; (create && !ok && invalid["name"] == "") || (ok && v == nil) {
		invalid["name"] = "Enter a name."
	}
	return fields, invalid
}

// Normalisers shared with internal/invoices: each returns the normalised value or a message for the person.
var (
	NormaliseEmail     = email
	NormaliseCountry   = country
	NormaliseCurrency  = currency
	NormaliseVATNumber = vatNumber
)

func validationFailed(fields map[string]string) error {
	return auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
		map[string]any{"fields": fields})
}

// text: a string trimmed of space, blank meaning NULL, at most max characters, then normalised.
func text(max int, normalise func(string) (string, string)) fieldParser {
	return func(raw json.RawMessage) (any, string) {
		if isNull(raw) {
			return nil, ""
		}
		var v string
		if json.Unmarshal(raw, &v) != nil {
			return nil, "Enter text."
		}
		if v = strings.TrimSpace(v); v == "" {
			return nil, ""
		}
		if utf8.RuneCountInString(v) > max {
			return nil, fmt.Sprintf("Use at most %d characters.", max)
		}
		if normalise == nil {
			return v, ""
		}
		v, msg := normalise(v)
		if msg != "" {
			return nil, msg
		}
		return v, ""
	}
}

func isNull(raw json.RawMessage) bool { return string(raw) == "null" }

func boolean(raw json.RawMessage) (any, string) {
	var v bool
	if isNull(raw) || json.Unmarshal(raw, &v) != nil { // null would unmarshal as false
		return nil, "Choose true or false."
	}
	return v, ""
}

func paymentTerms(raw json.RawMessage) (any, string) {
	if isNull(raw) {
		return nil, ""
	}
	var v int
	if json.Unmarshal(raw, &v) != nil || v < 0 || v > 365 {
		return nil, "Enter a number of days from 0 to 365."
	}
	return v, ""
}

// tags: null clears them; each is trimmed, 1–30 characters, and appears once ignoring case.
func tags(raw json.RawMessage) (any, string) {
	list := []string{}
	if isNull(raw) {
		return list, ""
	}
	var in []string
	if json.Unmarshal(raw, &in) != nil {
		return nil, "Enter a list of tags."
	}
	if len(in) > 10 {
		return nil, "Use at most 10 tags."
	}
	seen := map[string]bool{}
	for _, t := range in {
		t = strings.TrimSpace(t)
		if n := utf8.RuneCountInString(t); n < 1 || n > 30 {
			return nil, "Each tag needs 1 to 30 characters."
		}
		if seen[strings.ToLower(t)] {
			return nil, fmt.Sprintf("The tag %q appears twice.", t)
		}
		seen[strings.ToLower(t)] = true
		list = append(list, t)
	}
	return list, ""
}

func email(v string) (string, string) {
	v = strings.ToLower(v)
	if a, err := mail.ParseAddress(v); err != nil || a.Address != v {
		return "", "Enter a valid email address."
	}
	return v, ""
}

var e164 = regexp.MustCompile(`^\+[1-9][0-9]{6,14}$`)

// phone: E.164, from the usual ways of writing one ("+41 44 123 45 67", "0041 44 123 45 67").
func phone(v string) (string, string) {
	v = strings.NewReplacer(" ", "", "-", "", ".", "", "/", "", "(", "", ")", "").Replace(v)
	if strings.HasPrefix(v, "00") {
		v = "+" + v[2:]
	}
	if !e164.MatchString(v) {
		return "", "Enter the number in international format, such as +41 44 123 45 67."
	}
	return v, ""
}

// website: an http(s) URL; https:// is added when no scheme is given.
func website(v string) (string, string) {
	if !strings.Contains(v, "://") {
		v = "https://" + v
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || !strings.Contains(u.Hostname(), ".") || u.User != nil ||
		strings.ContainsAny(v, " \t") {
		return "", "Enter a web address, such as example.ch."
	}
	return u.String(), ""
}

func country(v string) (string, string) {
	if v = strings.ToUpper(v); !countries[v] {
		return "", "Choose a country (a two-letter ISO code such as CH)."
	}
	return v, ""
}

var regionCode = regexp.MustCompile(`^[A-Z]{2}-[A-Z0-9]{1,3}$`)

// region: an ISO 3166-2 subdivision code such as RO-CJ (BT-54); RO e-Factura needs it for Romanian addresses.
func region(v string) (string, string) {
	if v = strings.ToUpper(v); !regionCode.MatchString(v) {
		return "", "Enter the region as an ISO 3166-2 code such as RO-CJ."
	}
	return v, ""
}

func language(v string) (string, string) {
	if v = strings.ToLower(v); !slices.Contains([]string{"de", "fr", "it", "en"}, v) {
		return "", "Choose German, French, Italian or English."
	}
	return v, ""
}

func currency(v string) (string, string) {
	if v = strings.ToUpper(v); !store.TwoDecimalCurrency(v) {
		return "", "Choose a currency with cents (a three-letter ISO code such as CHF)."
	}
	return v, ""
}

var (
	swissUID = regexp.MustCompile(`^CHE([0-9]{9})(MWST|TVA|IVA)?$`)
	otherVAT = regexp.MustCompile(`^[A-Z]{2}[A-Z0-9]{2,18}$`)
)

// vatNumber: a Swiss/Liechtenstein UID (checksum checked, written CHE-123.456.789 with an optional MWST/TVA/IVA),
// or another country's VAT number: its two-letter prefix and up to 18 letters or digits.
func vatNumber(v string) (string, string) {
	v = strings.ToUpper(strings.NewReplacer(" ", "", "-", "", ".", "").Replace(v))
	if strings.HasPrefix(v, "CH") {
		m := swissUID.FindStringSubmatch(v)
		if m == nil {
			return "", "Enter the UID as CHE-123.456.789, optionally followed by MWST, TVA or IVA."
		}
		if !uidChecksum(m[1]) {
			return "", "This UID does not exist: check its digits."
		}
		d := m[1]
		out := "CHE-" + d[0:3] + "." + d[3:6] + "." + d[6:9]
		if m[2] != "" {
			out += " " + m[2]
		}
		return out, ""
	}
	if !otherVAT.MatchString(v) {
		return "", "Enter the VAT number with its country prefix, such as DE123456789."
	}
	return v, ""
}

// uidChecksum: the UID's ninth digit is its mod-11 check digit (weights 5,4,3,2,7,6,5,4; 11 means 0, 10 is never issued).
func uidChecksum(digits string) bool {
	sum := 0
	for i, w := range []int{5, 4, 3, 2, 7, 6, 5, 4} {
		sum += int(digits[i]-'0') * w
	}
	check := 11 - sum%11
	if check == 11 {
		check = 0
	}
	return check != 10 && check == int(digits[8]-'0')
}

var countries = codeSet(countryCodes)

func codeSet(codes string) map[string]bool {
	set := map[string]bool{}
	for _, c := range strings.Fields(codes) {
		set[c] = true
	}
	return set
}

// ISO 3166-1 alpha-2, officially assigned codes.
const countryCodes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW " +
	"BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA " +
	"GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH " +
	"KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY " +
	"MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH " +
	"SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
	"VN VU WF WS YE YT ZA ZM ZW"
