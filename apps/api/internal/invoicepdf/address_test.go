package invoicepdf

import (
	"bytes"
	"testing"
)

// The apartment shares the street line in both party columns: Polish
// "3A/2", elsewhere ", Apt 21", and it never prints as a line of its own.
func TestApartmentOnTheStreetLine(t *testing.T) {
	d := sample("en", 1)
	d.Seller.Street, d.Seller.StreetNumber, d.Seller.Apt, d.Seller.Zip, d.Seller.City, d.Seller.Country =
		"Marszałkowska", "3A", ptr("2"), "00-001", "Warszawa", "PL"
	d.Buyer.Street, d.Buyer.StreetNumber, d.Buyer.Apt = "Lerchenstrasse", "21", ptr("Apt 21")
	text := pageText(t, d)
	for _, want := range []string{
		"Marszałkowska 3A/2",        // billed by
		"Lerchenstrasse 21, Apt 21", // billed to
	} {
		if !bytes.Contains(text, unicodePDFLiteral(want)) {
			t.Errorf("%q missing", want)
		}
	}
	for _, alone := range []string{"2", "Apt 21"} {
		if bytes.Contains(text, unicodePDFLiteral(alone)) {
			t.Errorf("apartment %q is a line of its own", alone)
		}
	}
}

func TestAddressLinesKeepShape(t *testing.T) {
	d := sample("en", 1)
	for _, apt := range []*string{nil, ptr("  "), ptr("7")} {
		d.Buyer.Apt = apt
		if got := addressLines(d.Buyer, "CH"); len(got) != 3 {
			t.Errorf("apt %v: %d lines, want name, street, city", apt, len(got))
		}
	}
}

func TestWithHelvetly(t *testing.T) {
	l := languages["de"]
	if got := withHelvetly("Seite 1 von 2", l, true); got != "Seite 1 von 2  ·  Erstellt mit Helvetly" {
		t.Fatal(got)
	}
	if got := withHelvetly("Seite 1 von 2", l, false); got != "Seite 1 von 2" {
		t.Fatal(got)
	}
}
