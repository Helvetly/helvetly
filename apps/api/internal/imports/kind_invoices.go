package imports

import (
	"context"
	"encoding/json"
	"errors"
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
		"is the percentage of the subtotal it represents, rounded to two decimals. contract_reference is the contract or " +
		"agreement number as printed after a label such as Contract Number or Contract No. (e.g. C23-25-CP2302). " +
		"Keep it distinct from the order number and buyer's reference. total is the grand total printed. " +
		"Copy standalone remarks such as lesson dates, payment annotations and material notes verbatim into note. " +
		"Leave note null without such a remark, including when there are only standard payment instructions or terms. " +
		"Guess nothing: use null for fields the document does not carry. client_id is always null. " +
		"Read the buyer's name, street and house number, postcode, city, country, email, phone, VAT and registration " +
		"numbers, and whether the buyer is a company. Look for its address block (Billed to, Rechnung an, Facturé à, " +
		"Fatturato a or the address window). The postcode can appear before or after the city. " +
		"Check the buyer's address on the QR payment slip when part of it is missing from the header. " +
		"client_country is an ISO 3166-1 alpha-2 code (CH for Switzerland). " +
		"issued_elsewhere is true for a finished invoice carrying its own number, false for a quote, order, proforma or draft. " +
		"Set paid_amount and paid_on only for explicit evidence of a payment already received. " +
		"An invoice marked paid without an amount is paid in full. Leave paid_on null without an actual payment date. " +
		"An invoice date, past due date, QR payment slip or payment instructions do not show a payment. " +
		"Look for a payment schedule across all pages, including payment instructions, tables, and separate " +
		"payment slips. Set has_instalment_schedule to true if the document divides the invoice total into several payments, " +
		"even if some dates or amounts are unreadable. Put one row per instalment in instalments, including any deposit or " +
		"final balance that is part of the schedule. Match each exact amount to its own due date; copy neither the invoice " +
		"total nor a cumulative balance as an instalment. Do not count repetitions of the same payment twice. Check that " +
		"the amounts add up to the invoice total. Use null for unreadable values rather than guessing. A single payment " +
		"deadline or a list of payments already received without a schedule is not a payment schedule. Set paid only when " +
		"the document explicitly confirms each instalment's payment status. Include paid_on when it states the " +
		"actual payment date. Use null instalments when there is no schedule.",
	Schema: record(withClientDetails(map[string]any{
		"client_id":               nullable("string", "Always null: the person picks the client"),
		"client_name":             nullable("string", "The billed party's name"),
		"client_vat_number":       nullable("string", "The billed party's VAT or UID number"),
		"client_email":            nullable("string", "The billed party's email address"),
		"number":                  nullable("string", "The invoice's own number"),
		"reference":               nullable("string", "The buyer's reference or order number"),
		"contract_reference":      nullable("string", "The contract or agreement number the invoice refers to, as printed, e.g. C23-25-CP2302"),
		"note":                    nullable("string", "Standalone remark from the invoice for internal use, copied verbatim"),
		"issue_date":              nullable("string", "Invoice date, YYYY-MM-DD"),
		"due_date":                nullable("string", "Due date, YYYY-MM-DD"),
		"service_date":            nullable("string", "Service date or start of the service period, YYYY-MM-DD"),
		"service_date_end":        nullable("string", "End of the service period, YYYY-MM-DD"),
		"currency":                nullable("string", "ISO 4217 currency code"),
		"price_basis":             nullable("string", "net or gross"),
		"total":                   nullable("string", "Grand total stated on the document, e.g. 1081.00"),
		"discount_percent":        nullable("string", "Discount on the whole invoice in percent, e.g. 15"),
		"issued_elsewhere":        nullable("boolean", "true for a finished invoice the seller issued with its own number"),
		"paid_amount":             nullable("string", "Amount the document says was already paid, e.g. 500.00"),
		"paid_on":                 nullable("string", "Date that amount was paid, YYYY-MM-DD"),
		"has_instalment_schedule": nullable("boolean", "True if the original invoice specifies multiple scheduled payments, even when extraction is incomplete"),
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
	})),
	PlacesDocument: true,
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
		id, err := invoices.CreateImport(ctx, q, sess, clientID, data, doc)
		// An issued original was filed from the persisted invoice in issueImported. A draft's input may hold many records.
		if err != nil || doc == nil || string(data["issued_elsewhere"]) == "true" {
			return id, err
		}
		now := time.Now().UTC()
		path := invoiceFolder(rawText(data["issue_date"]), sess.Workspace.Today(now))
		folder := func() (string, error) { return q.FolderPath(ctx, sess.Workspace.ID, sess.User.ID, path, now) }
		return id, placeDocument(ctx, q, sess, *doc, folder, []string{"invoice"}, now)
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

// scopeToClient: an invoice of a batch for one client is that client's, whatever the document or an edit says. A
// client deleted since leaves the record to the review, which asks for one.
func scopeToClient(ctx context.Context, q store.Q, workspaceID string, clientID *string, kind string, data Data) error {
	if clientID == nil || kind != invoicesKind.Name {
		return nil
	}
	c, err := q.Client(ctx, workspaceID, *clientID)
	if errors.Is(err, store.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	data["client_id"], _ = json.Marshal(c.ID)
	data["client_name"], _ = json.Marshal(c.Name)
	return nil
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

// importedClient: the client the person picked, else the company client the buyer is a participant of (data then
// names the participant), else the live client with the document's buyer name, VAT number or email; "" when none
// matches (a client is never created by an invoice import).
func importedClient(ctx context.Context, q store.Q, workspaceID string, data Data) (string, error) {
	if id := rawText(data["client_id"]); id != "" {
		return id, nil
	}
	// A buyer who is a participant of a company client is that company's, addressed to the participant.
	company, participant, err := q.ImportParticipant(ctx, workspaceID, rawText(data["client_name"]), rawText(data["client_email"]))
	if err != nil {
		return "", err
	}
	if company != "" {
		data["client_id"], _ = json.Marshal(company)
		data["participant_contact_id"], _ = json.Marshal(participant)
		return company, nil
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
