package einvoice

import (
	"strings"
	"time"

	"helvetly.com/api/internal/facturx"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/store"
)

// FormatFacturX is the issued PDF as a Factur-X 1.0 / ZUGFeRD 2.x hybrid (PDF/A-3B with the EN 16931 CII XML).
const FormatFacturX = "factur-x"

// FacturX makes the issued PDF a Factur-X file: every page stays as issued, the XML is the document's EN 16931 CII.
func FacturX(inv store.Invoice, pdf []byte, now time.Time) ([]byte, error) {
	xml, err := FacturXML(inv)
	if err != nil {
		return nil, err
	}
	created := now
	if inv.IssuedAt != nil {
		created = *inv.IssuedAt
	}
	return facturx.Embed(pdf, xml, facturx.Meta{
		Title:   strings.TrimSpace(invoicepdf.TitleFor(inv) + " " + deref(inv.Number)),
		Author:  inv.Seller.Name,
		Created: created, Modified: now,
	})
}
