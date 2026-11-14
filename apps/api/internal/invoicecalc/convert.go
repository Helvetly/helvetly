package invoicecalc

// Rate is an exchange rate in millionths (1.0525 = 1_052_500), JSON "1.0525": how many units of one
// currency buy one unit of another.
type Rate int64

const RateOne Rate = 1_000_000

// ParseRate reads a rate above 0 with at most six decimals.
func ParseRate(s string) (Rate, bool) {
	n, ok := parseFixed(s, 6)
	return Rate(n), ok && n > 0
}

func (r Rate) String() string               { return formatFixed(int64(r), 6, true) }
func (r Rate) MarshalJSON() ([]byte, error) { return []byte(`"` + r.String() + `"`), nil }

// Convert = round2(m × rate): the amount in the other currency.
func Convert(m Money, r Rate) Money {
	return Money(divRound(mul(int64(m), int64(r)), int64(RateOne)))
}

// Share = round2(m × p / 100), e.g. the deductible part of a VAT amount.
func Share(m Money, p Percent) Money {
	return Money(divRound(mul(int64(m), int64(p)), int64(Hundred)))
}
