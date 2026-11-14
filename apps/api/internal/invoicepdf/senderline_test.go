package invoicepdf

import "testing"

func TestSenderLine(t *testing.T) {
	for _, tc := range []struct {
		parts []string
		want  string
	}{
		{[]string{"Acme AG", "Bahnhofstrasse 1", "8001 Zürich"}, "Acme AG, Bahnhofstrasse 1, 8001 Zürich"},
		{[]string{"", " ", " "}, ""},
		{[]string{"Acme AG", " ", "8001 Zürich"}, "Acme AG, 8001 Zürich"},
	} {
		if got := senderLine(tc.parts...); got != tc.want {
			t.Errorf("senderLine(%q) = %q, want %q", tc.parts, got, tc.want)
		}
	}
}
