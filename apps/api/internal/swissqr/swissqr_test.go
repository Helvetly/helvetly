package swissqr

import (
	"strings"
	"testing"
)

func TestIBAN(t *testing.T) {
	tests := []struct {
		in, want    string
		ok, qr, qrb bool
	}{
		{"CH44 3199 9123 0008 8901 2", "CH4431999123000889012", true, true, true}, // SIX sample QR-IBAN
		{"ch9300762011623852957", "CH9300762011623852957", true, false, true},
		{"LI21 0881 0000 2324 013A A", "LI21088100002324013AA", true, false, true},
		{"DE89 3704 0044 0532 0130 00", "DE89370400440532013000", true, false, false},
		{"CH4431999123000889013", "", false, false, false}, // wrong check digits
		{"CH443199912300088901", "", false, false, false},  // too short for CH
		{"hello", "", false, false, false},
	}
	for _, tt := range tests {
		got, ok := NormalizeIBAN(tt.in)
		if got != tt.want || ok != tt.ok {
			t.Errorf("NormalizeIBAN(%q) = %q %v", tt.in, got, ok)
			continue
		}
		if ok && (IsQRIBAN(got) != tt.qr || QRBill(got) != tt.qrb) {
			t.Errorf("%s: qr-iban %v, qr bill %v", got, IsQRIBAN(got), QRBill(got))
		}
	}
	// the QR-IBAN range is 30000–31999
	for iban, want := range map[string]bool{"CH0230000000000000000": true, "CH0231999000000000000": true, "CH0232000000000000000": false, "CH0229999000000000000": false} {
		if IsQRIBAN(iban) != want {
			t.Errorf("IsQRIBAN(%s) != %v", iban, want)
		}
	}
}

func TestQRR(t *testing.T) {
	if got := QRR("21000000000313947143000901"); got != "210000000003139471430009017" { // SIX sample
		t.Fatalf("QRR = %s", got)
	}
	if got := QRR("2026000001"); len(got) != 27 || !ValidQRR(got) || !strings.HasPrefix(got, "0000000000000000202600000") {
		t.Fatalf("QRR(2026000001) = %s", got)
	}
	for ref, want := range map[string]bool{
		"210000000003139471430009017": true, "210000000003139471430009018": false, "000000000000000000000000000": false,
		"21000000000313947143000901": false, "21000000000313947143000901A": false,
	} {
		if ValidQRR(ref) != want {
			t.Errorf("ValidQRR(%s) != %v", ref, want)
		}
	}
	if got := FormatQRR("210000000003139471430009017"); got != "21 00000 00003 13947 14300 09017" {
		t.Errorf("FormatQRR = %q", got)
	}
}

func TestSCOR(t *testing.T) {
	if got := SCOR("539007547034"); got != "RF18539007547034" { // ISO 11649 sample
		t.Fatalf("SCOR = %s", got)
	}
	for _, body := range []string{"1", "2026000001", "ABC123XYZ", "123456789012345678901"} {
		if ref := SCOR(body); !ValidSCOR(ref) {
			t.Errorf("SCOR(%s) = %s is not valid", body, ref)
		}
	}
	for ref, want := range map[string]bool{"RF18539007547034": true, "RF19539007547034": false, "RF18": false, "XX18539007547034": false} {
		if ValidSCOR(ref) != want {
			t.Errorf("ValidSCOR(%s) != %v", ref, want)
		}
	}
	if got := FormatSCOR("RF18539007547034"); got != "RF18 5390 0754 7034" {
		t.Errorf("FormatSCOR = %q", got)
	}
}

func TestPayload(t *testing.T) {
	b := Bill{IBAN: "CH4431999123000889012", Creditor: Address{Name: "Robert Schneider AG", Street: "Rue du Lac", Number: "1268", Zip: "2501", City: "Biel", Country: "CH"},
		Amount: 194975, Currency: "CHF", Debtor: &Address{Name: "Pia-Maria Rutschmann-Schnyder", Street: "Grosse Marktgasse", Number: "28", Zip: "9400", City: "Rorschach", Country: "CH"},
		ReferenceType: "QRR", Reference: "210000000003139471430009017", Message: "Auftrag vom 15.06.2020\n✓"}
	want := strings.Join([]string{"SPC", "0200", "1", "CH4431999123000889012",
		"S", "Robert Schneider AG", "Rue du Lac", "1268", "2501", "Biel", "CH",
		"", "", "", "", "", "", "",
		"1949.75", "CHF",
		"S", "Pia-Maria Rutschmann-Schnyder", "Grosse Marktgasse", "28", "9400", "Rorschach", "CH",
		"QRR", "210000000003139471430009017", "Auftrag vom 15.06.2020 .", "EPD"}, "\n")
	if got := b.Payload(); got != want {
		t.Fatalf("payload:\n%s\nwant:\n%s", got, want)
	}
	b.Debtor = nil
	if lines := strings.Split(b.Payload(), "\n"); len(lines) != 31 || lines[20] != "" {
		t.Fatalf("no debtor: %d lines", len(lines))
	}
}
