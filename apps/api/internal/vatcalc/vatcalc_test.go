package vatcalc

import (
	"testing"
)

func g(cat string, rate Percent, net, vat Money) Group {
	return Group{Category: cat, Rate: rate, TaxableAmount: net, VATAmount: vat}
}

var sales = []Sale{
	{Ref: "2026-001", SupplyDate: "2026-08-10", Groups: []Group{g("S", 810, 100000, 8100), g("G", 0, 50000, 0)}},
	{Ref: "2026-002", SupplyDate: "2026-08-12", Groups: []Group{g("S", 260, 20000, 520), g("E", 0, 30000, 0)}},
	{Ref: "CN-2026-001", SupplyDate: "2026-08-10", Groups: []Group{g("S", 810, -10000, -810)}},
	{Ref: "2026-003", SupplyDate: "2023-12-20", Groups: []Group{g("S", 770, 40000, 3080)}},
	{Ref: "2026-004", SupplyDate: "2026-09-01", Groups: []Group{g("AE", 0, 25000, 0), g("O", 0, 5000, 0)}},
}

var purchases = []Purchase{
	{Ref: "1", SupplyDate: "2026-08-01", Box: "400", DeductibleVAT: 4050},
	{Ref: "2", SupplyDate: "2026-08-02", Box: "405", DeductibleVAT: 1200},
	{Ref: "3", SupplyDate: "2026-08-03", Box: "405", ReverseCharge: true, Net: 100000, DeductiblePercent: 10000},
}

type want struct {
	ziffer            string
	amount, base, tax Money
}

func check(t *testing.T, r Return, wants []want) {
	t.Helper()
	for _, w := range wants {
		l := r.Line(w.ziffer)
		if l.Ziffer == "" {
			t.Errorf("Ziffer %s missing", w.ziffer)
			continue
		}
		if l.Amount != w.amount || l.Base != w.base || l.Tax != w.tax {
			t.Errorf("Ziffer %s = amount %s base %s tax %s, want %s %s %s", w.ziffer, l.Amount, l.Base, l.Tax, w.amount, w.base, w.tax)
		}
	}
}

func codes(r Return) map[string][]string {
	out := map[string][]string{}
	for _, w := range r.Warnings {
		out[w.Code] = w.Refs
	}
	return out
}

func TestEffectiveMethod(t *testing.T) {
	r := Compute(Settings{Method: Effective}, sales, purchases)
	check(t, r, []want{
		{"200", 255000, 0, 0}, // 1000 + 500 + 200 + 300 − 100 + 400 + 250; the O line is no turnover
		{"220", 50000, 0, 0}, {"221", 25000, 0, 0}, {"230", 30000, 0, 0}, {"235", 0, 0, 0},
		{"289", 105000, 0, 0}, {"299", 150000, 0, 0},
		{"303", 0, 90000, 7290}, // the credit note reduces the 8.1% base
		{"313", 0, 20000, 520},
		{"302", 0, 40000, 3080}, // a 2023 supply invoiced now keeps its former rate
		{"343", 0, 0, 0},
		{"383", 0, 100000, 8100},
		{"399", 18990, 0, 0},
		{"400", 4050, 0, 0}, {"405", 9300, 0, 0}, // 12.00 + the acquisition tax, deductible in full
		{"479", 13350, 0, 0},
		{"500", 5640, 0, 0}, {"510", 0, 0, 0},
	})
	if refs := codes(r)["outside_scope"]; len(refs) != 1 || refs[0] != "2026-004" {
		t.Errorf("outside_scope warning = %v", refs)
	}
	if l := r.Line("235"); l.Tracked {
		t.Error("235 is not tracked by Helvetly")
	}
}

func TestNetTaxRateMethod(t *testing.T) {
	r := Compute(Settings{Method: NetTaxRate, Rates: []NetRate{{Label: "Beratung", Rate: 620}}}, sales, purchases)
	check(t, r, []want{
		{"200", 265890, 0, 0}, // gross: 1081 + 500 + 205.20 + 300 − 108.10 + 430.80 + 250
		{"289", 105000, 0, 0}, {"299", 160890, 0, 0},
		{"323", 0, 117810, 7304}, // 1081 + 205.20 − 108.10 at 6.2% = 73.0422
		{"333", 0, 0, 0},
		{"383", 0, 100000, 8100},
		{"399", 15404, 0, 0},
		{"500", 15404, 0, 0}, {"510", 0, 0, 0},
	})
	if l := r.Line("400"); l.Ziffer != "" {
		t.Error("no input tax lines under the net tax rate method")
	}
	if refs := codes(r)["net_rate_before_2024"]; len(refs) != 1 || refs[0] != "2026-003" {
		t.Errorf("net_rate_before_2024 warning = %v", refs)
	}
}

func TestWarnings(t *testing.T) {
	r := Compute(Settings{Method: Effective}, []Sale{
		{Ref: "a", SupplyDate: "2026-01-05", Groups: []Group{g("S", 1900, 10000, 1900)}}, // a German rate
		{Ref: "b", SupplyDate: "2023-06-01", Groups: []Group{g("S", 810, 10000, 810)}},   // new rate, old supply
	}, []Purchase{{Ref: "c", SupplyDate: "2023-12-31", Box: "400", ReverseCharge: true, Net: 10000}})
	c := codes(r)
	if len(c["unknown_rate"]) != 1 || len(c["rate_date_mismatch"]) != 1 || len(c["acquisition_before_2024"]) != 1 {
		t.Fatalf("warnings = %v", c)
	}
	if l := r.Line("383"); l.Base != 0 {
		t.Errorf("a 2023 acquisition is not on 383: %v", l)
	}
	if l := r.Line("200"); l.Amount != 20000 {
		t.Errorf("200 = %s, want 200.00", l.Amount)
	}

	split := Compute(Settings{Method: NetTaxRate, Rates: []NetRate{{"A", 620}, {"B", 210}, {"C", 100}}}, nil, nil)
	if len(codes(split)["net_rate_split"]) != 0 || split.Line("333").Rate != 210 {
		t.Fatalf("second rate: %v", split.Line("333"))
	}
	if _, ok := codes(split)["net_rate_split"]; !ok {
		t.Error("several rates warn that the turnover must be split")
	}
	extra := 0
	for _, l := range split.Lines {
		if l.Ziffer == "" && l.Rate == 100 {
			extra++
		}
	}
	if extra != 1 {
		t.Errorf("third rate on the supplementary sheet: %d lines", extra)
	}
}

func TestPortion(t *testing.T) {
	for _, c := range []struct {
		paid, payable Money
		net, vat      Money
	}{
		{54050, 108100, 50000, 4050}, // half of 1081.00
		{108100, 108100, 100000, 8100},
		{-10810, 108100, -10000, -810}, // a refund
		{1, 3, 33333, 2700},            // 1/3 rounds half away from zero
	} {
		got := Portion([]Group{g("S", 810, 100000, 8100)}, c.paid, c.payable)
		if got[0].TaxableAmount != c.net || got[0].VATAmount != c.vat {
			t.Errorf("Portion(%d/%d) = %v, want %d/%d", c.paid, c.payable, got[0], c.net, c.vat)
		}
	}
	if Portion([]Group{g("S", 810, 1, 1)}, 1, 0) != nil {
		t.Error("nothing payable, nothing covered")
	}
	if scale(1, 1, 2) != 1 || scale(-1, 1, 2) != -1 {
		t.Error("half rounds away from zero")
	}
	r := Compute(Settings{Method: Effective}, []Sale{{Ref: "x", SupplyDate: "2026-07-01", Groups: Portion([]Group{g("S", 810, 100000, 8100)}, 54050, 108100)}}, nil)
	check(t, r, []want{{"303", 0, 50000, 4050}})
}
