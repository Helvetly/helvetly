package invoices

// unsupportedSellerCountries: where a seller based there cannot invoice with Helvetly yet. Each country's clearance
// or real-time reporting system applies to every seller registered there and Helvetly has no channel to it; the value
// names the system.
var unsupportedSellerCountries = map[string]string{
	"HU": "the NAV Online Számla real-time reporting",
	"PT": "certified invoicing software (ATCUD, QR code, SAF-T)",
	"RO": "RO e-Factura",
}

// unsupportedSeller explains why a seller in country cannot invoice here; "" when it can.
func unsupportedSeller(country string) string {
	system, ok := unsupportedSellerCountries[country]
	if !ok {
		return ""
	}
	return "Helvetly cannot issue invoices for a seller in " + country + " yet: invoices there must go through " +
		system + ", which Helvetly does not support."
}
