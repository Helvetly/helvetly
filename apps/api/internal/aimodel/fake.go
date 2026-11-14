package aimodel

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"slices"
	"strings"
)

// Fake answers without any external call, for end-to-end tests and local development only (HELVETLY_E2E_FAKE_AI, which
// config refuses outside development). A structured request gets one record per row of the CSV text after the first
// blank line of the message, its columns matched to the schema's string properties by header; anything else gets a
// fixed text, a scope classification (Heidi) always in scope. Files are not read.
type Fake struct{}

func (Fake) InputTokens(_ context.Context, r Request) (int64, error) {
	return int64(len(r.Instructions)+len(r.Message))/4 + 1, nil
}

func (f Fake) Answer(ctx context.Context, r Request) (Reply, error) {
	tokens, _ := f.InputTokens(ctx, r)
	tokens += 50
	if r.Schema == nil {
		return Reply{Text: "This is the development model's answer.", Tokens: &tokens}, nil
	}
	if props, _ := r.Schema.JSON["properties"].(map[string]any); props["in_scope"] != nil {
		// Heidi's scope classifier: obvious off-topic messages never reach it, so the fake lets the rest through.
		return Reply{Text: `{"in_scope":true,"reason":"development model"}`, Tokens: &tokens}, nil
	}
	props := recordProperties(r.Schema.JSON)
	_, body, _ := strings.Cut(r.Message, "\n\n")
	rows, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	if err != nil && len(rows) == 0 {
		rows = nil
	}
	records := []map[string]any{}
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
	b, err := json.Marshal(map[string]any{"records": records})
	if err != nil {
		return Reply{}, errors.New("fake model could not encode its answer")
	}
	return Reply{Text: string(b), Tokens: &tokens}, nil
}

// recordProperties: the JSON types of each property of the schema's records items.
func recordProperties(schema map[string]any) map[string][]string {
	out := map[string][]string{}
	props, _ := schema["properties"].(map[string]any)
	records, _ := props["records"].(map[string]any)
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
