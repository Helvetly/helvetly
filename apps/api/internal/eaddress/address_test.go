package eaddress

import "testing"

func TestNormalise(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   Address
		ok   bool
	}{
		{"registered GLN", Address{"0088", "7300010000001"}, true},
		{"GLN checksum", Address{"0088", "7300010000002"}, false},
		{"Swiss business ID", Address{"0183", "CHE109322551"}, true},
		{"Polish VAT scheme", Address{"9945", "PL5260250274"}, true},
		{"email is not EAS", Address{"EM", "ap@example.com"}, false},
		{"unknown scheme", Address{"9999", "123"}, false},
		{"empty ID", Address{"0088", ""}, false},
		{"control characters", Address{"0183", "CHE109\n322551"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Normalise(tc.in)
			if (err == nil) != tc.ok {
				t.Fatalf("Normalise(%+v) = %v; ok=%v", tc.in, err, tc.ok)
			}
		})
	}
}
