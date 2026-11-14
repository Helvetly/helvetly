package invoicecalc

import "testing"

func TestConvertAndShare(t *testing.T) {
	tests := []struct{ amount, rate, converted, percent, share string }{
		{"100.00", "0.9412", "94.12", "100", "100.00"},
		{"10.81", "1.052513", "11.38", "50", "5.41"}, // 11.3776… rounds up; 5.405 half away from zero
		{"0.01", "0.5", "0.01", "33.33", "0.00"},     // 0.005 rounds up; 0.0033 down
		{"1234.56", "1", "1234.56", "0", "0.00"},
	}
	for _, tt := range tests {
		m, _ := ParseMoney(tt.amount)
		r, ok := ParseRate(tt.rate)
		p, _ := ParsePercent(tt.percent)
		if !ok {
			t.Fatalf("rate %s did not parse", tt.rate)
		}
		if got := Convert(m, r).String(); got != tt.converted {
			t.Errorf("Convert(%s, %s) = %s, want %s", tt.amount, tt.rate, got, tt.converted)
		}
		if got := Share(m, p).String(); got != tt.share {
			t.Errorf("Share(%s, %s) = %s, want %s", tt.amount, tt.percent, got, tt.share)
		}
	}
	for _, bad := range []string{"0", "-1", "1.1234567", "abc", ""} {
		if _, ok := ParseRate(bad); ok {
			t.Errorf("ParseRate(%q) accepted", bad)
		}
	}
	if r, _ := ParseRate("1.050000"); r.String() != "1.05" {
		t.Errorf("rate string %s", r.String())
	}
}
