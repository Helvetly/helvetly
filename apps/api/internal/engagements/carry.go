package engagements

import "helvetly.com/api/internal/invoicecalc"

// CarryPeriod is what rollover needs from one period: its own committed quantity and what was used.
type CarryPeriod struct{ Quantity, Used invoicecalc.Quantity }

// Prorate is full × cut days / natural days (days inclusive), rounded half up to 0.01.
// A cut that is not shorter than the natural period, or unparseable dates, keep the full quantity.
func Prorate(full invoicecalc.Quantity, startsOn, cutEndsOn, naturalEndsOn string) invoicecalc.Quantity {
	start, ok1 := parseDate(startsOn)
	cut, ok2 := parseDate(cutEndsOn)
	natural, ok3 := parseDate(naturalEndsOn)
	if !ok1 || !ok2 || !ok3 || !cut.Before(natural) {
		return full
	}
	cutDays, naturalDays := int64(days(start, cut)), int64(days(start, natural))
	if cutDays < 0 {
		cutDays = 0
	}
	// Quantity has three decimals; one step of 0.01 is 10 units.
	step := naturalDays * 10
	return invoicecalc.Quantity((2*int64(full)*cutDays + step) / (2 * step) * 10)
}

// CarryIn returns, per period, the quantity carried in from the previous one. Carry lives one period:
// carried_in(n) = max(0, quantity(n-1) − max(0, used(n-1) − carried_in(n-1))).
func CarryIn(periods []CarryPeriod) []invoicecalc.Quantity {
	out := make([]invoicecalc.Quantity, len(periods))
	for i := 1; i < len(periods); i++ {
		p := periods[i-1]
		out[i] = max(0, p.Quantity-max(0, p.Used-out[i-1]))
	}
	return out
}
