package invoicepdf

import "testing"

func TestContactLine(t *testing.T) {
	for _, tc := range []struct {
		email, phone *string
		want         string
	}{
		{ptr("info@muster.ch"), ptr("+41786533224"), "info@muster.ch · +41 78 653 32 24"},
		{ptr("info@muster.ch"), nil, "info@muster.ch"},
		{nil, ptr(" +41786533224 "), "+41 78 653 32 24"},
		{ptr(" "), ptr(""), ""},
		{nil, nil, ""},
	} {
		if got := contactLine(tc.email, tc.phone); got != tc.want {
			t.Errorf("contactLine(%v, %v) = %q, want %q", tc.email, tc.phone, got, tc.want)
		}
	}
}
