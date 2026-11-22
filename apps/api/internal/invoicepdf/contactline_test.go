package invoicepdf

import "testing"

func TestContactLine(t *testing.T) {
	for _, tc := range []struct {
		email, phone, website *string
		want                  string
	}{
		{ptr("info@muster.ch"), ptr("+41786533224"), nil, "info@muster.ch · +41 78 653 32 24"},
		{ptr("info@muster.ch"), nil, nil, "info@muster.ch"},
		{nil, ptr(" +41786533224 "), nil, "+41 78 653 32 24"},
		{ptr(" "), ptr(""), ptr(" "), ""},
		{nil, nil, nil, ""},
		{ptr("info@muster.ch"), ptr("+41786533224"), ptr("https://www.firma.ch/"), "info@muster.ch · +41 78 653 32 24 · firma.ch"},
		{ptr("info@muster.ch"), nil, ptr("https://firma.ch"), "info@muster.ch · firma.ch"},
	} {
		if got := contactLine(tc.email, tc.phone, tc.website); got != tc.want {
			t.Errorf("contactLine(%v, %v, %v) = %q, want %q", tc.email, tc.phone, tc.website, got, tc.want)
		}
	}
}
