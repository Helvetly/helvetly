package imports

import (
	"context"
	"encoding/json"
	"maps"
	"net/http"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/clients"
	"helvetly.com/api/internal/engagements"
	"helvetly.com/api/internal/store"
)

func init() { register(engagementsKind) }

// clientMatchKeys identify the client in the document; they are not engagement fields.
var clientMatchKeys = []string{"client_name", "client_vat_number", "client_email"}

// engagementsKind creates engagements (committed work, not delivery-log entries) for existing clients: the fields of
// POST /engagements, checked and created as that endpoint does. A client is never created by an import.
var engagementsKind = Kind{
	Name:       "engagements",
	Label:      "Engagements",
	LabelField: "title",
	Resource:   "engagements",
	Prompt: "Extract the engagements this document agrees: work committed to a client, such as a signed offer, a " +
		"contract, a statement of work or a spreadsheet of retainers. One record per agreed service, not per delivery or " +
		"time entry: hours already worked are not engagements. client_name, client_vat_number and client_email identify " +
		"the customer (the party receiving the work, never the issuer of the document). title names the work briefly. " +
		"quantity is the committed amount per period as a decimal with a dot (\"20\" hours a month); unit is one of hour, " +
		"day, piece, month, km, flat. unit_price is the price of one unit as a decimal with a dot and no currency symbol " +
		"(\"150.00\"); price_basis is gross when it includes VAT, net otherwise. recurrence is none for one-off work, " +
		"otherwise weekly, monthly, quarterly or yearly, with interval the number of those between periods (1 = every). " +
		"Dates are YYYY-MM-DD; a one-off engagement needs end_date. billing is advance when invoiced at the start of a " +
		"period, arrears when invoiced after the work. vat_rate is the percentage (\"8.1\"), never an amount. client_id " +
		"is always null. Guess nothing: a field the document does not carry is null.",
	Schema: record(withClientDetails(map[string]any{
		"client_id":          nullable("string", "Always null; chosen in review"),
		"client_name":        nullable("string", "Customer's company or full name"),
		"client_vat_number":  nullable("string", "Customer's VAT or UID number"),
		"client_email":       nullable("string", "Customer's email address"),
		"title":              nullable("string", "Short name of the work"),
		"description":        nullable("string", "What is included, briefly"),
		"unit":               nullable("string", "hour, day, piece, month, km or flat"),
		"quantity":           nullable("string", "Committed quantity per period, e.g. 20"),
		"unit_price":         nullable("string", "Price of one unit, e.g. 150.00"),
		"overage_unit_price": nullable("string", "Price of one unit beyond the committed quantity"),
		"price_basis":        nullable("string", "net or gross"),
		"currency":           nullable("string", "ISO 4217 currency code"),
		"vat_category":       nullable("string", "EN 16931 VAT category: S, Z, E, AE, K, G or O"),
		"vat_rate":           nullable("string", "VAT rate in percent, e.g. 8.1"),
		"billing":            nullable("string", "advance or arrears"),
		"recurrence":         nullable("string", "none, weekly, monthly, quarterly or yearly"),
		"interval":           nullable("integer", "Periods between repeats, 1 to 12"),
		"start_date":         nullable("string", "First day, YYYY-MM-DD"),
		"end_date":           nullable("string", "Last day, YYYY-MM-DD"),
		"reference":          nullable("string", "Customer's PO or order number"),
	})),
	Check: func(ctx context.Context, q store.Q, workspaceID string, data Data) (map[string]string, error) {
		_, invalid, err := checkEngagement(ctx, q, workspaceID, data)
		return invalid, err
	},
	Duplicate: func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportDuplicate, error) {
		e, invalid, err := checkEngagement(ctx, q, workspaceID, data)
		if err != nil || invalid["client_id"] != "" || invalid["title"] != "" || invalid["start_date"] != "" {
			return nil, err
		}
		return q.SimilarEngagement(ctx, workspaceID, e.ClientID, e.Title, e.StartDate)
	},
	Create: func(ctx context.Context, q store.Q, sess store.Session, data Data, _ Source) (string, error) {
		ws, now := sess.Workspace.ID, time.Now().UTC()
		e, invalid, err := checkEngagement(ctx, q, ws, data)
		if err != nil {
			return "", err
		}
		if len(invalid) > 0 { // changed since the review's check, e.g. the client was deleted
			return "", auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.", map[string]any{"fields": invalid})
		}
		return engagements.Create(ctx, q, ws, e, sess.Workspace.Today(now), now)
	},
}

// checkEngagement applies the create rules on the workspace's today, with the client resolved by engagementBody.
func checkEngagement(ctx context.Context, q store.Q, workspaceID string, data Data) (store.Engagement, map[string]string, error) {
	w, err := q.AdmissionWorkspace(ctx, workspaceID)
	if err != nil {
		return store.Engagement{}, nil, err
	}
	body, matched, err := engagementBody(ctx, q, workspaceID, data)
	if err != nil {
		return store.Engagement{}, nil, err
	}
	e, invalid, err := engagements.CheckCreate(ctx, q, workspaceID, body, w.Today(time.Now()))
	if err == nil && !matched {
		if invalid == nil {
			invalid = map[string]string{}
		}
		invalid["client_id"] = "No client matches this document: choose one."
	}
	return e, invalid, err
}

// engagementBody is the record as POST /engagements input. Its client is the one chosen in review, else the live client
// the document's name, VAT number or email matches; matched is false when there is neither.
func engagementBody(ctx context.Context, q store.Q, workspaceID string, data Data) (Data, bool, error) {
	body := maps.Clone(data)
	for _, k := range clientMatchKeys {
		delete(body, k)
	}
	if rawText(data["client_id"]) != "" {
		return body, true, nil
	}
	vat := rawText(data["client_vat_number"])
	if v, msg := clients.NormaliseVATNumber(vat); msg == "" {
		vat = v
	}
	match, err := q.SimilarClient(ctx, workspaceID, rawText(data["client_name"]), vat, rawText(data["client_email"]))
	if err != nil || match == nil {
		return body, false, err
	}
	body["client_id"], err = json.Marshal(match.ID)
	return body, true, err
}
