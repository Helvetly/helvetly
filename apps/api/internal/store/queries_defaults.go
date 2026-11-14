package store

import (
	"context"

	"helvetly.com/api/internal/invoicecalc"
)

// WorkspaceDefaults: what expenses and the product catalogue take from the invoice settings.
type WorkspaceDefaults struct {
	Currency       string              `json:"currency"`
	VATRegistered  bool                `json:"vat_registered"`
	DefaultVATRate invoicecalc.Percent `json:"default_vat_rate"`
}

// Defaults reads them, falling back to the invoice settings' own defaults (CHF, registered, 8.1 %).
func (q Q) Defaults(ctx context.Context, workspaceID string) (WorkspaceDefaults, error) {
	d := WorkspaceDefaults{Currency: "CHF", VATRegistered: true, DefaultVATRate: 810}
	_, err := q.InvoiceSettings(ctx, workspaceID, &d)
	return d, err
}
