package invoicecalc

import (
	"slices"
	"testing"
)

func line(qty, price, discount, category, rate string) Line {
	q, _ := ParseQuantity(qty)
	p, _ := ParseMoney(price)
	d, _ := ParsePercent(discount)
	r, _ := ParsePercent(rate)
	return Line{Quantity: q, UnitPrice: p, Discount: d, Category: category, Rate: r}
}

func TestCompute(t *testing.T) {
	type group struct{ category, rate, taxable, vat string }
	tests := []struct {
		name, mode, currency, discount string
		lines                          []Line
		amounts                        []string
		subtotal, discountAmt, net     string
		breakdown                      []group
		vat, total, rounding           string
	}{
		{name: "exclusive, one rate", mode: Exclusive, currency: "CHF", discount: "0",
			lines: []Line{line("2", "100.00", "0", "S", "8.1")}, amounts: []string{"200.00"},
			subtotal: "200.00", discountAmt: "0.00", net: "200.00", breakdown: []group{{"S", "8.1", "200.00", "16.20"}},
			vat: "16.20", total: "216.20", rounding: "0.00"},
		{name: "CHF rounds the payable to 0.05", mode: Exclusive, currency: "CHF", discount: "0",
			lines: []Line{line("1", "10.00", "0", "S", "8.1")}, amounts: []string{"10.00"},
			subtotal: "10.00", discountAmt: "0.00", net: "10.00", breakdown: []group{{"S", "8.1", "10.00", "0.81"}},
			vat: "0.81", total: "10.81", rounding: "-0.01"},
		{name: "EUR is not cash-rounded", mode: Exclusive, currency: "EUR", discount: "0",
			lines: []Line{line("1", "10.00", "0", "S", "8.1")}, amounts: []string{"10.00"},
			subtotal: "10.00", discountAmt: "0.00", net: "10.00", breakdown: []group{{"S", "8.1", "10.00", "0.81"}},
			vat: "0.81", total: "10.81", rounding: "0.00"},
		{name: "inclusive, exact", mode: Inclusive, currency: "CHF", discount: "0",
			lines: []Line{line("1", "108.10", "0", "S", "8.1")}, amounts: []string{"108.10"},
			subtotal: "108.10", discountAmt: "0.00", net: "100.00", breakdown: []group{{"S", "8.1", "100.00", "8.10"}},
			vat: "8.10", total: "108.10", rounding: "0.00"},
		{name: "inclusive, VAT extracted from gross", mode: Inclusive, currency: "CHF", discount: "0",
			lines: []Line{line("1", "100.00", "0", "S", "8.1")}, amounts: []string{"100.00"},
			subtotal: "100.00", discountAmt: "0.00", net: "92.51", breakdown: []group{{"S", "8.1", "92.51", "7.49"}},
			vat: "7.49", total: "100.00", rounding: "0.00"},
		{name: "inclusive with a document discount", mode: Inclusive, currency: "CHF", discount: "10",
			lines: []Line{line("1", "108.10", "0", "S", "8.1")}, amounts: []string{"108.10"},
			subtotal: "108.10", discountAmt: "10.81", net: "90.00", breakdown: []group{{"S", "8.1", "90.00", "7.29"}},
			vat: "7.29", total: "97.29", rounding: "0.01"},
		{name: "mixed rates and an exempt line, sorted by rate", mode: Exclusive, currency: "CHF", discount: "0",
			lines:   []Line{line("1", "50.00", "0", "E", "0"), line("3", "10.00", "0", "S", "2.6"), line("1", "100.00", "0", "S", "8.1")},
			amounts: []string{"50.00", "30.00", "100.00"}, subtotal: "180.00", discountAmt: "0.00", net: "180.00",
			breakdown: []group{{"S", "8.1", "100.00", "8.10"}, {"S", "2.6", "30.00", "0.78"}, {"E", "0", "50.00", "0.00"}},
			vat:       "8.88", total: "188.88", rounding: "0.02"},
		{name: "line discount rounds half away from zero", mode: Exclusive, currency: "EUR", discount: "0",
			lines: []Line{line("1.5", "33.33", "10", "S", "8.1")}, amounts: []string{"45.00"},
			subtotal: "45.00", discountAmt: "0.00", net: "45.00", breakdown: []group{{"S", "8.1", "45.00", "3.65"}},
			vat: "3.65", total: "48.65", rounding: "0.00"},
		{name: "document discount allocated by largest remainder", mode: Exclusive, currency: "CHF", discount: "3.33",
			lines:   []Line{line("1", "10.00", "0", "S", "8.1"), line("1", "10.00", "0", "S", "2.6"), line("1", "10.00", "0", "Z", "0")},
			amounts: []string{"10.00", "10.00", "10.00"}, subtotal: "30.00", discountAmt: "1.00", net: "29.00",
			breakdown: []group{{"S", "8.1", "9.66", "0.78"}, {"S", "2.6", "9.67", "0.25"}, {"Z", "0", "9.67", "0.00"}},
			vat:       "1.03", total: "30.03", rounding: "0.02"},
		{name: "same category and rate share a group", mode: Exclusive, currency: "CHF", discount: "0",
			lines:   []Line{line("1", "10.00", "0", "S", "8.1"), line("2", "5.00", "0", "S", "8.1")},
			amounts: []string{"10.00", "10.00"}, subtotal: "20.00", discountAmt: "0.00", net: "20.00",
			breakdown: []group{{"S", "8.1", "20.00", "1.62"}}, vat: "1.62", total: "21.62", rounding: "-0.02"},
		{name: "not VAT-registered: one O group", mode: None, currency: "CHF", discount: "0",
			lines:   []Line{line("1", "10.00", "0", "S", "8.1"), line("1", "5.00", "0", "O", "0")},
			amounts: []string{"10.00", "5.00"}, subtotal: "15.00", discountAmt: "0.00", net: "15.00",
			breakdown: []group{{"O", "0", "15.00", "0.00"}}, vat: "0.00", total: "15.00", rounding: "0.00"},
		{name: "full discount never goes negative", mode: Exclusive, currency: "CHF", discount: "100",
			lines: []Line{line("1", "10.00", "100", "S", "8.1")}, amounts: []string{"0.00"},
			subtotal: "0.00", discountAmt: "0.00", net: "0.00", breakdown: []group{{"S", "8.1", "0.00", "0.00"}},
			vat: "0.00", total: "0.00", rounding: "0.00"},
		{name: "no lines", mode: Exclusive, currency: "CHF", discount: "0", amounts: []string{},
			subtotal: "0.00", discountAmt: "0.00", net: "0.00", breakdown: []group{}, vat: "0.00", total: "0.00", rounding: "0.00"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d, _ := ParsePercent(tt.discount)
			got := Compute(tt.mode, tt.currency, tt.lines, d)
			amounts := []string{}
			for _, a := range got.Amounts {
				amounts = append(amounts, a.String())
			}
			breakdown := []group{}
			for _, g := range got.Breakdown {
				breakdown = append(breakdown, group{g.Category, g.Rate.String(), g.TaxableAmount.String(), g.VATAmount.String()})
			}
			if !slices.Equal(amounts, tt.amounts) || !slices.Equal(breakdown, tt.breakdown) {
				t.Fatalf("amounts %v breakdown %v, want %v %v", amounts, breakdown, tt.amounts, tt.breakdown)
			}
			for _, c := range []struct{ name, got, want string }{
				{"subtotal", got.Subtotal.String(), tt.subtotal}, {"discount", got.DiscountAmount.String(), tt.discountAmt},
				{"net", got.NetTotal.String(), tt.net}, {"vat", got.VATTotal.String(), tt.vat},
				{"total", got.Total.String(), tt.total}, {"rounding", got.RoundingAmount.String(), tt.rounding},
			} {
				if c.got != c.want {
					t.Errorf("%s = %s, want %s", c.name, c.got, c.want)
				}
			}
			if got.NetTotal != got.Subtotal-got.DiscountAmount && tt.mode != Inclusive {
				t.Errorf("net %s ≠ subtotal − discount", got.NetTotal)
			}
		})
	}
}

func TestAllocate(t *testing.T) {
	tests := []struct {
		total       Money
		parts, want []Money
	}{
		{100, []Money{1, 1, 1}, []Money{34, 33, 33}},
		{7, []Money{10, 20, 70}, []Money{1, 1, 5}},
		{5, []Money{0, 0}, []Money{0, 0}},
		{0, []Money{3, 4}, []Money{0, 0}},
		{9, []Money{9}, []Money{9}},
	}
	for _, tt := range tests {
		if got := allocate(tt.total, tt.parts); !slices.Equal(got, tt.want) {
			t.Errorf("allocate(%d, %v) = %v, want %v", tt.total, tt.parts, got, tt.want)
		}
	}
}

func TestCashRound(t *testing.T) {
	for in, want := range map[Money]Money{0: 0, 1: 0, 2: 0, 3: 5, 4: 5, 5: 5, 1081: 1080, 1083: 1085, -1081: -1080, -1083: -1085} {
		if got := CashRound(in); got != want {
			t.Errorf("CashRound(%d) = %d, want %d", in, got, want)
		}
	}
}

func TestDecimals(t *testing.T) {
	money := map[string]Money{"1234.5": 123450, "0": 0, "0.05": 5, "999999999.99": 99999999999}
	for in, want := range money {
		if got, ok := ParseMoney(in); !ok || got != want {
			t.Errorf("ParseMoney(%q) = %d, %v", in, got, ok)
		}
	}
	for _, in := range []string{"", "-1", "1.234", "1,5", "abc", "1e3", ".5", "1."} {
		if _, ok := ParseMoney(in); ok {
			t.Errorf("ParseMoney(%q) accepted", in)
		}
	}
	if q, ok := ParseQuantity("0.125"); !ok || q != 125 || q.String() != "0.125" {
		t.Errorf("quantity 0.125 = %d %v %s", q, ok, q)
	}
	if _, ok := ParsePercent("100.01"); ok {
		t.Error("percent over 100 accepted")
	}
	for m, want := range map[Money]string{123456789: "1'234'567.89", 50: "0.50", -5: "-0.05", 100000: "1'000.00", -123456: "-1'234.56"} {
		if got := m.Swiss("'"); got != want {
			t.Errorf("Swiss(%d) = %s, want %s", m, got, want)
		}
	}
	for p, want := range map[Percent]string{810: "8.1", 0: "0", 10000: "100", 5: "0.05"} {
		if got := p.String(); got != want {
			t.Errorf("Percent(%d) = %s, want %s", p, got, want)
		}
	}
}
