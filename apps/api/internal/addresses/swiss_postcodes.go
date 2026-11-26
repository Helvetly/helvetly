package addresses

import (
	_ "embed"
	"strings"
)

//go:embed swiss_postcodes.tsv
var swissPostcodeData string

var swissPostcodes = func() map[string]string {
	codes := make(map[string]string)
	for line := range strings.SplitSeq(swissPostcodeData, "\n") {
		if city, code, ok := strings.Cut(line, "\t"); ok {
			codes[city] = code
		}
	}
	return codes
}()

// SwissPostcode returns a postcode only for an unambiguous Swiss postal locality.
func SwissPostcode(country, city string) string {
	if !strings.EqualFold(strings.TrimSpace(country), "CH") {
		return ""
	}
	return swissPostcodes[strings.ToLower(strings.Join(strings.Fields(city), " "))]
}
