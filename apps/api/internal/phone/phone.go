package phone

import "strings"

// twoDigitCodes are the country calling codes of two digits; one-digit codes are 1 and 7, the rest have three.
var twoDigitCodes = map[string]bool{}

func init() {
	for _, c := range strings.Fields("20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98") {
		twoDigitCodes[c] = true
	}
}

// Display spaces an international number as people read it: Switzerland "+41 78 239 09 99", Liechtenstein
// "+423 232 12 34", other countries by a generic grouping. Anything it cannot read as an international number
// (a national number without a country, letters, a wrong length) stays as typed.
// shortcut: the generic grouping is not each country's own convention, upgrade to a numbering-plan library if one is needed.
func Display(phone string) string {
	typed := strings.TrimSpace(phone)
	s := strings.NewReplacer(" ", "", ".", "", "-", "", "(", "", ")", "", "/", "", " ", "").Replace(typed)
	switch {
	case strings.HasPrefix(s, "+"):
		s = s[1:]
	case strings.HasPrefix(s, "00"):
		s = s[2:]
	default:
		return typed
	}
	if len(s) < 8 || len(s) > 15 || strings.Trim(s, "0123456789") != "" || s[0] == '0' {
		return typed
	}
	cc := 3
	switch {
	case s[0] == '1' || s[0] == '7':
		cc = 1
	case twoDigitCodes[s[:2]]:
		cc = 2
	}
	code, rest := s[:cc], s[cc:]
	var sizes []int
	switch {
	case code == "41" && len(rest) == 9:
		sizes = []int{2, 3, 2, 2}
	case code == "423" && len(rest) == 7:
		sizes = []int{3, 2, 2}
	case code == "423" && len(rest) == 9:
		sizes = []int{3, 3, 3}
	case code == "1" && len(rest) == 10:
		sizes = []int{3, 3, 4}
	}
	parts := []string{"+" + code}
	for _, n := range sizes {
		parts, rest = append(parts, rest[:n]), rest[n:]
	}
	for len(sizes) == 0 && rest != "" { // generic: pairs, the last group taking an odd digit
		n := 2
		if len(rest) == 3 {
			n = 3
		}
		parts, rest = append(parts, rest[:n]), rest[n:]
	}
	return strings.Join(parts, " ")
}
