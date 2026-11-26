package invoices

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"time"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

// importedKeys: the record fields an AI import passes on to POST /invoices' rules unchanged.
var importedKeys = []string{"issue_date", "due_date", "service_date", "service_date_end", "currency", "reference", "contract_reference", "discount_percent"}

// importedLineKeys: the line fields an import reads; anything else the model returned is dropped.
var importedLineKeys = []string{"description", "quantity", "unit", "unit_price", "discount_percent", "vat_category", "vat_rate", "catalogue_price_basis", "catalogue_unit_price", "catalogue_currency"}

// swissRates: the Swiss VAT rates since 2024 (MWSTG Art. 25), the only ones an import accepts for a Swiss seller.
var swissRates = []invoicecalc.Percent{810, 380, 260}

// ImportedNote is the internal note that keeps an imported document's own number.
func ImportedNote(number string) string { return "Imported from document " + number }

// CheckImport applies POST /invoices' create rules to an invoice read from a document by an AI import, for the client
// clientID ("" when none matched): the draft it would create and a message per invalid field (none when it can be
// created). It never consumes a number: the result is a draft the person issues as usual. The document's number goes
// into the internal note; its stated total is only compared with the total recomputed from the lines.
func CheckImport(ctx context.Context, q store.Q, workspaceID, today, clientID string, data map[string]json.RawMessage) (store.Invoice, map[string]string, error) {
	inv, _, invalid, err := checkImport(ctx, q, workspaceID, today, clientID, data)
	return inv, invalid, err
}

func checkImport(ctx context.Context, q store.Q, workspaceID, today, clientID string, data map[string]json.RawMessage) (store.Invoice, issuedElsewhere, map[string]string, error) {
	set, err := loadSettings(ctx, q, workspaceID)
	if err != nil {
		return store.Invoice{}, issuedElsewhere{}, nil, err
	}
	invalid := map[string]string{}
	var client *store.Client
	if clientID == "" {
		invalid["client_id"] = "No client matches. Import the client first or pick one."
	} else if c, err := q.Client(ctx, workspaceID, clientID); errors.Is(err, store.ErrNotFound) {
		invalid["client_id"] = "Choose one of your clients."
	} else if err != nil {
		return store.Invoice{}, issuedElsewhere{}, nil, err
	} else {
		client = &c
	}
	inv, terms := newDraft(client, set, today)
	body := map[string]json.RawMessage{}
	for _, k := range importedKeys {
		if raw, ok := data[k]; ok {
			body[k] = raw
		}
	}
	p := newParser()
	var note string
	if raw, ok := data["number"]; ok {
		if n := p.text("number", raw, 100, nil); n != nil {
			note = ImportedNote(*n)
		}
	}
	if raw, ok := data["note"]; ok {
		if text := p.text("note", raw, 1000, nil); text != nil {
			if note != "" {
				note += "\n\n"
			}
			note += *text
		}
	}
	if note != "" {
		body["note"], _ = json.Marshal(note)
	}
	if raw, ok := data["price_basis"]; ok && inv.VATMode != invoicecalc.None {
		mode := map[string]string{"net": invoicecalc.Exclusive, "gross": invoicecalc.Inclusive}[deref(p.text("price_basis", raw, 5, oneOf("net", "gross")))]
		if mode != "" {
			body["vat_mode"], _ = json.Marshal(mode)
		}
	}
	lines, ok := importedLines(data["lines"])
	if !ok {
		p.fail("lines", "No lines were read from the document. Create this invoice by hand.")
	}
	body["lines"] = lines
	fields, err := checkInput(&inv, body, set)
	if err != nil {
		return store.Invoice{}, issuedElsewhere{}, nil, err
	}
	maps.Copy(invalid, fields)
	maps.Copy(invalid, p.invalid)
	if swiss := set.Seller.Country == "CH" || set.Seller.Country == "LI"; swiss {
		for i, l := range inv.Lines {
			if l.VATCategory == "S" && !slices.Contains(swissRates, l.VATRate) {
				invalid[fmt.Sprintf("lines.%d.vat_rate", i)] = "Use a Swiss VAT rate: 8.1, 3.8 or 2.6."
			}
		}
	}
	if _, ok := data["due_date"]; !ok {
		inv.DueDate = addDays(inv.IssueDate, terms)
	}
	inv.PaymentMethods = usableMethods(defaultMethods(set, inv.Currency), set, inv.Currency)
	compute(&inv)
	draftPayment(&inv, set)
	if raw, ok := data["total"]; ok && len(invalid) == 0 {
		if msg := totalMismatch(raw, inv); msg != "" {
			invalid["total"] = msg
		}
	}
	elsewhere := checkIssuedElsewhere(inv, data, today, invalid)
	if elsewhere.on && client != nil {
		buyer := importedBuyer(*client, data)
		inv.Buyer = &buyer
	}
	var hasSchedule bool
	_ = json.Unmarshal(data["has_instalment_schedule"], &hasSchedule)
	if schedule := importedSchedule(data["instalments"], inv); schedule != nil {
		allowed, err := q.FeatureAllowed(ctx, workspaceID, store.FeatureInvoiceInstalments)
		if err != nil {
			return store.Invoice{}, issuedElsewhere{}, nil, err
		}
		if allowed {
			inv.Instalments = schedule
			syncSchedule(&inv)
		} else if hasSchedule {
			invalid["instalments"] = "This plan does not support invoice instalment schedules."
		}
	} else if hasSchedule {
		invalid["instalments"] = "Check the original: enter 2 to 12 instalments with distinct due dates and amounts that add up to the invoice total."
	}
	return inv, elsewhere, invalid, nil
}

// CreateImport saves the draft CheckImport builds, in the caller's transaction; a record with issues is a 422. A record
// marked issued_elsewhere is recorded as issued with its own number instead (see issueImported), its original being the
// Document documentID; 409 number_taken when the number is already used.
func CreateImport(ctx context.Context, q store.Q, sess store.Session, clientID string, data map[string]json.RawMessage, documentID *string) (string, error) {
	now := time.Now().UTC()
	inv, elsewhere, invalid, err := checkImport(ctx, q, sess.Workspace.ID, sess.Workspace.Today(now), clientID, data)
	if err != nil {
		return "", err
	}
	if len(invalid) > 0 {
		return "", validationFailed(invalid)
	}
	if !elsewhere.on {
		return inv.ID, saveDraft(ctx, q, sess, inv, now)
	}
	if use, err := q.InvoiceNumberUse(ctx, sess.Workspace.ID, inv.Kind, elsewhere.number); err != nil {
		return "", err
	} else if use != nil {
		return "", errNumberTaken
	}
	return inv.ID, issueImported(ctx, q, sess, inv, elsewhere, documentID, now, "invoice.issued", nil)
}

// importedLines: the model's lines as InvoiceInput lines, keeping only the line fields and dropping nulls; false when
// there is no line or one is not an object.
func importedLines(raw json.RawMessage) (json.RawMessage, bool) {
	var items []map[string]json.RawMessage
	if json.Unmarshal(raw, &items) != nil || len(items) == 0 {
		return nil, false
	}
	out := make([]map[string]json.RawMessage, len(items))
	for i, item := range items {
		if item == nil {
			return nil, false
		}
		out[i] = map[string]json.RawMessage{}
		for _, k := range importedLineKeys {
			if v, ok := item[k]; ok && !isNull(v) {
				out[i][k] = v
			}
		}
	}
	b, err := json.Marshal(out)
	return b, err == nil
}

// totalMismatch: why the document's stated total disagrees with the total recomputed from its lines, "" when it
// matches (before or after Swiss cash rounding).
func totalMismatch(raw json.RawMessage, inv store.Invoice) string {
	p := newParser()
	stated, ok := p.decimal("total", raw, parseMoney, "")
	if !ok {
		return "Enter the total as a decimal with at most two decimals, or clear it."
	}
	if m := invoicecalc.Money(stated); m == inv.Total || m == inv.Payable() {
		return ""
	}
	return fmt.Sprintf("The document says %s, but its lines add up to %s. Check the document, or clear this total to import the lines as read.",
		invoicecalc.Money(stated), inv.Payable())
}
