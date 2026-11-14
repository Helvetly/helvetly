package clients

import "testing"

func TestLeitwegID(t *testing.T) {
	for _, c := range []struct {
		in, want string
		ok       bool
	}{
		{"04011000-1234512345-06", "04011000-1234512345-06", true},
		{"991-33333test-33", "991-33333TEST-33", true}, // letters in the fine part, upper-cased
		{"04011000-1234512345-07", "", false},          // wrong check digits
		{"991-12345-06", "", false},
		{"1-12345-06", "", false},     // coarse part too short
		{"04011000-12345", "", false}, // no check digits
		{"DE123", "", false},
	} {
		got, msg := LeitwegID(c.in)
		if (msg == "") != c.ok || got != c.want {
			t.Errorf("LeitwegID(%q) = %q, %q", c.in, got, msg)
		}
	}
}
