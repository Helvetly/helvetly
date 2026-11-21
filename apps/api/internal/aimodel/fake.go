package aimodel

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"path"
	"slices"
	"strings"
	"unicode"
)

// Fake answers without any external call, for end-to-end tests and local development only (HELVETLY_E2E_FAKE_AI, which
// config refuses outside development). A structured request gets one record per row of the CSV text after the first
// blank line of the message, its columns matched to the schema's string properties by header; anything else gets a
// fixed text, a scope classification (Heidi) always in scope. Files are not read.
type Fake struct{}

// Card prices the fake as the default model, so development and tests exercise the cost guard.
func (Fake) Card() RateCard { return Cards[DefaultModel] }

func (Fake) InputTokens(_ context.Context, r Request) (int64, error) {
	return int64(len(r.Instructions)+len(r.Message))/4 + 1, nil
}

func (f Fake) Answer(ctx context.Context, r Request) (Reply, error) {
	input, _ := f.InputTokens(ctx, r)
	tokens := input + 50
	usage := &Usage{Input: input, Output: 50, Model: f.Card().Model, Tier: f.Card().Tier, RequestID: "fake"}
	if r.Schema == nil {
		return Reply{Text: "This is the development model's answer.", Tokens: &tokens, Usage: usage}, nil
	}
	if props, _ := r.Schema.JSON["properties"].(map[string]any); props["in_scope"] != nil {
		// Heidi's scope classifier: obvious off-topic messages never reach it, so the fake lets the rest through.
		return Reply{Text: `{"in_scope":true,"reason":"development model"}`, Tokens: &tokens, Usage: usage}, nil
	}
	// "Write with AI": a fixed short text.
	if props, _ := r.Schema.JSON["properties"].(map[string]any); props["text"] != nil {
		return Reply{Text: `{"text":"Written by the development model."}`, Tokens: &tokens, Usage: usage}, nil
	}
	// The workspace-name suggestion: the company name (the whole message) cut to 40 characters.
	if props, _ := r.Schema.JSON["properties"].(map[string]any); props["name"] != nil {
		name := []rune(strings.TrimSpace(r.Message))
		b, _ := json.Marshal(map[string]string{"name": string(name[:min(len(name), 40)])})
		return Reply{Text: string(b), Tokens: &tokens, Usage: usage}, nil
	}
	if r.Schema.Name == "receipt_v2" {
		b, _ := json.Marshal(map[string]any{"records": []any{fakeReceipt(r.Instructions)}})
		return Reply{Text: string(b), Tokens: &tokens, Usage: usage}, nil
	}
	if props, _ := r.Schema.JSON["properties"].(map[string]any); props["proposals"] != nil {
		b, _ := json.Marshal(fakeOrganize(r.Message))
		return Reply{Text: string(b), Tokens: &tokens, Usage: usage}, nil
	}
	if props, _ := r.Schema.JSON["properties"].(map[string]any); props["new_folder"] != nil {
		b, _ := json.Marshal(fakeFiling(r.Message))
		return Reply{Text: string(b), Tokens: &tokens, Usage: usage}, nil
	}
	// An import that works out the document type (one array per kind) reads the CSV as a client list.
	key := "records"
	if props, _ := r.Schema.JSON["properties"].(map[string]any); props["document_type"] != nil {
		key = "clients"
	}
	props := recordProperties(r.Schema.JSON, key)
	_, body, _ := strings.Cut(r.Message, "\n\n")
	rows, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	if err != nil && len(rows) == 0 {
		rows = nil
	}
	records := []map[string]any{}
	invoice := func(issued bool) map[string]any {
		return map[string]any{"number": strings.TrimSuffix(r.Files[0].Name, path.Ext(r.Files[0].Name)),
			"client_name": "Development Buyer AG", "issue_date": "2026-01-15", "currency": "CHF", "price_basis": "net",
			"issued_elsewhere": issued, "lines": []map[string]any{{"description": "Development model service", "quantity": "1",
				"unit": "hour", "unit_price": "100.00", "vat_category": "S", "vat_rate": "8.1"}}}
	}
	if _, invoices := props["lines"]; invoices && len(r.Files) > 0 {
		// An attached invoice (a PDF or photo) is read as one fixed invoice, numbered after the file.
		records = append(records, invoice(false))
	}
	if _, offered := recordProperties(r.Schema.JSON, "invoices")["lines"]; key == "clients" && offered && len(r.Files) > 0 {
		// An import that works the type out reads an attached file as an invoice the workspace issued, and its client.
		b, _ := json.Marshal(map[string]any{"document_type": "sales_invoice", "invoices": []map[string]any{invoice(true)},
			"clients": []map[string]any{{"name": "Development Buyer AG", "is_company": true, "city": "Zürich", "country": "CH"}}})
		return Reply{Text: string(b), Tokens: &tokens, Usage: usage}, nil
	}
	if len(rows) > 1 {
		header := rows[0]
		for _, row := range rows[1:] {
			rec := map[string]any{}
			for name := range props {
				rec[name] = nil
			}
			for i, col := range header {
				name := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(col)), " ", "_")
				if typ, ok := props[name]; ok && slices.Contains(typ, "string") && i < len(row) && row[i] != "" {
					rec[name] = row[i]
				}
			}
			records = append(records, rec)
		}
	}
	answer := map[string]any{key: records}
	if key == "clients" {
		answer["document_type"] = "client_list"
	}
	b, err := json.Marshal(answer)
	if err != nil {
		return Reply{}, errors.New("fake model could not encode its answer")
	}
	return Reply{Text: string(b), Tokens: &tokens, Usage: usage}, nil
}

// fakeReceipt is one fixed receipt (CHF 108.10 at 8.1%, unpaid) for the expense form's reading, in the first listed
// category ("- key | name | account" lines of the instructions), or none when the list is empty.
func fakeReceipt(instructions string) map[string]any {
	category := map[string]any{"key": nil, "confidence": 0, "reason": nil}
	_, list, _ := strings.Cut(instructions, "The categories (key | name | account):")
	for line := range strings.Lines(list) {
		rest, listed := strings.CutPrefix(strings.TrimSpace(line), "- ")
		if key, _, ok := strings.Cut(rest, " | "); listed && ok {
			category = map[string]any{"key": key, "confidence": 0.9, "reason": "development model"}
			break
		}
	}
	confidence := map[string]any{}
	for _, g := range []string{"supplier", "document", "totals", "vat_breakdown", "items", "payment"} {
		confidence[g] = "high"
	}
	return map[string]any{
		"supplier": map[string]any{"name": "Development Supplier AG", "vat_number": nil, "country": "CH", "iban": nil},
		"document": map[string]any{"type": "invoice", "number": "DEV-1", "date": "2026-01-15", "due_date": nil,
			"service_period": map[string]any{"from": nil, "to": nil}},
		"description": "Development model receipt", "currency": "CHF",
		"totals":        map[string]any{"net": "100.00", "vat": "8.10", "gross": "108.10"},
		"vat_breakdown": []any{map[string]any{"rate": "8.1", "net": "100.00", "vat": "8.10", "gross": "108.10"}},
		"items": []any{map[string]any{"description": "Development model service", "quantity": "1", "unit_price": "108.10",
			"amount": "108.10", "vat_rate": "8.1", "category": nil}},
		"payment":        map[string]any{"status": "unpaid", "method": nil, "paid_on": nil},
		"reverse_charge": false, "category": category, "confidence": confidence,
	}
}

// fakeFiling files by the file name: its first two words (of three letters or more) are the tags; the folder is the
// first listed one whose name, without a plural s, is in the file name, else a new folder named after the first word.
func fakeFiling(message string) map[string]any {
	var name string
	var folders [][2]string
	inFolders := false
	clients := fakeClients(message)
	for line := range strings.Lines(message) {
		line = strings.TrimRight(line, "\n")
		switch {
		case strings.HasPrefix(line, "File name: "):
			name = strings.ToLower(strings.TrimPrefix(line, "File name: "))
		case line == "Folders:":
			inFolders = true
		case line == "":
			inFolders = false
		case inFolders:
			if id, path, ok := strings.Cut(line, "\t"); ok {
				folders = append(folders, [2]string{id, path})
			}
		}
	}
	base := strings.TrimSuffix(name, path.Ext(name))
	var words []string
	for _, w := range strings.FieldsFunc(base, func(r rune) bool { return !unicode.IsLetter(r) }) {
		if len([]rune(w)) >= 3 && len(words) < 2 {
			words = append(words, w)
		}
	}
	out := map[string]any{"tags": words, "folder_id": nil, "new_folder": nil}
	if record := fakeRecordPath(base, clients); record != "" {
		out["new_folder"] = record
		return out
	}
	for _, f := range folders {
		leaf := strings.ToLower(f[1][strings.LastIndex(f[1], "/")+1:])
		if strings.Contains(base, strings.TrimSuffix(leaf, "s")) {
			out["folder_id"] = f[0]
			return out
		}
	}
	folder := "Other"
	if len(words) > 0 {
		folder = strings.ToUpper(words[0][:1]) + words[0][1:]
	}
	out["new_folder"] = folder
	return out
}

// recordProperties: the JSON types of each property of the items of the schema's array at key.
func recordProperties(schema map[string]any, key string) map[string][]string {
	out := map[string][]string{}
	props, _ := schema["properties"].(map[string]any)
	records, _ := props[key].(map[string]any)
	items, _ := records["items"].(map[string]any)
	fields, _ := items["properties"].(map[string]any)
	for name, v := range fields {
		p, _ := v.(map[string]any)
		switch t := p["type"].(type) {
		case string:
			out[name] = []string{t}
		case []string:
			out[name] = t
		}
	}
	return out
}

// fakeOrganize organizes by the file name: each document (a JSON line with id and name) goes into a folder named after
// the name's first word of three letters or more, plural, tagged with that word.
func fakeOrganize(message string) map[string]any {
	proposals := []map[string]any{}
	clients := fakeClients(message)
	for line := range strings.Lines(message) {
		var doc struct{ ID, Name, Folder string }
		if json.Unmarshal([]byte(line), &doc) != nil || doc.ID == "" {
			continue
		}
		base := strings.ToLower(strings.TrimSuffix(doc.Name, path.Ext(doc.Name)))
		if record := fakeRecordPath(base, clients); record != "" {
			proposals = append(proposals, map[string]any{"document_id": doc.ID, "folder": record, "tags": []string{},
				"reason": "The name says whose record it is.", "change": record != doc.Folder})
			continue
		}
		words := strings.FieldsFunc(base, func(r rune) bool { return !unicode.IsLetter(r) })
		i := slices.IndexFunc(words, func(w string) bool { return len([]rune(w)) >= 3 })
		if i < 0 {
			continue
		}
		word := []rune(words[i])
		folder := strings.ToUpper(string(word[:1])) + string(word[1:]) + "s"
		proposals = append(proposals, map[string]any{"document_id": doc.ID, "folder": folder, "tags": []string{words[i]},
			"reason": "The name says it is a " + words[i] + ".", "change": folder != doc.Folder})
	}
	return map[string]any{"proposals": proposals}
}

// fakeClients: the client names listed under "Clients:" (one per line, until a blank line).
func fakeClients(message string) []string {
	var out []string
	in := false
	for line := range strings.Lines(message) {
		line = strings.TrimRight(line, "\n")
		switch {
		case line == "Clients:":
			in = true
		case line == "":
			in = false
		case in:
			out = append(out, line)
		}
	}
	return out
}

// fakeRecordPath files by the name: "invoice" or "quote" with a listed client's name (spaces as - or _) goes to
// Clients/<client>/Invoices|Quotes/<year>, "receipt" to Expenses/Uncategorised/<year>; the year is a four-digit number in the
// name, else 2026. "" for anything else.
func fakeRecordPath(base string, clients []string) string {
	year := "2026"
	for _, w := range strings.FieldsFunc(base, func(r rune) bool { return !unicode.IsDigit(r) }) {
		if len(w) == 4 && w >= "1900" && w <= "2200" {
			year = w
			break
		}
	}
	flat := strings.NewReplacer("-", " ", "_", " ").Replace(base)
	if strings.Contains(flat, "receipt") {
		return "Expenses/Uncategorised/" + year
	}
	kind := ""
	switch {
	case strings.Contains(flat, "invoice"):
		kind = "Invoices"
	case strings.Contains(flat, "quote"):
		kind = "Quotes"
	default:
		return ""
	}
	for _, c := range clients {
		if strings.Contains(flat, strings.ToLower(c)) {
			return "Clients/" + c + "/" + kind + "/" + year
		}
	}
	return ""
}
