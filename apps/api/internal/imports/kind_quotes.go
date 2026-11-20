package imports

import (
	"context"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/quotes"
	"helvetly.com/api/internal/store"
)

func init() { register(quotesKind) }

// quoteStatuses are the stored statuses a quote can be imported in.
var quoteStatuses = []string{"draft", "sent", "accepted", "declined"}

// quoteKeys: the record fields internal/invoices checks for a quote, as for an imported invoice draft; the quote's own
// number is not one of them (CheckImport would turn it into a note).
var quoteKeys = []string{"issue_date", "currency", "reference", "discount_percent", "price_basis", "total", "lines"}

const quoteValidDays = 30 // as POST /quotes

// quotesKind turns a quote (Offerte) read from a document into a quote of an existing client, keeping the document's
// number and status: a quote sent, accepted or declined in another system stays so; one without a number is a draft.
// A client is never created by a quote import.
var quotesKind = Kind{
	Name:       "quotes",
	Label:      "Quotes",
	Resource:   "invoices", // quotes share the invoices permission (permissions.go: /api/v1/quotes)
	LabelField: "number",
	Prompt: "Extract the quotes (offers, Offerten, offres, offerte, estimates) this document contains: one record per " +
		"quote, with all of its lines. The client is the party the offer is addressed to (the buyer), never the seller. " +
		"Dates are YYYY-MM-DD; valid_until is the date the offer is valid until. currency is the ISO 4217 code (CHF, EUR). " +
		"Amounts are decimals with a dot and no currency symbol or thousands separator (\"1250.50\"). price_basis is gross " +
		"when the line prices include VAT, net otherwise. A line's vat_rate is the percentage (\"8.1\"), never an amount; " +
		"vat_category is S for a taxed line, Z for zero-rated, E for exempt, AE for reverse charge, O when outside VAT. " +
		"unit is one of hour, day, piece, month, km, flat. A discount is never a line: a discount on the whole quote is " +
		"discount_percent (\"15\"), one on a single line is that line's discount_percent; a discount stated only as an amount " +
		"is the percentage of the subtotal it represents, rounded to two decimals. total is the grand total the document " +
		"states. status is accepted or declined only when the document says the offer was accepted (signed, confirmed) or " +
		"declined; otherwise sent when the document carries its own quote number, draft when it has none. Guess nothing: " +
		"a field the document does not carry is null. client_id is always null; the client_ fields are the addressed " +
		"party's details, read from its address block: its name, street and house number, postal code, city, country, " +
		"email, phone, VAT and registration numbers, and whether it is a company or a private person.",
	Schema: record(withClientDetails(map[string]any{
		"client_id":         nullable("string", "Always null: the person picks the client"),
		"client_name":       nullable("string", "The addressed party's name"),
		"client_vat_number": nullable("string", "The addressed party's VAT or UID number"),
		"client_email":      nullable("string", "The addressed party's email address"),
		"number":            nullable("string", "The quote's own number"),
		"reference":         nullable("string", "The buyer's reference or request number"),
		"issue_date":        nullable("string", "Quote date, YYYY-MM-DD"),
		"valid_until":       nullable("string", "Valid until, YYYY-MM-DD"),
		"currency":          nullable("string", "ISO 4217 currency code"),
		"price_basis":       nullable("string", "net or gross"),
		"discount_percent":  nullable("string", "Discount on the whole quote in percent, e.g. 15"),
		"total":             nullable("string", "Grand total stated on the document, e.g. 1081.00"),
		"status":            nullable("string", "draft, sent, accepted or declined"),
		"lines": map[string]any{"type": []string{"array", "null"}, "description": "The quote lines, in order",
			"items": record(map[string]any{
				"description":      nullable("string", "What is offered"),
				"quantity":         nullable("string", "Quantity, e.g. 2 or 1.5"),
				"unit":             nullable("string", "hour, day, piece, month, km or flat"),
				"unit_price":       nullable("string", "Price of one unit, e.g. 120.50"),
				"discount_percent": nullable("string", "Discount on this line in percent, e.g. 10"),
				"vat_category":     nullable("string", "S, Z, E, AE, K, G or O"),
				"vat_rate":         nullable("string", "VAT rate in percent, e.g. 8.1"),
			})},
	})),
	Check: func(ctx context.Context, q store.Q, workspaceID string, data Data) (map[string]string, error) {
		_, invalid, err := importedQuote(ctx, q, workspaceID, time.Now().UTC().Format(time.DateOnly), data)
		return invalid, err
	},
	Duplicate: func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportDuplicate, error) {
		number := rawText(data["number"])
		if number == "" {
			return nil, nil
		}
		clientID, err := importedClient(ctx, q, workspaceID, data)
		if err != nil || clientID == "" {
			return nil, err
		}
		return q.SimilarQuote(ctx, workspaceID, clientID, number)
	},
	Create: func(ctx context.Context, q store.Q, sess store.Session, data Data, _ Source) (string, error) {
		now := time.Now().UTC()
		t, invalid, err := importedQuote(ctx, q, sess.Workspace.ID, sess.Workspace.Today(now), data)
		if err != nil {
			return "", err
		}
		if len(invalid) > 0 { // changed since the review's check, e.g. the client was deleted
			return "", auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.", map[string]any{"fields": invalid})
		}
		return quotes.CreateImport(ctx, q, sess, t.inv, t.number, t.status, now)
	},
}

// importedQuoteRecord is a checked record: the content as internal/invoices computed it (valid-until in DueDate), the
// document's number and the status.
type importedQuoteRecord struct {
	inv    store.Invoice
	number *string
	status string
}

// importedQuote applies the quote rules to a record: the client and content as for an imported invoice draft, then
// valid_until, the status and the number, unique within the workspace.
func importedQuote(ctx context.Context, q store.Q, workspaceID, today string, data Data) (importedQuoteRecord, map[string]string, error) {
	clientID, err := importedClient(ctx, q, workspaceID, data)
	if err != nil {
		return importedQuoteRecord{}, nil, err
	}
	body := Data{}
	for _, k := range quoteKeys {
		if raw, ok := data[k]; ok {
			body[k] = raw
		}
	}
	validUntil, hasValidUntil := data["valid_until"]
	if hasValidUntil {
		body["due_date"] = validUntil
	}
	inv, invalid, err := invoices.CheckImport(ctx, q, workspaceID, today, clientID, body)
	if err != nil {
		return importedQuoteRecord{}, nil, err
	}
	if msg, ok := invalid["due_date"]; ok {
		delete(invalid, "due_date")
		invalid["valid_until"] = msg
	}
	if _, ok := invalid["lines"]; ok {
		invalid["lines"] = "No lines were read from the document. Create this quote by hand."
	}
	if !hasValidUntil {
		inv.DueDate = addDays(inv.IssueDate, quoteValidDays)
	}
	if invalid["valid_until"] == "" && inv.DueDate < inv.IssueDate {
		invalid["valid_until"] = "The quote must be valid on or after its date."
	}

	t := importedQuoteRecord{inv: inv}
	number := rawText(data["number"])
	if number != "" {
		t.number = &number
	}
	_, hasStatus := data["status"]
	switch t.status = rawText(data["status"]); {
	case !hasStatus && number != "":
		t.status = "sent"
	case !hasStatus:
		t.status = "draft"
	case !slices.Contains(quoteStatuses, t.status):
		invalid["status"] = "Choose draft, sent, accepted or declined."
	}
	switch {
	case len(number) > 100:
		invalid["number"] = "Use at most 100 characters."
	case t.status == "draft" && number != "":
		invalid["status"] = "A quote with its own number was sent: choose sent, accepted or declined, or clear the number."
	case t.status != "draft" && number == "" && invalid["status"] == "":
		invalid["number"] = "A sent quote needs its number."
	case number != "":
		if used, err := q.SimilarQuote(ctx, workspaceID, "", number); err != nil {
			return importedQuoteRecord{}, nil, err
		} else if used != nil {
			invalid["number"] = "Quote " + number + " already exists."
		}
	}
	return t, invalid, nil
}

func addDays(d string, days int) string {
	t, err := time.Parse(time.DateOnly, d)
	if err != nil {
		return d
	}
	return t.AddDate(0, 0, days).Format(time.DateOnly)
}
