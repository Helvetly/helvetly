// Package dunningcalc is the arithmetic of dunning (docs/invoices-contract.md "Dunning"): when the next step is due
// and the amounts of one notice: the open amount, the step's fee and simple default interest (OR 104) to the day.
// Pure: dates are civil dates "YYYY-MM-DD" in the workspace's time zone, amounts exact minor units.
package dunningcalc

import (
	"math/big"
	"time"

	"helvetly.com/api/internal/invoicecalc"
)

type Money = invoicecalc.Money

// Timing: when a step goes out. BeforeDue and AfterDue count Days from the invoice's due date, AfterPrevious from the
// day the previous notice was sent.
type Timing string

const (
	BeforeDue     Timing = "before_due"
	AfterDue      Timing = "after_due"
	AfterPrevious Timing = "after_previous"
)

// Step is one configured reminder.
type Step struct {
	Timing Timing
	Days   int
}

// MaxSteps per workspace; MaxDaysBefore: the earliest a note before the due date goes out.
const (
	MaxSteps      = 10
	MaxDaysBefore = 30
)

// Offsets: each step's planned day relative to the due date (negative before it), AfterPrevious counted from the
// planned day of the step before.
func Offsets(steps []Step) []int {
	out := make([]int, len(steps))
	for i, s := range steps {
		switch {
		case s.Timing == BeforeDue:
			out[i] = -s.Days
		case s.Timing == AfterPrevious && i > 0:
			out[i] = out[i-1] + s.Days
		default:
			out[i] = s.Days
		}
	}
	return out
}

// Problems: why each step cannot be where it is in the list, "" when it can. Notes before the due date come first,
// "after the previous" never follows one (it would count from a note), and each step comes after the one before.
func Problems(steps []Step) []string {
	out := make([]string, len(steps))
	at := Offsets(steps)
	for i, s := range steps {
		switch {
		case s.Timing == AfterPrevious && i == 0:
			out[i] = "The first reminder counts from the due date."
		case s.Timing == AfterPrevious && steps[i-1].Timing == BeforeDue:
			out[i] = "Count from the due date after a note before it."
		case i > 0 && at[i] <= at[i-1]:
			out[i] = "Each reminder must come after the one before it."
		}
	}
	return out
}

// Next: the step (1-based) to send next for an invoice issued on issueDate and due on dueDate, after step last (0
// before the first), on today; 0 when none is left. A note before the due date is skipped once the due date has
// passed or when it would have gone out before the invoice was issued.
func Next(issueDate, dueDate, today string, last int, steps []Step) int {
	for n := max(last, 0) + 1; n <= len(steps); n++ {
		s := steps[n-1]
		if s.Timing == BeforeDue && (today > dueDate || addDays(dueDate, -s.Days) < issueDate) {
			continue
		}
		return n
	}
	return 0
}

// DueOn: the civil date step next (1-based) is due, given the invoice's due date and the date the previous notice
// was sent ("" for none); "" when there is no such step.
func DueOn(dueDate, previousSentOn string, steps []Step, next int) string {
	if next < 1 || next > len(steps) {
		return ""
	}
	s := steps[next-1]
	switch {
	case s.Timing == BeforeDue:
		return addDays(dueDate, -s.Days)
	case s.Timing == AfterPrevious && previousSentOn != "":
		return addDays(previousSentOn, s.Days)
	default:
		return addDays(dueDate, s.Days)
	}
}

// InterestFrom: the first day of default interest, "" while there is none. With fromDueDate (the due date was
// agreed, a Verfalltag, OR 102 para. 2) the debtor is in default the day after it; otherwise from the day after the
// first notice after the due date reached them (OR 102 para. 1), approximated by the day after it was sent.
func InterestFrom(fromDueDate bool, dueDate, firstSentOn string) string {
	if fromDueDate {
		return addDays(dueDate, 1)
	}
	if firstSentOn == "" {
		return ""
	}
	return addDays(firstSentOn, 1)
}

// Days: the days of interest from from to on, both included; 0 when from is "" or after on.
func Days(from, on string) int {
	if from == "" {
		return 0
	}
	f, err1 := time.Parse(time.DateOnly, from)
	o, err2 := time.Parse(time.DateOnly, on)
	if err1 != nil || err2 != nil || o.Before(f) {
		return 0
	}
	return int(o.Sub(f).Hours()/24) + 1
}

// Interest: simple interest on open at rate a year for days, a year of 365 days, half away from zero; CHF to 0.05.
func Interest(open Money, rate invoicecalc.Percent, days int, currency string) Money {
	if open <= 0 || rate <= 0 || days <= 0 {
		return 0
	}
	num := new(big.Int).Mul(big.NewInt(int64(open)), big.NewInt(int64(rate)))
	num.Mul(num, big.NewInt(int64(days)))
	den := big.NewInt(int64(invoicecalc.Hundred) * 365)
	q, r := new(big.Int).QuoRem(num, den, new(big.Int))
	if new(big.Int).Mul(r, big.NewInt(2)).Cmp(den) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	m := Money(q.Int64())
	if currency == "CHF" {
		m = invoicecalc.CashRound(m)
	}
	return m
}

// Amounts of one notice: the total is what the reminder's QR bill asks for.
type Amounts struct {
	Open, Fee, Interest, Total Money
	Days                       int
}

// Notice: the amounts of a notice sent on on, interest accruing from from ("" = none).
func Notice(open, fee Money, rate invoicecalc.Percent, from, on, currency string) Amounts {
	a := Amounts{Open: open, Fee: fee, Days: Days(from, on)}
	a.Interest = Interest(open, rate, a.Days, currency)
	a.Total = a.Open + a.Fee + a.Interest
	return a
}

func addDays(d string, n int) string {
	t, err := time.Parse(time.DateOnly, d)
	if err != nil {
		return ""
	}
	return t.AddDate(0, 0, n).Format(time.DateOnly)
}
