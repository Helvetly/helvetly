package imports

import (
	"context"
	"errors"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/products"
	"helvetly.com/api/internal/store"
)

func init() { register(productsKind) }

// productsKind is the catalogue (products and services): the fields of POST /products with the workspace defaults.
var productsKind = Kind{
	Name:     "products",
	Label:    "Products & services",
	Resource: "products",
	Prompt: "Extract the products and services this document offers for sale (a price list, catalogue, offer or " +
		"spreadsheet): one record per item, not per size row unless each has its own article number. type is product " +
		"for goods and service for work, hours, subscriptions or fees. unit_price is the selling price of one unit as a " +
		"decimal with a dot and no currency symbol (\"120.50\"); when only a purchase cost is shown, unit_price is null. " +
		"price_basis is gross when the price includes VAT, net otherwise. vat_rate is the percentage (\"8.1\"), never an " +
		"amount. unit is one of hour, day, piece, month, km, flat. Guess nothing: a field the document does not carry is null.",
	Schema: record(map[string]any{
		"type":         nullable("string", "product or service"),
		"name":         nullable("string", "Item name"),
		"description":  nullable("string", "Short description"),
		"sku":          nullable("string", "Article number / SKU"),
		"gtin":         nullable("string", "GTIN / EAN barcode digits"),
		"unit":         nullable("string", "hour, day, piece, month, km or flat"),
		"price_basis":  nullable("string", "net or gross"),
		"unit_price":   nullable("string", "Selling price of one unit, e.g. 120.50"),
		"currency":     nullable("string", "ISO 4217 currency code"),
		"vat_category": nullable("string", "EN 16931 VAT category: S, Z, E, AE, K, G or O"),
		"vat_rate":     nullable("string", "VAT rate in percent, e.g. 8.1"),
	}),
	Check: func(ctx context.Context, q store.Q, workspaceID string, data Data) (map[string]string, error) {
		d, err := q.Defaults(ctx, workspaceID)
		if err != nil {
			return nil, err
		}
		_, invalid := products.CheckCreate(data, d)
		return invalid, nil
	},
	Duplicate: func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportDuplicate, error) {
		return q.SimilarProduct(ctx, workspaceID, rawText(data["name"]), rawText(data["sku"]))
	},
	Create: func(ctx context.Context, q store.Q, sess store.Session, data Data, _ Source) (string, error) {
		d, err := q.Defaults(ctx, sess.Workspace.ID)
		if err != nil {
			return "", err
		}
		p, _ := products.CheckCreate(data, d)
		p.ID, p.CreatedAt = auth.NewID("prd"), time.Now().UTC()
		err = q.CreateProduct(ctx, sess.Workspace.ID, p)
		if errors.Is(err, store.ErrSKUTaken) {
			const msg = "Another active item already uses this SKU."
			return "", auth.Error(http.StatusUnprocessableEntity, "validation_failed", msg, map[string]any{"fields": map[string]string{"sku": msg}})
		}
		return p.ID, err
	},
}
