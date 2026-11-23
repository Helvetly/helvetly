package imports

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/expenses"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/store"
)

func init() { register(expensesKind) }

// expensesKind reads receipts and supplier invoices into draft expenses (source 'import') that land in "To review":
// the fields of POST /expenses, gross amounts at up to two VAT rates. A category, the payment and a foreign
// currency's exchange rate are added on the draft; nothing is booked. A PDF or photo becomes the draft's receipt, and
// the file's Document is linked to the draft.
var expensesKind = Kind{
	Feature:    store.FeatureExpenses,
	Name:       "expenses",
	Label:      "Expenses",
	LabelField: "supplier_name",
	Resource:   "expenses",
	Prompt: "Extract the expenses this document records: one record per receipt or supplier invoice (a spreadsheet row is " +
		"one expense), never one per line item. supplier_name is who was paid. Amounts are decimals with a dot and no " +
		"currency symbol or thousands separator (\"108.10\") and include VAT: amount is the total at vat_rate; when the " +
		"receipt shows VAT at a second rate, amount is the part at the first rate and amount_2 the part at vat_rate_2 " +
		"(their sum is the receipt's total). A rate is the percentage shown (\"8.1\"), never an amount; a receipt that shows " +
		"no VAT has vat_rate null. document_date and due_date are YYYY-MM-DD. currency is the ISO 4217 code printed on " +
		"the receipt; never convert amounts. supplier_country is the supplier's ISO 3166 alpha-2 code. reverse_charge is " +
		"true only when the invoice says the recipient owes the VAT (reverse charge, Bezugsteuer). Guess nothing: a field " +
		"the document does not carry is null. category is what the expense was for: pick from the listed categories.",
	PlacesDocument: true,
	Context: func(ctx context.Context, q store.Q, workspaceID string) (string, error) {
		if err := q.SeedExpenseCategories(ctx, workspaceID, func() string { return auth.NewID("exc") }, time.Now().UTC()); err != nil {
			return "", err
		}
		list, err := q.ExpenseCategories(ctx, workspaceID, false)
		if err != nil {
			return "", err
		}
		names := make([]string, len(list))
		for i, c := range list {
			names[i] = strings.Join(strings.Fields(c.Name), " ") // one line: a name never starts a new instruction
		}
		return "The categories for category: " + strings.Join(names, "; ") + ".", nil
	},
	Schema: record(map[string]any{
		"supplier_name":       nullable("string", "Who was paid"),
		"supplier_vat_number": nullable("string", "Supplier's VAT or UID number, e.g. CHE-123.456.789 MWST"),
		"supplier_country":    nullable("string", "Supplier's ISO 3166 alpha-2 country code"),
		"reference":           nullable("string", "Receipt or invoice number"),
		"description":         nullable("string", "What was bought, briefly"),
		"document_date":       nullable("string", "Receipt or invoice date, YYYY-MM-DD"),
		"due_date":            nullable("string", "Payment due date, YYYY-MM-DD"),
		"currency":            nullable("string", "ISO 4217 currency code"),
		"amount":              nullable("string", "Total including VAT at vat_rate, e.g. 108.10"),
		"vat_rate":            nullable("string", "VAT rate in percent, e.g. 8.1"),
		"amount_2":            nullable("string", "Part including VAT at a second rate, when shown"),
		"vat_rate_2":          nullable("string", "The second VAT rate in percent, e.g. 2.6"),
		"reverse_charge":      nullable("boolean", "true when the recipient owes the VAT (reverse charge)"),
		"category": nullable("string", "One of the listed categories, exactly as written; when none fits, a short new "+
			"category name (Title Case, like the listed ones)"),
	}),
	Check: func(ctx context.Context, q store.Q, workspaceID string, data Data) (map[string]string, error) {
		_, invalid, err := checkExpense(ctx, q, workspaceID, store.User{}, time.Now().UTC().Format(time.DateOnly), data)
		return invalid, err
	},
	Duplicate: func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportDuplicate, error) {
		e, _, err := checkExpense(ctx, q, workspaceID, store.User{}, time.Now().UTC().Format(time.DateOnly), data)
		if err != nil {
			return nil, err
		}
		return q.SimilarExpense(ctx, workspaceID, value(e.SupplierName), value(e.Reference), value(e.DocumentDate), e.Currency, e.Total)
	},
	Create: func(ctx context.Context, q store.Q, sess store.Session, data Data, src Source) (string, error) {
		now := time.Now().UTC()
		e, invalid, err := checkExpense(ctx, q, sess.Workspace.ID, sess.User, sess.Workspace.Today(now), data)
		if err != nil {
			return "", err
		}
		if len(invalid) > 0 {
			return "", auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Check the highlighted fields.",
				map[string]any{"fields": invalid})
		}
		e.Source = "import"
		if err := q.CreateExpense(ctx, sess.Workspace.ID, &e, now); err != nil {
			return "", err
		}
		// The receipt is the expense's evidence (GeBüV): a copy of the file of the expense's own, which deleting the
		// draft's receipt removes and booking locks, as an upload would. A spreadsheet or Word file lists expenses
		// but is no one expense's receipt: it stays a linked Document only.
		if receiptName, ok := receiptExt[src.ContentType]; ok && src.Keep != nil {
			name := src.Name // a ZIP entry's name is "receipts.zip › folder/migros.jpg"
			if i := strings.LastIndex(name, " › "); i >= 0 {
				name = path.Base(name[i+len(" › "):])
			}
			r := store.Receipt{ID: auth.NewID("rcp"), Name: name, ContentType: src.ContentType, CreatedAt: now,
				UploadedBy: &store.Uploader{ID: sess.User.ID, Name: sess.User.Name}}
			r.ObjectKey = "workspaces/" + sess.Workspace.ID + "/expenses/" + e.ID + "/" + r.ID + "/" + receiptName
			if r.Size, r.SHA256, err = src.Keep(ctx, r.ObjectKey); err != nil {
				return "", err
			}
			if err := q.CreateReceipt(ctx, sess.Workspace.ID, e.ID, sess.User.ID, r); err != nil {
				return "", err
			}
		}
		// The link keeps the uploaded Document with its expense: a business record once the expense is booked.
		if src.DocumentID != nil {
			if err := q.AddDocumentLink(ctx, sess.Workspace.ID, *src.DocumentID, "expense", e.ID, sess.User.ID, now); err != nil {
				return "", err
			}
			folder := func() (string, error) {
				return q.ExpenseYearFolder(ctx, sess.Workspace.ID, e.CategoryID, store.ExpenseYear(e.DocumentDate, sess.Workspace.Today(now)), sess.User.ID, now)
			}
			if err := placeDocument(ctx, q, sess, *src.DocumentID, folder, nil, now); err != nil {
				return "", err
			}
		}
		return e.ID, nil
	},
}

// receiptExt: the object name of a receipt copy per file type an import can read; only these are receipts.
var receiptExt = map[string]string{typePDF: "receipt.pdf", typePNG: "receipt.png", typeJPEG: "receipt.jpg", typeWEBP: "receipt.webp"}

// expenseLines pairs each imported amount with its rate, in the order of the draft's lines.
var expenseLines = [][2]string{{"amount", "vat_rate"}, {"amount_2", "vat_rate_2"}}

// expenseTextFields go to the ExpenseInput as they are.
var expenseTextFields = []string{"supplier_name", "supplier_vat_number", "supplier_country", "reference", "description",
	"document_date", "due_date", "currency"}

// checkExpense turns a record into the ExpenseInput, checks it with the create rules and adds the import's own:
// an amount is required and a Swiss supplier's rate must be a Swiss one. Messages are keyed by the record's fields.
// today only matters for payment dates, which an import never sets.
func checkExpense(ctx context.Context, q store.Q, workspaceID string, user store.User, today string, data Data) (store.Expense, map[string]string, error) {
	d, err := q.Defaults(ctx, workspaceID)
	if err != nil {
		return store.Expense{}, nil, err
	}
	body := map[string]json.RawMessage{"amount_mode": json.RawMessage(`"gross"`)}
	for _, k := range expenseTextFields {
		if raw, ok := data[k]; ok {
			body[k] = raw
		}
	}
	invalid := map[string]string{}
	if raw, ok := data["reverse_charge"]; ok {
		if v, ok := yesNo(raw); ok {
			body["reverse_charge"] = json.RawMessage(v)
		} else {
			invalid["reverse_charge"] = "Choose yes or no."
		}
	}
	var lines []map[string]json.RawMessage
	var pairs [][2]string // the record's fields of each line
	for _, pair := range expenseLines {
		amount, hasAmount := data[pair[0]]
		rate, hasRate := data[pair[1]]
		if !hasAmount && !hasRate {
			continue
		}
		if !hasRate { // a receipt that shows no VAT claims none: never the workspace's default rate
			rate = json.RawMessage(`"0"`)
		}
		line := map[string]json.RawMessage{"vat_rate": rate}
		if hasAmount {
			line["amount"] = amount
		}
		lines, pairs = append(lines, line), append(pairs, pair)
	}
	if len(lines) > 0 {
		raw, err := json.Marshal(lines)
		if err != nil {
			return store.Expense{}, nil, err
		}
		body["lines"] = raw
	}
	if _, ok := data["amount"]; !ok {
		invalid["amount"] = "Enter the amount."
	}

	e, checked, err := expenses.CheckCreate(body, d, user, today)
	if err != nil {
		return e, nil, err
	}
	for k, msg := range checked {
		if field := recordField(k, pairs); invalid[field] == "" {
			invalid[field] = msg
		}
	}
	if name := rawText(data["category"]); name != "" && invalid["category"] == "" {
		list, err := q.ExpenseCategories(ctx, workspaceID, false)
		if err != nil {
			return e, nil, err
		}
		if i := slices.IndexFunc(list, func(c store.ExpenseCategory) bool { return strings.EqualFold(c.Name, name) }); i >= 0 {
			e.CategoryID = &list[i].ID
		} else {
			invalid["category"] = "“" + name + "” is a new category: create it or choose one of the list."
		}
	}
	for i, l := range e.Lines {
		if i < len(pairs) && invalid[pairs[i][1]] == "" && !swissRate(e.SupplierCountry, e.DocumentDate, l.VATRate) {
			invalid[pairs[i][1]] = "Swiss VAT is 8.1, 2.6 or 3.8 % (7.7, 2.5 or 3.7 % before 2024), or 0."
		}
	}
	return e, invalid, nil
}

// recordField names the record's field of an ExpenseInput message key ("lines.1.amount" is amount_2).
func recordField(key string, pairs [][2]string) string {
	if key == "lines" {
		return "amount"
	}
	for i, pair := range pairs {
		if rest, ok := strings.CutPrefix(key, fmt.Sprintf("lines.%d.", i)); ok {
			if rest == "vat_rate" {
				return pair[1]
			}
			return pair[0]
		}
	}
	return key
}

// swissRate: a Swiss or Liechtenstein supplier charges a statutory rate of the document's date (either era when the
// date is unknown); a foreign supplier's rate is its own country's.
func swissRate(country string, date *string, rate invoicecalc.Percent) bool {
	if expenses.ForeignVAT(country) || rate == 0 {
		return true
	}
	from2024, ok := map[invoicecalc.Percent]bool{810: true, 260: true, 380: true, 770: false, 250: false, 370: false}[rate]
	return ok && (date == nil || (*date >= "2024-01-01") == from2024)
}

// yesNo reads a boolean or the review's "Yes"/"No" (also "true"/"false") as a JSON boolean.
func yesNo(raw json.RawMessage) (string, bool) {
	var b bool
	if json.Unmarshal(raw, &b) == nil {
		return strconv.FormatBool(b), true
	}
	switch strings.ToLower(rawText(raw)) {
	case "yes", "true":
		return "true", true
	case "no", "false":
		return "false", true
	}
	return "", false
}

func value(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// receiptPrompt and receiptSchema are receipt reading v2, for the expense form (POST /expenses/receipt-preview) and
// the re-read of a draft's receipts (POST /expenses/{id}/read): one document, its full VAT breakdown at any number of
// rates, the line items, the payment and a category of the workspace's list with the model's confidence. The import's
// review table keeps the flat expensesKind record.
const receiptPrompt = "Read the one expense document the attached files show (several files are pages of the same " +
	"document). Any proof of an expense is one: a receipt, a supplier invoice or QR-bill, a utility bill, a ticket, a " +
	"booking confirmation, an employee expense report, a bank or card statement extract or another itemised summary. " +
	"A document listing several lines (an expense report's dated entries, a statement's transactions, an invoice's " +
	"positions) is ONE record: each line is an item and totals is the document's total. Return several records only " +
	"when the files hold several separate receipts or invoices, each with its own supplier and total; return none " +
	"only when the files show no expense at all. document.type is receipt, invoice or credit_note, null for any other " +
	"kind of document; supplier is null when no single supplier is named (an expense report: its employee or company " +
	"is no supplier). Amounts are decimals with a dot and no currency symbol or thousands separator (\"108.10\"), never negative " +
	"(a credit note has document.type credit_note). totals are the document's net, VAT and gross totals. vat_breakdown " +
	"has one entry per VAT rate the document shows, with its net, VAT and gross; a document that shows no VAT has an " +
	"empty vat_breakdown. A rate is the percentage shown (\"8.1\"), never an amount. items are the line items as printed, " +
	"amount being the line's total and date the line's own date when it has one; leave items empty when the document " +
	"lists none. Dates are YYYY-MM-DD; document.date is the document's date, else its latest line's. currency is " +
	"the ISO 4217 code printed (\"$\" alone is USD); never convert amounts. supplier.country is the supplier's ISO 3166 alpha-2 code. " +
	"payment.status is paid only when the document shows it was paid (a till receipt, \"paid\", a card slip, a " +
	"statement's booked transactions), unpaid " +
	"when it asks for payment, else unknown. reverse_charge is true only when the document says the recipient owes the " +
	"VAT (reverse charge, Bezugsteuer). category.key is the key of the listed category the expense belongs to, with " +
	"your confidence from 0 to 1 and a short reason; null when none fits. An item's category is a listed key or null. " +
	"confidence rates how clearly each part could be read. Guess nothing: what the document does not carry is null."

var (
	receiptLevel  = map[string]any{"type": "string", "enum": []string{"high", "medium", "low"}}
	receiptGroups = []string{"supplier", "document", "totals", "vat_breakdown", "items", "payment"}
	receiptAmount = func(d string) map[string]any { return nullable("string", d+", e.g. 108.10") }
	receiptSchema = record(map[string]any{
		"supplier": record(map[string]any{
			"name":       nullable("string", "Who was paid"),
			"vat_number": nullable("string", "VAT or UID number, e.g. CHE-123.456.789 MWST"),
			"country":    nullable("string", "ISO 3166 alpha-2 country code"),
			"iban":       nullable("string", "IBAN to pay to, when printed"),
		}),
		"document": record(map[string]any{
			"type":     map[string]any{"type": []string{"string", "null"}, "enum": []any{"receipt", "invoice", "credit_note", nil}},
			"number":   nullable("string", "Receipt, invoice or report number"),
			"date":     nullable("string", "Document date, YYYY-MM-DD"),
			"due_date": nullable("string", "Payment due date, YYYY-MM-DD"),
			"service_period": record(map[string]any{
				"from": nullable("string", "First day of the service period, YYYY-MM-DD"),
				"to":   nullable("string", "Last day of the service period, YYYY-MM-DD"),
			}),
		}),
		"description": nullable("string", "What was bought, briefly"),
		"currency":    nullable("string", "ISO 4217 currency code"),
		"totals": record(map[string]any{
			"net": receiptAmount("Total without VAT"), "vat": receiptAmount("Total VAT"), "gross": receiptAmount("Total to pay"),
		}),
		"vat_breakdown": map[string]any{"type": "array", "items": record(map[string]any{
			"rate": nullable("string", "VAT rate in percent, e.g. 8.1"),
			"net":  receiptAmount("Net at this rate"), "vat": receiptAmount("VAT at this rate"), "gross": receiptAmount("Gross at this rate"),
		})},
		"items": map[string]any{"type": "array", "items": record(map[string]any{
			"date":        nullable("string", "The line's own date, YYYY-MM-DD"),
			"description": nullable("string", "The item as printed"),
			"quantity":    nullable("string", "Quantity, e.g. 2"),
			"unit_price":  receiptAmount("Price of one"),
			"amount":      receiptAmount("Line total"),
			"vat_rate":    nullable("string", "The item's VAT rate in percent"),
			"category":    nullable("string", "Key of a listed category"),
		})},
		"payment": record(map[string]any{
			"status":  map[string]any{"type": "string", "enum": []string{"paid", "unpaid", "unknown"}},
			"method":  map[string]any{"type": []string{"string", "null"}, "enum": []any{"card", "cash", "bank_transfer", "twint", "other", nil}},
			"paid_on": nullable("string", "Payment date, YYYY-MM-DD"),
		}),
		"reverse_charge": map[string]any{"type": "boolean", "description": "true when the recipient owes the VAT"},
		"category": record(map[string]any{
			"key":        nullable("string", "Key of the listed category"),
			"confidence": map[string]any{"type": "number", "description": "0 to 1"},
			"reason":     nullable("string", "Why, in a few words"),
		}),
		"confidence": record(func() map[string]any {
			m := map[string]any{}
			for _, g := range receiptGroups {
				m[g] = receiptLevel
			}
			return m
		}()),
	})
)

// receiptCategories lists the workspace's active categories for the prompt (key, name, account) and returns them for
// resolving the answer. The key is the catalogue preset when the category has one, else its id.
func receiptCategories(ctx context.Context, q store.Q, workspaceID string) ([]receiptCategory, string, error) {
	if err := q.SeedExpenseCategories(ctx, workspaceID, func() string { return auth.NewID("exc") }, time.Now().UTC()); err != nil {
		return nil, "", err
	}
	list, err := q.ExpenseCategories(ctx, workspaceID, false)
	if err != nil {
		return nil, "", err
	}
	out := make([]receiptCategory, len(list))
	var b strings.Builder
	b.WriteString("The categories (key | name | account):")
	for i, c := range list {
		key := c.ID
		if c.Preset != nil {
			key = *c.Preset
		}
		out[i] = receiptCategory{Key: key, ID: c.ID, Name: c.Name, AccountCode: c.AccountCode, Preset: c.Preset}
		// one line each: a name never starts a new instruction
		b.WriteString("\n- " + key + " | " + strings.Join(strings.Fields(c.Name), " ") + " | " + c.AccountCode)
	}
	return out, b.String(), nil
}

type receiptCategory struct {
	Key         string  `json:"key"`
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	AccountCode string  `json:"account_code"`
	Preset      *string `json:"-"`
}
