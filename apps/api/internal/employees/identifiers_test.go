package employees

import "testing"

func TestAHVNumber(t *testing.T) {
	for _, c := range []struct{ in, want, msg string }{
		{"756.9217.0769.85", "756.9217.0769.85", ""}, // the example on the AHV card
		{"7569217076985", "756.9217.0769.85", ""},
		{" 756 9217 0769 85 ", "756.9217.0769.85", ""},
		{"756.9217.0769.86", "", "This AHV number has a typo: its check digit does not match."},
		{"757.9217.0769.85", "", "Enter the AHV number as 756.XXXX.XXXX.XX."},
		{"756.9217.0769", "", "Enter the AHV number as 756.XXXX.XXXX.XX."},
		{"756.92A7.0769.85", "", "Enter the AHV number as 756.XXXX.XXXX.XX."},
	} {
		if got, msg := ahvNumber(c.in); got != c.want || msg != c.msg {
			t.Errorf("ahvNumber(%q) = %q, %q; want %q, %q", c.in, got, msg, c.want, c.msg)
		}
	}
}

func TestBankAccount(t *testing.T) {
	const bad = "This IBAN is not valid: check it for a typo."
	for _, c := range []struct{ in, want, msg string }{
		{"CH93 0076 2011 6238 5295 7", "CH9300762011623852957", ""},
		{"de89 3704 0044 0532 0130 00", "DE89370400440532013000", ""},
		{"GB29 NWBK 6016 1331 9268 19", "GB29NWBK60161331926819", ""},
		{"CH93 0076 2011 6238 5295 8", "", bad}, // checksum
		{"CH93 0076 2011 6238 5295", "", bad},   // length for CH
		{"DE89 3704 0044 0532 0130 0", "", bad}, // length for DE
		{"CH44 3199 9123 0008 8901 2", "", "This is a QR-IBAN, which only receives QR-bill payments. Enter the account's regular IBAN."},
		{"021000021 / 123456789", "021000021 / 123456789", ""}, // US routing and account: kept as given
	} {
		if got, msg := bankAccount(c.in); got != c.want || msg != c.msg {
			t.Errorf("bankAccount(%q) = %q, %q; want %q, %q", c.in, got, msg, c.want, c.msg)
		}
	}
}
