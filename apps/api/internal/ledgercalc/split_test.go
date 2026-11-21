package ledgercalc

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/invoicecalc"
)

func TestSplitExpense(t *testing.T) {
	cases := []struct {
		name                   string
		box                    string
		gross                  bool
		lines                  []SplitLine
		total, deductible, net invoicecalc.Money
		want                   []Split
	}{
		{name: "no lines: all on the expense's account", gross: true, total: 10810, deductible: 810, net: 10000,
			want: []Split{{Account: "6500", Net: 10000, Deductible: 810, Taxable: 10000}}},
		{name: "lines without a category: one split, as before", gross: true,
			lines: []SplitLine{{Amount: 5405, Rate: 810}, {Amount: 5405, Rate: 810}}, total: 10810, deductible: 810, net: 10000,
			want: []Split{{Account: "6500", Net: 10000, Deductible: 810, Taxable: 10000}}},
		{name: "two accounts in proportion", gross: true,
			lines: []SplitLine{{Amount: 10810, Rate: 810}, {Account: "6510", Amount: 21620, Rate: 810}}, total: 32430, deductible: 2430, net: 30000,
			want: []Split{{Account: "6500", Net: 10000, Deductible: 810, Taxable: 10000}, {Account: "6510", Net: 20000, Deductible: 1620, Taxable: 20000}}},
		{name: "a line naming the expense's own account joins it", gross: true,
			lines: []SplitLine{{Account: "6510", Amount: 100, Rate: 0}, {Amount: 100, Rate: 0}, {Account: "6500", Amount: 100, Rate: 0}},
			total: 300, net: 300,
			want: []Split{{Account: "6510", Net: 100, Taxable: 100}, {Account: "6500", Net: 200, Taxable: 200}}},
		{name: "thirds lose no cent: the last takes the rest", gross: true,
			lines: []SplitLine{{Account: "6510", Amount: 100, Rate: 810}, {Account: "6570", Amount: 100, Rate: 810}, {Amount: 100, Rate: 810}},
			total: 100, deductible: 7, net: 93,
			want: []Split{{Account: "6510", Net: 31, Deductible: 2, Taxable: 31}, {Account: "6570", Net: 31, Deductible: 2, Taxable: 31},
				{Account: "6500", Net: 31, Deductible: 3, Taxable: 31}}},
		{name: "deductible follows VAT: a zero-rated part claims none", gross: false,
			lines: []SplitLine{{Account: "6510", Amount: 10000, Rate: 810}, {Account: "6300", Amount: 5000, Rate: 0}},
			total: 15810, deductible: 810, net: 15000,
			want: []Split{{Account: "6510", Net: 10000, Deductible: 810, Taxable: 10000}, {Account: "6300", Net: 5000, Taxable: 5000}}},
		{name: "class 4 is material unless the box says otherwise", gross: true,
			lines: []SplitLine{{Account: "4000", Amount: 100}, {Amount: 100}}, total: 200, net: 200,
			want: []Split{{Account: "4000", Material: true, Net: 100, Taxable: 100}, {Account: "6500", Net: 100, Taxable: 100}}},
		{name: "a box set on the expense applies to every split", box: "400", gross: true,
			lines: []SplitLine{{Account: "4000", Amount: 100}, {Amount: 100}}, total: 200, net: 200,
			want: []Split{{Account: "4000", Material: true, Net: 100, Taxable: 100}, {Account: "6500", Material: true, Net: 100, Taxable: 100}}},
		{name: "all lines zero: the last takes everything", gross: true,
			lines: []SplitLine{{Account: "6510"}, {}}, total: 0, net: 0,
			want: []Split{{Account: "6510"}, {Account: "6500"}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := SplitExpense("6500", c.box, c.gross, c.lines, c.total, c.deductible, c.net)
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %+v\nwant %+v", got, c.want)
			}
			var total, deductible, net invoicecalc.Money
			for _, s := range got {
				total, deductible, net = total+s.Net+s.Deductible, deductible+s.Deductible, net+s.Taxable
			}
			if total != c.total || deductible != c.deductible || net != c.net {
				t.Fatalf("parts add up to %d/%d/%d", total, deductible, net)
			}
		})
	}
}

func TestPostExpenseSplitsPerAccount(t *testing.T) {
	e := Expense{ID: "e", Ref: "E1", Party: "Shop", Date: "2026-04-01", Currency: "CHF", Total: 32430, Deductible: 2430,
		ReverseCharge: true, Splits: []Split{
			{Account: "4400", Material: true, Net: 10000, Deductible: 810, AcquisitionTax: 810, AcquisitionDeductible: 405},
			{Account: "6510", Net: 20000, Deductible: 1620, AcquisitionTax: 1620, AcquisitionDeductible: 1620},
		}}
	got := brief(Post(DefaultAccounts(), Sources{Expenses: []Expense{e}}))
	want := [][3]any{
		{"4400", "2000", invoicecalc.Money(10000)}, {"1170", "2000", invoicecalc.Money(810)},
		{"6510", "2000", invoicecalc.Money(20000)}, {"1171", "2000", invoicecalc.Money(1620)},
		{"1170", "2200", invoicecalc.Money(405)}, {"4400", "2200", invoicecalc.Money(405)},
		{"1171", "2200", invoicecalc.Money(1620)},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
}

// A one-account expense posts the same rows through Splits as through Account, as booked expenses did before splits.
func TestPostSingleSplitMatchesLegacy(t *testing.T) {
	legacy := Expense{ID: "e", Ref: "E1", Party: "Shop", Date: "2026-04-01", Currency: "CHF", Account: "4400", Total: 10810,
		Deductible: 810, MaterialVAT: true, PaidOn: "2026-04-02", Method: "card", ReverseCharge: true, AcquisitionTax: 810, AcquisitionDeductible: 810}
	split := legacy
	split.Account, split.MaterialVAT, split.AcquisitionTax, split.AcquisitionDeductible = "", false, 0, 0
	split.Splits = SplitExpense("4400", "", true, nil, 10810, 810, 10000)
	split.Splits[0].AcquisitionTax, split.Splits[0].AcquisitionDeductible = 810, 810
	a, b := Post(DefaultAccounts(), Sources{Expenses: []Expense{legacy}}), Post(DefaultAccounts(), Sources{Expenses: []Expense{split}})
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("legacy %+v\nsplit %+v", a, b)
	}
}
