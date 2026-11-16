package store

import "testing"

func TestPartyStreetLine(t *testing.T) {
	apt := func(s string) *string { return &s }
	tests := []struct {
		name string
		p    Party
		want string
	}{
		{"PL building and flat", Party{Street: "Marszałkowska", StreetNumber: "3", Apt: apt("3"), Country: "PL"}, "Marszałkowska 3/3"},
		{"PL lettered building", Party{Street: "Marszałkowska", StreetNumber: "3A", Apt: apt(" 2 "), Country: "PL"}, "Marszałkowska 3A/2"},
		{"PL no number", Party{Street: "Rynek", Apt: apt("5"), Country: "PL"}, "Rynek, 5"},
		{"CH free-form", Party{Street: "Lerchenstrasse", StreetNumber: "21", Apt: apt("Apt 21"), Country: "CH"}, "Lerchenstrasse 21, Apt 21"},
		{"US suite", Party{Street: "Main St", StreetNumber: "1", Apt: apt("Suite 4B"), Country: "US"}, "Main St 1, Suite 4B"},
		{"no apt", Party{Street: "Bahnhofstrasse", StreetNumber: "1", Country: "CH"}, "Bahnhofstrasse 1"},
		{"blank apt", Party{Street: "Marszałkowska", StreetNumber: "3", Apt: apt("  "), Country: "PL"}, "Marszałkowska 3"},
		{"apt only", Party{Apt: apt("12")}, "12"},
		{"empty", Party{}, ""},
	}
	for _, tc := range tests {
		if got := tc.p.StreetLine(); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
