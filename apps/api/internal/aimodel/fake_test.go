package aimodel

import (
	"context"
	"encoding/json"
	"testing"
)

func TestFakeReadsCSVIntoSchemaStringProperties(t *testing.T) {
	schema := map[string]any{"type": "object", "properties": map[string]any{"records": map[string]any{"type": "array",
		"items": map[string]any{"type": "object", "properties": map[string]any{
			"name": map[string]any{"type": []string{"string", "null"}}, "email": map[string]any{"type": []string{"string", "null"}},
			"is_company": map[string]any{"type": []string{"boolean", "null"}},
		}}}}}
	reply, err := Fake{}.Answer(context.Background(), Request{Message: "File name: a.csv\n\nName,Email,Is Company,Extra\nAcme AG,a@acme.example,true,x\n", Schema: &Schema{Name: "t", JSON: schema}})
	if err != nil || reply.Tokens == nil {
		t.Fatalf("reply=%+v err=%v", reply, err)
	}
	var out struct{ Records []map[string]any }
	if err := json.Unmarshal([]byte(reply.Text), &out); err != nil || len(out.Records) != 1 {
		t.Fatalf("%s %v", reply.Text, err)
	}
	r := out.Records[0]
	if r["name"] != "Acme AG" || r["email"] != "a@acme.example" || r["is_company"] != nil || r["extra"] != nil || len(r) != 3 {
		t.Fatalf("record: %v", r)
	}
	if text, _ := (Fake{}).Answer(context.Background(), Request{Message: "hi"}); text.Text == "" {
		t.Fatal("plain answer empty")
	}
}

func TestFakeClassifiesHeidiScopeAsInScope(t *testing.T) {
	schema := map[string]any{"type": "object", "properties": map[string]any{"in_scope": map[string]any{"type": "boolean"}, "reason": map[string]any{"type": "string"}}}
	reply, err := Fake{}.Answer(context.Background(), Request{Message: "What is my VAT?", Schema: &Schema{Name: "heidi_scope", JSON: schema}})
	if err != nil || reply.Tokens == nil || reply.Text != `{"in_scope":true,"reason":"development model"}` {
		t.Fatalf("reply=%+v err=%v", reply, err)
	}
}

func TestFakeReadsCSVAsAClientListForAnAutoImport(t *testing.T) {
	client := map[string]any{"type": "object", "properties": map[string]any{"name": map[string]any{"type": []string{"string", "null"}}}}
	schema := map[string]any{"type": "object", "properties": map[string]any{"document_type": map[string]any{"type": "string"},
		"clients": map[string]any{"type": "array", "items": client}, "invoices": map[string]any{"type": "array", "items": client}}}
	reply, err := Fake{}.Answer(context.Background(), Request{Message: "File name: a.csv\n\nName\nAcme AG\n", Schema: &Schema{Name: "t", JSON: schema}})
	var out struct {
		DocumentType string `json:"document_type"`
		Clients      []map[string]any
	}
	if err != nil || json.Unmarshal([]byte(reply.Text), &out) != nil || out.DocumentType != "client_list" || len(out.Clients) != 1 || out.Clients[0]["name"] != "Acme AG" {
		t.Fatalf("%s %v", reply.Text, err)
	}
}

func TestFakeSuggestsAWorkspaceName(t *testing.T) {
	schema := &Schema{Name: "workspace_name", JSON: map[string]any{"properties": map[string]any{"name": map[string]any{"type": "string"}}}}
	reply, err := Fake{}.Answer(context.Background(), Request{Message: "Muster Treuhand GmbH", Schema: schema})
	if err != nil || reply.Text != `{"name":"Muster Treuhand GmbH"}` || reply.Tokens == nil {
		t.Fatalf("reply %+v %v", reply, err)
	}
}
