package engagements

import (
	"slices"
	"testing"

	"helvetly.com/api/internal/invoicecalc"
)

func TestProrate(t *testing.T) {
	tests := []struct {
		name                string
		full                invoicecalc.Quantity
		start, cut, natural string
		want                invoicecalc.Quantity
	}{
		{"half", 30000, "2026-11-01", "2026-11-15", "2026-11-30", 15000},
		{"rounds half up to 0.01", 10000, "2026-01-01", "2026-01-10", "2026-01-31", 3230},
		{"no cut", 30000, "2026-11-01", "2026-11-30", "2026-11-30", 30000},
		{"exact half step up", 1000, "2026-01-01", "2026-01-01", "2026-01-08", 130},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Prorate(tt.full, tt.start, tt.cut, tt.natural); got != tt.want {
				t.Errorf("got %d want %d", got, tt.want)
			}
		})
	}
}

func TestProrateNoCut(t *testing.T) {
	if got := Prorate(7000, "2026-01-01", "2026-03-31", "2026-03-31"); got != 7000 {
		t.Errorf("got %d", got)
	}
}

func TestCarry(t *testing.T) {
	tests := []struct {
		name string
		in   []CarryPeriod
		want []invoicecalc.Quantity
	}{
		{"mixed", []CarryPeriod{{8000, 5000}, {8000, 12000}, {8000, 0}}, []invoicecalc.Quantity{0, 3000, 0}},
		{"empty", nil, []invoicecalc.Quantity{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CarryIn(tt.in); !slices.Equal(got, tt.want) {
				t.Errorf("got %v want %v", got, tt.want)
			}
		})
	}
}

func TestCarryExpiresAfterOnePeriod(t *testing.T) {
	got := CarryIn([]CarryPeriod{{8000, 0}, {8000, 0}, {8000, 0}})
	if want := []invoicecalc.Quantity{0, 8000, 8000}; !slices.Equal(got, want) {
		t.Errorf("got %v want %v", got, want)
	}
}

func TestProrateInclusiveDaysAndShortCuts(t *testing.T) {
	for _, c := range []struct {
		cut  string
		want invoicecalc.Quantity
	}{{"2026-11-01", 1000}, {"2026-11-30", 30000}, {"2026-10-31", 0}} { // one day of 30; a cut before the start is nothing
		if got := Prorate(30000, "2026-11-01", c.cut, "2026-11-30"); got != c.want {
			t.Errorf("%s: got %d want %d", c.cut, got, c.want)
		}
	}
	if got := Prorate(30000, "2026-11-01", "bad", "2026-11-30"); got != 30000 {
		t.Errorf("bad date: %d", got)
	}
}

func TestCarryManyPeriodsWithProratedAndOverrun(t *testing.T) {
	in := []CarryPeriod{{10000, 4000}, {10000, 15000}, {10000, 0}, {5000, 5000}, {10000, 20000}, {10000, 0}}
	// the 5000 prorated period receives 10000 and passes on 5000; an overrun passes on nothing
	want := []invoicecalc.Quantity{0, 6000, 1000, 10000, 5000, 0}
	if got := CarryIn(in); !slices.Equal(got, want) {
		t.Errorf("got %v want %v", got, want)
	}
}
