package invoicecalc

import "testing"

func TestParsePercent(t *testing.T) {
	tests := []struct {
		in   string
		want Percent
		ok   bool
	}{
		{"0", 0, true},
		{"8.1", 810, true},
		{"12.5", 1250, true},
		{"100", 10000, true},
		{"100.00", 10000, true},
		{" 2.6 ", 260, true},
		{"100.01", 0, false},
		{"150", 0, false},
		{"-1", 0, false},
		{"-0.01", 0, false},
		{"kkk2.6", 0, false},
		{"2.6%", 0, false},
		{"12,5", 0, false},
		{"8.123", 0, false},
		{"", 0, false},
		{".5", 0, false},
	}
	for _, tt := range tests {
		got, ok := ParsePercent(tt.in)
		if ok != tt.ok || (ok && got != tt.want) {
			t.Errorf("ParsePercent(%q) = %d, %v; want %d, %v", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}
