package invoices

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// optionalFields: the optional invoice details as the API returns them.
type optionalFields struct {
	ID                  string             `json:"id"`
	ClientNumberDisplay *string            `json:"client_number_display"`
	ContractReference   *string            `json:"contract_reference"`
	ContractDocument    *store.DocumentRef `json:"contract_document"`
}

func (e *env) optional(b *browser, method, path string, body any, want int) optionalFields {
	e.t.Helper()
	var out struct{ Data optionalFields }
	e.do(b, method, path, body, want, &out)
	return out.Data
}

func (e *env) document(workspace, userID, name string) string {
	e.t.Helper()
	id := auth.NewID("doc")
	d := store.Document{ID: id, Name: name, Size: 9, ContentType: "application/pdf", ObjectKey: "workspaces/" + workspace + "/documents/" + id}
	if err := e.st.CreateDocument(context.Background(), workspace, userID, d); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func TestOptionalClientAndContractFields(t *testing.T) {
	e := newEnv(t)
	b, clientID := e.ready()
	sess, contract := e.importSession(b) // a document of the workspace named "Rechnung ALT-7 (alt).pdf"
	ctx := context.Background()
	trashed := e.document(b.workspace, sess.User.ID, "old.pdf")
	if _, err := e.st.TrashDocument(ctx, b.workspace, trashed, sess.User.ID, "2026-01-01", time.Now()); err != nil {
		t.Fatal(err)
	}
	hr := e.document(b.workspace, sess.User.ID, "payslip.pdf")
	if _, err := e.raw.Exec(ctx, `UPDATE documents SET hr_private = true WHERE id = $1`, hr); err != nil {
		t.Fatal(err)
	}
	other := e.workspace()
	_, foreign := e.importSession(other)

	// A new draft has none of them: the PDF prints the client's own number, as before.
	plain := e.optional(b, "POST", "/api/v1/invoices", map[string]any{"client_id": clientID, "lines": []any{line("1", "10")}}, http.StatusCreated)
	if plain.ClientNumberDisplay != nil || plain.ContractReference != nil || plain.ContractDocument != nil {
		t.Fatalf("new draft: %+v", plain)
	}
	var raw map[string]json.RawMessage
	e.do(b, "GET", "/api/v1/invoices/"+plain.ID, nil, http.StatusOK, &struct{ Data *map[string]json.RawMessage }{&raw})
	for _, k := range []string{"client_number_display", "contract_reference", "contract_document"} {
		if string(raw[k]) != "null" {
			t.Errorf("%s = %s, want null", k, raw[k])
		}
	}

	path := "/api/v1/invoices/" + plain.ID
	set := e.optional(b, "PATCH", path, map[string]any{"client_number_display": " ", "contract_reference": " C23-25-CP2302 ",
		"contract_document_id": contract}, http.StatusOK)
	if set.ClientNumberDisplay == nil || *set.ClientNumberDisplay != "" || deref(set.ContractReference) != "C23-25-CP2302" ||
		set.ContractDocument == nil || set.ContractDocument.ID != contract || set.ContractDocument.Name != "Rechnung ALT-7 (alt).pdf" {
		t.Fatalf("set: %+v %v", set, set.ContractDocument)
	}
	if got := e.optional(b, "PATCH", path, map[string]any{"client_number_display": "K-0815"}, http.StatusOK); deref(got.ClientNumberDisplay) != "K-0815" ||
		got.ContractDocument == nil {
		t.Fatalf("custom number: %+v", got)
	}

	for _, tc := range []struct {
		name  string
		body  map[string]any
		field string
	}{
		{"client number over 40", map[string]any{"client_number_display": strings.Repeat("9", 41)}, "client_number_display"},
		{"client number not text", map[string]any{"client_number_display": 7}, "client_number_display"},
		{"contract number over 100", map[string]any{"contract_reference": strings.Repeat("C", 101)}, "contract_reference"},
		{"missing document", map[string]any{"contract_document_id": "doc_missing"}, "contract_document_id"},
		{"another workspace's document", map[string]any{"contract_document_id": foreign}, "contract_document_id"},
		{"document in the trash", map[string]any{"contract_document_id": trashed}, "contract_document_id"},
		{"HR file", map[string]any{"contract_document_id": hr}, "contract_document_id"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e.fails(b, "PATCH", path, tc.body, http.StatusUnprocessableEntity, "validation_failed", tc.field)
			body := map[string]any{"client_id": clientID, "lines": []any{line("1", "10")}}
			for k, v := range tc.body {
				body[k] = v
			}
			e.fails(b, "POST", "/api/v1/invoices", body, http.StatusUnprocessableEntity, "validation_failed", tc.field)
			e.fails(b, "POST", "/api/v1/invoices/preview", body, http.StatusUnprocessableEntity, "validation_failed", tc.field)
		})
	}
	if got := e.optional(b, "POST", "/api/v1/invoices/preview", map[string]any{"contract_reference": "C-9", "contract_document_id": contract},
		http.StatusOK); deref(got.ContractReference) != "C-9" || got.ContractDocument == nil {
		t.Fatalf("preview: %+v", got)
	}

	// Copies keep them; null clears them; an issued invoice keeps them for good.
	dup := e.optional(b, "POST", path+"/duplicate", nil, http.StatusCreated)
	if deref(dup.ClientNumberDisplay) != "K-0815" || deref(dup.ContractReference) != "C23-25-CP2302" || dup.ContractDocument == nil {
		t.Fatalf("duplicate: %+v", dup)
	}
	cleared := e.optional(b, "PATCH", "/api/v1/invoices/"+dup.ID, map[string]any{"client_number_display": nil, "contract_reference": nil,
		"contract_document_id": nil}, http.StatusOK)
	if cleared.ClientNumberDisplay != nil || cleared.ContractReference != nil || cleared.ContractDocument != nil {
		t.Fatalf("cleared: %+v", cleared)
	}
	e.invoice(b, "POST", path+"/issue", nil, http.StatusOK)
	e.fails(b, "PATCH", path, map[string]any{"contract_reference": "C-2"}, http.StatusConflict, "invoice_locked")
	credit := e.optional(b, "POST", path+"/credit-note", map[string]any{"lines": []any{line("1", "10")}}, http.StatusCreated)
	if deref(credit.ContractReference) != "C23-25-CP2302" || deref(credit.ClientNumberDisplay) != "K-0815" {
		t.Fatalf("credit note: %+v", credit)
	}
}
