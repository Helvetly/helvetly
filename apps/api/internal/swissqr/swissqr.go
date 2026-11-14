// Package swissqr is the data side of the Swiss QR bill (SIX IG 2.4, in force from 2026-11-14; its payload is that
// of 2.3): IBAN and QR-IBAN checks, QRR and SCOR (ISO 11649) payment references, and the QR code's payload.
package swissqr

import (
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/invoicecalc"
)

var ibanPattern = regexp.MustCompile(`^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$`)

// NormalizeIBAN: the IBAN in capitals without spaces, when its ISO 13616 check digits hold (CH and LI also
// need their 21 characters).
func NormalizeIBAN(s string) (string, bool) {
	s = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(s), " ", ""))
	if !ibanPattern.MatchString(s) || mod97(s[4:]+s[:4]) != 1 {
		return "", false
	}
	if (s[:2] == "CH" || s[:2] == "LI") && len(s) != 21 {
		return "", false
	}
	return s, true
}

// mod97 of an alphanumeric string with letters as 10–35 (ISO 7064 MOD 97-10).
func mod97(s string) int64 {
	var digits strings.Builder
	for _, r := range s {
		if r >= 'A' && r <= 'Z' {
			digits.WriteString(strconv.Itoa(int(r-'A') + 10))
		} else {
			digits.WriteRune(r)
		}
	}
	n, _ := new(big.Int).SetString(digits.String(), 10)
	return new(big.Int).Mod(n, big.NewInt(97)).Int64()
}

// QRBill: the IBAN can receive a Swiss QR bill (a Swiss or Liechtenstein account).
func QRBill(iban string) bool { return strings.HasPrefix(iban, "CH") || strings.HasPrefix(iban, "LI") }

// IsQRIBAN: a CH/LI IBAN whose institution id (positions 5–9) is 30000–31999; it takes QRR references only.
func IsQRIBAN(iban string) bool {
	if !QRBill(iban) || len(iban) != 21 {
		return false
	}
	iid, err := strconv.Atoi(iban[4:9])
	return err == nil && iid >= 30000 && iid <= 31999
}

var qrrTable = [10]int{0, 9, 4, 6, 8, 2, 7, 1, 3, 5}

// qrrCheck: the modulo 10 recursive check digit of a digit string.
func qrrCheck(digits string) byte {
	carry := 0
	for _, r := range digits {
		carry = qrrTable[(carry+int(r-'0'))%10]
	}
	return byte('0' + (10-carry)%10)
}

// QRR: the 27-digit QR reference for a payload of up to 26 digits (left-padded with zeros).
func QRR(payload string) string {
	p := strings.Repeat("0", 26-len(payload)) + payload
	return p + string(qrrCheck(p))
}

var qrrPattern = regexp.MustCompile(`^[0-9]{27}$`)

func ValidQRR(ref string) bool {
	return qrrPattern.MatchString(ref) && qrrCheck(ref[:26]) == ref[26] && strings.Trim(ref, "0") != ""
}

// SCOR: the ISO 11649 creditor reference RFxx for an alphanumeric body of up to 21 characters.
func SCOR(body string) string {
	body = strings.ToUpper(body)
	check := 98 - mod97(body+"RF00")
	return "RF" + strconv.FormatInt(check/10, 10) + strconv.FormatInt(check%10, 10) + body
}

var scorPattern = regexp.MustCompile(`^RF[0-9]{2}[A-Z0-9]{1,21}$`)

func ValidSCOR(ref string) bool { return scorPattern.MatchString(ref) && mod97(ref[4:]+ref[:4]) == 1 }

// FormatIBAN, FormatSCOR: groups of four from the left; FormatQRR: groups of five from the right.
func FormatIBAN(s string) string { return groupLeft(s, 4) }
func FormatSCOR(s string) string { return groupLeft(s, 4) }
func FormatQRR(s string) string {
	head := len(s) % 5
	out := s[:head]
	for i := head; i < len(s); i += 5 {
		out += " " + s[i:i+5]
	}
	return strings.TrimSpace(out)
}

func groupLeft(s string, n int) string {
	var parts []string
	for i := 0; i < len(s); i += n {
		parts = append(parts, s[i:min(i+n, len(s))])
	}
	return strings.Join(parts, " ")
}

// Address is a structured address (type S).
type Address struct{ Name, Street, Number, Zip, City, Country string }

type Bill struct {
	IBAN          string
	Creditor      Address
	Amount        invoicecalc.Money
	Currency      string // CHF, or EUR to a normal IBAN (IG 2.4: a QR-IBAN is CHF only)
	Debtor        *Address
	ReferenceType string // QRR, SCOR or NON
	Reference     string
	Message       string // unstructured message, ≤ 140
}

// Normalized returns the exact printable data encoded in the QR code, without mutating the debtor.
func (b Bill) Normalized() Bill {
	normalize := func(a Address) Address {
		return Address{Name: clean(a.Name, 70), Street: clean(a.Street, 70), Number: clean(a.Number, 16),
			Zip: clean(a.Zip, 16), City: clean(a.City, 35), Country: a.Country}
	}
	b.Creditor = normalize(b.Creditor)
	if b.Debtor != nil {
		a := normalize(*b.Debtor)
		b.Debtor = &a
	}
	b.Message = clean(b.Message, 140)
	return b
}

// Payload is the QR code's content, element by element (IG 2.4, section 4.3.3). Trailing optional elements
// (bill information, alternative schemes) are left out.
func (b Bill) Payload() string {
	b = b.Normalized()
	lines := []string{"SPC", "0200", "1", b.IBAN}
	lines = append(lines, address(&b.Creditor)...)
	lines = append(lines, "", "", "", "", "", "", "") // ultimate creditor: reserved
	lines = append(lines, b.Amount.String(), b.Currency)
	lines = append(lines, address(b.Debtor)...)
	lines = append(lines, b.ReferenceType, b.Reference, b.Message, "EPD")
	return strings.Join(lines, "\n")
}

func address(a *Address) []string {
	if a == nil {
		return []string{"", "", "", "", "", "", ""}
	}
	return []string{"S", a.Name, a.Street, a.Number, a.Zip, a.City, a.Country}
}

// clean keeps the characters the QR bill allows (IG 2.4 extended Latin), each other one becoming ".", on one
// line, at most max characters.
func clean(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	out := strings.Map(func(r rune) rune {
		if (r >= 0x20 && r <= 0x7E) || (r >= 0xA0 && r <= 0x17F) || (r >= 0x218 && r <= 0x21B) || r == 0x20AC {
			return r
		}
		return '.'
	}, s)
	if utf8.RuneCountInString(out) > max {
		out = string([]rune(out)[:max])
	}
	return out
}
