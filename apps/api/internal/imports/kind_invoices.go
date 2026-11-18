package imports

import (
	"context"
	"time"

	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/store"
)

func init() { register(invoicesKind) }

// invoicesKind turns an invoice read from a document into a draft for an existing client: nothing is numbered or
// issued (the gapless series is never consumed by an import), and the person issues the draft as usual. A record
// marked issued_elsewhere is an invoice issued in another system instead: recorded as issued with its own number and
// the uploaded file as its original; a number already used is a conflict the person resolves (skip or overwrite).
var invoicesKind = Kind{
	Name:       "invoices",
	Label:      "Invoices",
	Resource:   "invoices",
	LabelField: "number",
	Prompt: "Extract the invoices this document contains: one record per invoice, with all of its lines. The client is " +
		"the party billed (the buyer), never the seller. Dates are YYYY-MM-DD. currency is the ISO 4217 code (CHF, EUR). " +
		"Amounts are decimals with a dot and no currency symbol or thousands separator (\"1250.50\"). price_basis is gross " +
		"when the line prices include VAT, net otherwise. A line's vat_rate is the percentage (\"8.1\"), never an amount; " +
		"vat_category is S for a taxed line, Z for zero-rated, E for exempt, AE for reverse charge, O when outside VAT. " +
		"unit is one of hour, day, piece, month, km, flat. A discount is never a line: a discount on the whole invoice is " +
		"discount_percent (\"15\"), one on a single line is that line's discount_percent; a discount stated only as an amount " +
		"is the percentage of the subtotal it represents, rounded to two decimals. total is the grand total the document states. Guess nothing: " +
		"a field the document does not carry is null. client_id is always null; the client_ fields are the billed party's details as printed (its address, VAT and registration numbers), used to create that client. issued_elsewhere is true when the document " +
		"is a finished invoice the seller issued, carrying its own invoice number; false for a quote, order, proforma or draft. " +
		"paid_amount and paid_on only when the document states a payment already received (a document marked paid " +
		"without an amount was paid in full: paid_amount is the total), else null; paid_on is null when no payment date " +
		"is stated. instalments is the payment schedule the document shows, one row per instalment with its amount, due " +
		"date and whether the document marks it paid (paid_on when stated); a document marked paid as a whole has every " +
		"instalment paid. null without a schedule.",
	Schema: record(map[string]any{
		"client_id":                  nullable("string", "Always null: the person picks the client"),
		"client_name":                nullable("string", "The billed party's name"),
		"client_vat_number":          nullable("string", "The billed party's VAT or UID number"),
		"client_email":               nullable("string", "The billed party's email address"),
		"client_is_company":          nullable("boolean", "true when the billed party is a company, false for a private person"),
		"client_street":              nullable("string", "The billed party's street, without the house number"),
		"client_street_number":       nullable("string", "The billed party's house number"),
		"client_zip":                 nullable("string", "The billed party's postal code"),
		"client_city":                nullable("string", "The billed party's town or city"),
		"client_country":             nullable("string", "The billed party's country, ISO 3166-1 alpha-2, e.g. CH"),
		"client_registration_number": nullable("string", "The billed party's business registration number"),
		"client_phone":               nullable("string", "The billed party's phone number"),
		"number":                     nullable("string", "The invoice's own number"),
		"reference":                  nullable("string", "The buyer's reference or order number"),
		"issue_date":                 nullable("string", "Invoice date, YYYY-MM-DD"),
		"due_date":                   nullable("string", "Due date, YYYY-MM-DD"),
		"service_date":               nullable("string", "Service date or start of the service period, YYYY-MM-DD"),
		"service_date_end":           nullable("string", "End of the service period, YYYY-MM-DD"),
		"currency":                   nullable("string", "ISO 4217 currency code"),
		"price_basis":                nullable("string", "net or gross"),
		"total":                      nullable("string", "Grand total stated on the document, e.g. 1081.00"),
		"discount_percent":           nullable("string", "Discount on the whole invoice in percent, e.g. 15"),
		"issued_elsewhere":           nullable("boolean", "true for a finished invoice the seller issued with its own number"),
		"paid_amount":                nullable("string", "Amount the document says was already paid, e.g. 500.00"),
		"paid_on":                    nullable("string", "Date that amount was paid, YYYY-MM-DD"),
		"instalments": map[string]any{"type": []string{"array", "null"}, "description": "The payment schedule, in order",
			"items": record(map[string]any{
				"amount":   nullable("string", "Amount of this instalment, e.g. 200.00"),
				"due_date": nullable("string", "Due date of this instalment, YYYY-MM-DD"),
				"paid":     nullable("boolean", "true when the document marks this instalment paid"),
				"paid_on":  nullable("string", "Date this instalment was paid, YYYY-MM-DD"),
			})},
		"lines": map[string]any{"type": []string{"array", "null"}, "description": "The invoice lines, in order",
			"items": record(map[string]any{
				"description":      nullable("string", "What was sold"),
				"quantity":         nullable("string", "Quantity, e.g. 2 or 1.5"),
				"unit":             nullable("string", "hour, day, piece, month, km or flat"),
				"unit_price":       nullable("string", "Price of one unit, e.g. 120.50"),
				"discount_percent": nullable("string", "Discount on this line in percent, e.g. 10"),
				"vat_category":     nullable("string", "S, Z, E, AE, K, G or O"),
				"vat_rate":         nullable("string", "VAT rate in percent, e.g. 8.1"),
			})},
	}),
	Check: func(ctx context.Context, q store.Q, workspaceID string, data Data) (map[string]string, error) {
		_, invalid, err := importedInvoice(ctx, q, workspaceID, time.Now().UTC().Format(time.DateOnly), data)
		return invalid, err
	},
	Duplicate: func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportDuplicate, error) {
		if c, err := invoices.NumberConflict(ctx, q, workspaceID, data); err != nil || c != nil {
			if c == nil {
				return nil, err
			}
			return &store.ImportDuplicate{ID: c.ID, Label: c.Label, Reason: c.Reason}, nil
		}
		inv, _, err := importedInvoice(ctx, q, workspaceID, time.Now().UTC().Format(time.DateOnly), data)
		if err != nil || inv.ClientID == "" {
			return nil, err
		}
		number := rawText(data["number"])
		note := ""
		if number != "" {
			note = invoices.ImportedNote(number)
		}
		return q.SimilarInvoice(ctx, workspaceID, inv.ClientID, note, number, rawText(data["issue_date"]), int64(inv.Total))
	},
	Create: func(ctx context.Context, q store.Q, sess store.Session, data Data, src Source) (string, error) {
		clientID, err := importedClient(ctx, q, sess.Workspace.ID, data)
		if err != nil {
			return "", err
		}
		doc, err := original(ctx, data, src)
		if err != nil {
			return "", err
		}
		return invoices.CreateImport(ctx, q, sess, clientID, data, doc)
	},
	Conflict: func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportConflict, error) {
		return invoices.NumberConflict(ctx, q, workspaceID, data)
	},
	Overwrite: func(ctx context.Context, q store.Q, sess store.Session, data Data, src Source, id string) (string, error) {
		clientID, err := importedClient(ctx, q, sess.Workspace.ID, data)
		if err != nil {
			return "", err
		}
		doc, err := original(ctx, data, src)
		if err != nil {
			return "", err
		}
		return invoices.OverwriteImport(ctx, q, sess, id, clientID, data, doc)
	},
}

// original is the Document an invoice issued elsewhere keeps as its original: the upload's, or for a ZIP entry one
// stored for it now. A draft import links the upload's Document only.
func original(ctx context.Context, data Data, src Source) (*string, error) {
	if src.DocumentID != nil || string(data["issued_elsewhere"]) != "true" || src.Document == nil {
		return src.DocumentID, nil
	}
	id, err := src.Document(ctx)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// importedClient: the client the person picked, else the live client with the document's buyer name, VAT number or
// email; "" when none matches (a client is never created by an invoice import).
func importedClient(ctx context.Context, q store.Q, workspaceID string, data Data) (string, error) {
	if id := rawText(data["client_id"]); id != "" {
		return id, nil
	}
	match, err := q.SimilarClient(ctx, workspaceID, rawText(data["client_name"]), rawText(data["client_vat_number"]), rawText(data["client_email"]))
	if match == nil || err != nil {
		return "", err
	}
	return match.ID, nil
}

func importedInvoice(ctx context.Context, q store.Q, workspaceID, today string, data Data) (store.Invoice, map[string]string, error) {
	clientID, err := importedClient(ctx, q, workspaceID, data)
	if err != nil {
		return store.Invoice{}, nil, err
	}
	return invoices.CheckImport(ctx, q, workspaceID, today, clientID, data)
}
