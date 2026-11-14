// Package invoicecalc is the invoice computation engine (docs/invoices-contract.md, "Computation"): exact
// fixed-point amounts and the totals of a document, with every rounding step explicit (half away from zero).
package invoicecalc

import (
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// Money is an amount in minor units (cents), JSON "1234.50".
type Money int64

// Quantity is in thousandths, JSON "1.5".
type Quantity int64

// Percent is in hundredths of a percent (8.1 % = 810), JSON "8.1". VAT rates and discounts use it.
type Percent int64

const Hundred Percent = 10_000

var decimalPattern = regexp.MustCompile(`^(\d{1,12})(?:\.(\d+))?$`)

// parseFixed reads a non-negative decimal with at most `places` decimals into units of 10^-places.
func parseFixed(s string, places int) (int64, bool) {
	m := decimalPattern.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil || len(m[2]) > places {
		return 0, false
	}
	frac := m[2] + strings.Repeat("0", places-len(m[2]))
	n, err := strconv.ParseInt(m[1]+frac, 10, 64)
	return n, err == nil
}

// formatFixed writes units of 10^-places; trim drops trailing zeros (and the point when nothing is left).
func formatFixed(n int64, places int, trim bool) string {
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	s := strconv.FormatInt(n, 10)
	if len(s) <= places {
		s = strings.Repeat("0", places-len(s)+1) + s
	}
	whole, frac := s[:len(s)-places], s[len(s)-places:]
	if trim {
		frac = strings.TrimRight(frac, "0")
	}
	if frac == "" {
		return sign + whole
	}
	return sign + whole + "." + frac
}

func ParseMoney(s string) (Money, bool) {
	n, ok := parseFixed(s, 2)
	return Money(n), ok
}

func ParseQuantity(s string) (Quantity, bool) {
	n, ok := parseFixed(s, 3)
	return Quantity(n), ok
}

// ParsePercent reads 0–100 with at most two decimals.
func ParsePercent(s string) (Percent, bool) {
	n, ok := parseFixed(s, 2)
	return Percent(n), ok && Percent(n) <= Hundred
}

func (m Money) String() string    { return formatFixed(int64(m), 2, false) }
func (q Quantity) String() string { return formatFixed(int64(q), 3, true) }
func (p Percent) String() string  { return formatFixed(int64(p), 2, true) }

func (m Money) MarshalJSON() ([]byte, error)    { return []byte(`"` + m.String() + `"`), nil }
func (q Quantity) MarshalJSON() ([]byte, error) { return []byte(`"` + q.String() + `"`), nil }
func (p Percent) MarshalJSON() ([]byte, error)  { return []byte(`"` + p.String() + `"`), nil }

// UnmarshalJSON reads what MarshalJSON wrote (stored snapshots); requests are validated field by field instead.
func (m *Money) UnmarshalJSON(b []byte) error {
	n, err := unmarshalFixed(b, 2)
	*m = Money(n)
	return err
}

func (q *Quantity) UnmarshalJSON(b []byte) error {
	n, err := unmarshalFixed(b, 3)
	*q = Quantity(n)
	return err
}

func (p *Percent) UnmarshalJSON(b []byte) error {
	n, err := unmarshalFixed(b, 2)
	*p = Percent(n)
	return err
}

func unmarshalFixed(b []byte, places int) (int64, error) {
	s, err := strconv.Unquote(string(b))
	if err != nil {
		return 0, fmt.Errorf("decimal %s: %w", b, err)
	}
	neg := strings.HasPrefix(s, "-")
	n, ok := parseFixed(strings.TrimPrefix(s, "-"), places)
	if !ok {
		return 0, fmt.Errorf("decimal %q: not a number with at most %d decimals", s, places)
	}
	if neg {
		n = -n
	}
	return n, nil
}

// Swiss writes 1'234.50 (and -1'234.50); sep is the thousands separator ("'" on the invoice, " " on the QR bill).
func (m Money) Swiss(sep string) string {
	s := m.String()
	sign := ""
	if strings.HasPrefix(s, "-") {
		sign, s = "-", s[1:]
	}
	whole, frac, _ := strings.Cut(s, ".")
	var b strings.Builder
	for i, r := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteString(sep)
		}
		b.WriteRune(r)
	}
	return sign + b.String() + "." + frac
}

// divRound: num/den rounded half away from zero (den > 0).
func divRound(num *big.Int, den int64) int64 {
	d := big.NewInt(den)
	q, r := new(big.Int).QuoRem(num, d, new(big.Int))
	if new(big.Int).Abs(new(big.Int).Mul(r, big.NewInt(2))).Cmp(d) >= 0 {
		q.Add(q, big.NewInt(int64(num.Sign())))
	}
	return q.Int64()
}

func mul(vs ...int64) *big.Int {
	p := big.NewInt(1)
	for _, v := range vs {
		p.Mul(p, big.NewInt(v))
	}
	return p
}
