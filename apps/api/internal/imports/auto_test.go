package imports

import (
	"archive/zip"
	"context"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/store"
)

const autoInvoice = `{"document_type": "sales_invoice",
	"clients": [{"name": "Anna Beispiel", "is_company": false, "street": "Musterweg", "street_number": "50", "zip": "6330",
		"city": "Cham", "country": "CH"}, {"name": "anna beispiel"}],
	"invoices": [{"client_name": "Anna Beispiel", "number": "2025/IN/001", "issue_date": "2025-01-08", "due_date": "2025-01-31",
		"currency": "CHF", "price_basis": "net", "issued_elsewhere": true, "total": "828.00",
		"lines": [{"description": "Lesson (online)", "quantity": "12", "unit": "hour", "unit_price": "69.00", "vat_category": "O"}]}],
	"products": [], "engagements": [], "expenses": []}`

func autoRecords(b store.ImportBatch, kind string) []store.ImportRecord {
	var out []store.ImportRecord
	for _, r := range b.Records {
		if r.Kind == kind {
			out = append(out, r)
		}
	}
	return out
}

func TestAutoImportRecognisesLinksAndCommitsInOrder(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	byFile := func(r aimodel.Request) (aimodel.Reply, error) {
		if strings.Contains(r.Message, "Lunch") {
			return answer(`{"document_type": "other", "clients": [], "invoices": []}`)(r)
		}
		return answer(autoInvoice)(r)
	}
	e.model.replies = append(e.model.replies, byFile, byFile)
	w := e.upload(Auto, map[string][]byte{"a-invoice.txt": []byte("Invoice 2025/IN/001"), "b-menu.txt": []byte("Lunch menu")})
	if w.Code != 201 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	b := e.extracted(decode[store.ImportBatch](t, w).ID)
	if b.Kind != Auto || b.Status != "review" {
		t.Fatalf("batch: %+v", b)
	}
	if got := e.model.seen[0].Instructions; !strings.Contains(got, `"ws_a"`) || !strings.Contains(got, "sales_invoice") {
		t.Fatalf("instructions name neither the workspace nor the types: %s", got)
	}
	types := map[string]string{}
	for _, f := range b.Files {
		if f.DocumentType != nil {
			types[f.Name] = *f.DocumentType
		}
		if f.Name == "b-menu.txt" && (f.Status != "failed" || f.Error == nil || *f.Error != notRecognised) {
			t.Fatalf("unrecognised file: %+v", f)
		}
	}
	if types["a-invoice.txt"] != "sales_invoice" || types["b-menu.txt"] != "other" {
		t.Fatalf("document types: %v", types)
	}
	clients, invoices := autoRecords(b, "clients"), autoRecords(b, "invoices")
	if len(clients) != 1 || len(invoices) != 1 || len(b.Records) != 2 {
		t.Fatalf("records (the repeated client is merged): %+v", b.Records)
	}
	if len(invoices[0].Issues) != 0 {
		t.Fatalf("the invoice's client comes from the same import, so it has no issue: %v", invoices[0].Issues)
	}

	// The invoice is sent first; the commit still creates its client before it.
	w = e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": []string{invoices[0].ID, clients[0].ID}})
	res := decode[struct{ Results []commitResult }](t, w).Results
	if w.Code != 200 || len(res) != 2 || res[0].ID != clients[0].ID || res[0].Status != "created" || res[1].Status != "created" {
		t.Fatalf("commit: %d %s", w.Code, w.Body)
	}
	inv, err := e.db.Invoice(context.Background(), "ws_a", *res[1].EntityID, "2026-01-01", false)
	if err != nil || inv.ClientID != *res[0].EntityID {
		t.Fatalf("invoice %+v not for the new client %s: %v", inv, *res[0].EntityID, err)
	}

	// The same invoice again: the same two records, each matched to what the first import created. The client is
	// settled (linked, not created again); the number is taken (a conflict to resolve).
	e.model.replies = append(e.model.replies, answer(autoInvoice))
	w = e.upload(Auto, map[string][]byte{"again.txt": []byte("Invoice 2025/IN/001, scanned again")})
	again := e.extracted(decode[store.ImportBatch](t, w).ID)
	clients, invoices = autoRecords(again, "clients"), autoRecords(again, "invoices")
	if len(again.Records) != 2 || len(clients) != 1 || len(invoices) != 1 {
		t.Fatalf("second import shows other records than the first: %+v", again.Records)
	}
	if c := clients[0]; c.Status != "skipped" || c.Duplicate == nil || c.Duplicate.ID != *res[0].EntityID {
		t.Fatalf("client not matched to the existing one: %+v", c)
	}
	if i := invoices[0]; i.Status != "pending" || i.Duplicate == nil || i.Duplicate.ID != *res[1].EntityID {
		t.Fatalf("invoice not matched to the existing one: %+v", i)
	}
	w = e.do("POST", "/api/v1/imports/"+again.ID+"/commit", map[string]any{"record_ids": []string{invoices[0].ID, clients[0].ID}})
	got := decode[struct{ Results []commitResult }](t, w).Results
	if len(got) != 2 || got[0].Status != "skipped" || got[1].Status != "conflict" {
		t.Fatalf("matched client stays out, taken number conflicts: %s", w.Body)
	}
}

// TestAutoImportMatchesExistingClients: a file's client that already exists in the workspace (by name, VAT number
// or email) is kept as a settled record matched to it; one of another workspace never matches.
func TestAutoImportMatchesExistingClients(t *testing.T) {
	for _, tc := range []struct {
		name, ws string
		fields   map[string]any
		reason   string
	}{
		{"same name", "ws_a", map[string]any{"name": "ANNA BEISPIEL"}, "same name"},
		{"same VAT number", "ws_a", map[string]any{"name": "Beispiel Consulting", "vat_number": "CHE-116.281.710"}, "same VAT number"},
		{"same email", "ws_a", map[string]any{"name": "A. Beispiel", "email": "Anna@Example.ch"}, "same email"},
		{"another workspace's client", "ws_b", map[string]any{"name": "Anna Beispiel"}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t)
			e.consent("ws_a", "usr_a")
			e.person("ws_b", "usr_b", "owner", nil)
			if err := e.db.CreateClient(context.Background(), tc.ws, "cli_known", tc.fields, time.Now()); err != nil {
				t.Fatal(err)
			}
			e.model.replies = append(e.model.replies, answer(`{"document_type": "sales_invoice",
				"clients": [{"name": "Anna Beispiel", "vat_number": "CHE-116.281.710", "email": "anna@example.ch"}],
				"invoices": [{"client_name": "Anna Beispiel", "number": "2025/IN/009", "issue_date": "2025-01-08",
					"currency": "CHF", "price_basis": "net", "total": "69.00",
					"lines": [{"description": "Lesson", "quantity": "1", "unit": "hour", "unit_price": "69.00", "vat_category": "O"}]}],
				"products": [], "engagements": [], "expenses": []}`))
			w := e.upload(Auto, map[string][]byte{"invoice.txt": []byte("Invoice 2025/IN/009")})
			b := e.extracted(decode[store.ImportBatch](t, w).ID)
			clients := autoRecords(b, "clients")
			if len(clients) != 1 || len(autoRecords(b, "invoices")) != 1 {
				t.Fatalf("records: %+v", b.Records)
			}
			c := clients[0]
			if tc.reason == "" {
				if c.Status != "pending" || c.Duplicate != nil {
					t.Fatalf("matched across workspaces: %+v", c)
				}
				return
			}
			if c.Status != "skipped" || c.Duplicate == nil || c.Duplicate.ID != "cli_known" || c.Duplicate.Reason != tc.reason {
				t.Fatalf("client %+v, want skipped and matched to cli_known (%s)", c, tc.reason)
			}
			if inv := autoRecords(b, "invoices")[0]; len(inv.Issues) != 0 {
				t.Fatalf("the invoice links to the existing client: %v", inv.Issues)
			}
		})
	}
}

func TestAutoImportChecksEachRecordsScope(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	clerk := e.person("ws_a", "usr_clerk", "member", []string{"read:*", "write:documents", "write:clients"})
	e.consent("ws_a", "usr_clerk")
	e.model.replies = append(e.model.replies, answer(autoInvoice))
	w := e.as(clerk).upload(Auto, map[string][]byte{"invoice.txt": []byte("Invoice")})
	if w.Code != 201 {
		t.Fatalf("documents writer may start an auto import: %d %s", w.Code, w.Body)
	}
	b := e.extracted(decode[store.ImportBatch](t, w).ID)
	ids := []string{}
	for _, r := range b.Records {
		ids = append(ids, r.ID)
	}
	w = e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": ids})
	res := decode[struct{ Results []commitResult }](t, w).Results
	if len(res) != 2 || res[0].Status != "created" || res[1].Status != "failed" || res[1].Error == nil || res[1].Error.Code != "forbidden" {
		t.Fatalf("commit: %s", w.Body)
	}
	invoice := autoRecords(b, "invoices")[0]
	if w := e.do("PATCH", "/api/v1/imports/"+b.ID+"/records/"+invoice.ID, map[string]any{"data": map[string]any{"number": "X"}}); w.Code != 403 {
		t.Fatalf("editing an invoice needs write:invoices: %d %s", w.Code, w.Body)
	}
	if w := e.do("PATCH", "/api/v1/imports/"+b.ID+"/records/"+invoice.ID, map[string]any{"data": map[string]any{"title": "X"}}); w.Code != 403 {
		t.Fatalf("scope before field names: %d %s", w.Code, w.Body)
	}
}

func TestByCommitOrder(t *testing.T) {
	records := []store.ImportRecord{{ID: "i", Kind: "invoices"}, {ID: "c", Kind: "clients"}, {ID: "x", Kind: "expenses"},
		{ID: "p", Kind: "products"}, {ID: "e", Kind: "engagements"}, {ID: "c2", Kind: "clients"}}
	got := byCommitOrder([]string{"i", "x", "c", "e", "p", "c2", "unknown"}, records)
	if strings.Join(got, ",") != "c,c2,p,i,e,x,unknown" {
		t.Fatalf("order: %v", got)
	}
}

func TestAutoImportKeepsAZipEntryAsTheIssuedInvoicesOriginal(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	e.model.replies = append(e.model.replies, answer(autoInvoice))
	pdf := []byte("%PDF-1.4\n% invoice 2025/IN/001\n")
	w := e.upload(Auto, map[string][]byte{"invoices.zip": zipOf(t, map[string][]byte{"2025-IN-001.pdf": pdf}, zip.Deflate)})
	if w.Code != 201 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	b := e.extracted(decode[store.ImportBatch](t, w).ID)
	ids := []string{}
	for _, r := range b.Records {
		ids = append(ids, r.ID)
	}
	w = e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": ids})
	res := decode[struct{ Results []commitResult }](t, w).Results
	if len(res) != 2 || res[1].Status != "created" {
		t.Fatalf("an issued invoice from a ZIP is created: %s", w.Body)
	}
	inv, err := e.db.Invoice(context.Background(), "ws_a", *res[1].EntityID, "2026-01-01", false)
	if err != nil || inv.SourceDocumentID == nil {
		t.Fatalf("invoice %+v has no original: %v", inv, err)
	}
	doc, err := e.db.Document(context.Background(), "ws_a", *inv.SourceDocumentID)
	if err != nil || doc.Name != "2025-IN-001.pdf" || doc.SHA256 == nil || string(e.files.objects[doc.ObjectKey]) != string(pdf) {
		t.Fatalf("original document %+v: %v", doc, err)
	}
}
