package invoicecalc

import "testing"

func finalTotals(cur string, lines ...Line) Totals { return Compute(Exclusive, cur, lines, 0) }

func dline(net Money, rate Percent) Line {
	return Line{Quantity: 1000, UnitPrice: net, Category: "S", Rate: rate}
}

func TestDeductNothing(t *testing.T) {
	in := finalTotals("CHF", dline(500000, 810))
	out, prepaid := Deduct(in, nil, "CHF")
	if prepaid != 0 || out.Total != in.Total || out.RoundingAmount != in.RoundingAmount || out.Payable() != in.Payable() {
		t.Fatalf("got %+v %v", out, prepaid)
	}
}

func TestDeductSingle(t *testing.T) {
	in := finalTotals("EUR", dline(500000, 810))
	out, prepaid := Deduct(in, [][]Group{{{"S", 810, 100000, 8100}}}, "EUR")
	g := out.Breakdown[0]
	if g.TaxableAmount != 400000 || g.VATAmount != 32400 || prepaid != 108100 || out.Payable() != 432400 {
		t.Fatalf("got %+v %v %v", out, prepaid, out.Payable())
	}
	if in.Breakdown[0].TaxableAmount != 500000 {
		t.Fatal("input mutated")
	}
}

func TestDeductMixedRates(t *testing.T) {
	in := finalTotals("EUR", dline(300000, 810), dline(200000, 260))
	out, prepaid := Deduct(in, [][]Group{{{"S", 810, 100000, 8100}, {"S", 260, 50000, 1300}}, {{"S", 810, 20000, 1620}}}, "EUR")
	if prepaid != 108100+51300+21620 {
		t.Fatalf("prepaid %v", prepaid)
	}
	want := map[Percent][2]Money{810: {180000, 14580}, 260: {150000, 3900}}
	for _, g := range out.Breakdown {
		if w := want[g.Rate]; g.TaxableAmount != w[0] || g.VATAmount != w[1] {
			t.Fatalf("rate %v: %+v", g.Rate, g)
		}
	}
	if out.Total != in.Total-prepaid || out.NetTotal+out.VATTotal != out.Total {
		t.Fatalf("totals %+v", out)
	}
}

func TestDeductRateMissingOnFinal(t *testing.T) {
	in := finalTotals("EUR", dline(500000, 810))
	out, prepaid := Deduct(in, [][]Group{{{"S", 260, 50000, 1300}}}, "EUR")
	if len(out.Breakdown) != 2 || out.Breakdown[1].Rate != 260 || out.Breakdown[1].TaxableAmount != -50000 || out.Breakdown[1].VATAmount != -1300 {
		t.Fatalf("breakdown %+v", out.Breakdown)
	}
	if prepaid != 51300 || out.Total != in.Total-51300 || out.NetTotal+out.VATTotal != out.Total {
		t.Fatalf("got %+v %v", out, prepaid)
	}
}

func TestDeductCashRounding(t *testing.T) {
	in := finalTotals("CHF", dline(100000, 810))               // 1081.00
	out, _ := Deduct(in, [][]Group{{{"S", 810, 1, 0}}}, "CHF") // total 1080.99 -> 1081.00
	if out.Total != 108099 || out.RoundingAmount != 1 || out.Payable() != 108100 {
		t.Fatalf("got %+v", out)
	}
}

func TestDeductEURNotRounded(t *testing.T) {
	in := finalTotals("EUR", dline(100000, 810))
	out, _ := Deduct(in, [][]Group{{{"S", 810, 1, 0}}}, "EUR")
	if out.RoundingAmount != 0 || out.Payable() != 108099 {
		t.Fatalf("got %+v", out)
	}
}
