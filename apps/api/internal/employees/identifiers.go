package employees

import (
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// compact drops spaces, dots and dashes and upper-cases, as identifiers are written in groups.
func compact(v string) string {
	return strings.ToUpper(strings.NewReplacer(" ", "", ".", "", "-", "", " ", "").Replace(v))
}

var ahvDigits = regexp.MustCompile(`^756\d{10}$`)

// ahvNumber checks a Swiss AHV/AVS number (756.XXXX.XXXX.XC, EAN-13 check digit) and writes it in its usual groups.
func ahvNumber(v string) (string, string) {
	d := compact(v)
	if !ahvDigits.MatchString(d) {
		return "", "Enter the AHV number as 756.XXXX.XXXX.XX."
	}
	sum := 0
	for i, c := range d[:12] {
		n := int(c - '0')
		if i%2 == 1 {
			n *= 3
		}
		sum += n
	}
	if (10-sum%10)%10 != int(d[12]-'0') {
		return "", "This AHV number has a typo: its check digit does not match."
	}
	return d[:3] + "." + d[3:7] + "." + d[7:11] + "." + d[11:], ""
}

var (
	ibanShape = regexp.MustCompile(`^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$`)
	looksIBAN = regexp.MustCompile(`^[A-Z]{2}\d{2}`)
)

// ibanLengths are the IBAN lengths of the countries the module models; others are checked by shape and checksum.
var ibanLengths = map[string]int{"CH": 21, "LI": 21, "DE": 22, "AT": 20, "FR": 27, "IT": 27, "ES": 24, "NL": 18,
	"BE": 16, "LU": 20, "PL": 28, "GB": 22, "IE": 22, "PT": 25, "DK": 18, "SE": 24, "FI": 18, "CZ": 24}

// bankAccount checks a salary account: an IBAN (mod-97 checksum, its country's length) that is not a QR-IBAN, which
// only receives QR-bill payments. Anything not shaped like an IBAN (a US account and routing number) is kept as given.
func bankAccount(v string) (string, string) {
	a := compact(v)
	if !looksIBAN.MatchString(a) {
		return strings.TrimSpace(v), ""
	}
	if n, ok := ibanLengths[a[:2]]; !ibanShape.MatchString(a) || ok && len(a) != n || !mod97(a) {
		return "", "This IBAN is not valid: check it for a typo."
	}
	if a[:2] == "CH" || a[:2] == "LI" {
		if iid, _ := strconv.Atoi(a[4:9]); iid >= 30000 && iid <= 31999 {
			return "", "This is a QR-IBAN, which only receives QR-bill payments. Enter the account's regular IBAN."
		}
	}
	return a, ""
}

// mod97 is the IBAN checksum (ISO 13616): the rearranged number, letters as 10–35, leaves 1 when divided by 97.
func mod97(iban string) bool {
	var b strings.Builder
	for _, c := range iban[4:] + iban[:4] {
		if c >= 'A' && c <= 'Z' {
			b.WriteString(strconv.Itoa(int(c-'A') + 10))
		} else {
			b.WriteRune(c)
		}
	}
	n, ok := new(big.Int).SetString(b.String(), 10)
	return ok && new(big.Int).Mod(n, big.NewInt(97)).Int64() == 1
}
