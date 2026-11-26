package invoices

import (
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestCatalogueBasisOnIssuedDocument(t *testing.T) {
	e := newEnv(t)
	b, c := e.ready()
	e.do(b, "PUT", "/api/v1/invoice-settings", map[string]any{"iban": "CH93 0076 2011 6238 5295 7"}, 200, nil)
	for _, tc := range []struct{ mode, price, net, vat, gross string }{
		{"inclusive", "0.07", "64.75", "5.25", "70.00"},
		{"exclusive", "0.06", "60.00", "4.86", "64.86"},
	} {
		input := line("1000", tc.price)
		input["catalogue_price_basis"], input["catalogue_unit_price"], input["catalogue_currency"] = "gross", "0.07", "EUR"
		inv := e.issued(b, c, map[string]any{"vat_mode": tc.mode, "currency": "EUR", "lines": []any{input}})
		var stored struct{ Data store.Invoice }
		e.do(b, "GET", path(inv.ID), nil, 200, &stored)
		doc := stored.Data
		src := doc.Lines[0]
		if src.CatalogueUnitPrice == nil || src.CatalogueUnitPrice.String() != "0.07" || deref(src.CataloguePriceBasis) != "gross" || deref(src.CatalogueCurrency) != "EUR" {
			t.Fatal(src)
		}
		if doc.NetTotal.String() != tc.net || doc.VATTotal.String() != tc.vat || doc.Payable().String() != tc.gross {
			t.Fatalf("%s: net %s VAT %s gross %s", tc.mode, doc.NetTotal, doc.VATTotal, doc.Payable())
		}
		pdf := e.storedPDFText(inv.ID)
		for _, figure := range []string{tc.vat, tc.net, tc.gross} {
			if !strings.Contains(pdf, pdfUnicode(figure)) {
				t.Fatalf("%s missing from %s invoice PDF", figure, tc.mode)
			}
		}
	}
}
