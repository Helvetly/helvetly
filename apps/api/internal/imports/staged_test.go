package imports

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// counts: the workspace's Documents (any state) and staged import sources.
func (e *env) counts(ws string) (docs, staged int) {
	e.t.Helper()
	ctx := context.Background()
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM documents WHERE workspace_id = $1 AND NOT hr_private`, ws).Scan(&docs); err != nil {
		e.t.Fatal(err)
	}
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM staged_uploads WHERE workspace_id = $1`, ws).Scan(&staged); err != nil {
		e.t.Fatal(err)
	}
	return docs, staged
}

// sourceKey: the object an import batch's first file is read from.
func (e *env) sourceKey(batchID string) string {
	e.t.Helper()
	var key string
	if err := e.raw.QueryRow(context.Background(), `SELECT object_key FROM import_files WHERE batch_id = $1 ORDER BY position LIMIT 1`,
		batchID).Scan(&key); err != nil {
		e.t.Fatal(err)
	}
	return key
}

func (e *env) hasObject(key string) bool {
	e.files.mu.Lock()
	defer e.files.mu.Unlock()
	_, ok := e.files.objects[key]
	return ok
}

// A CSV of clients is no record's original: it is staged while the import runs, never a Document, and goes away
// (object and staged row) once every record is created or skipped.
func TestImportSourceIsNeverADocumentAndGoesWhenDone(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	b := e.extracted(decode[store.ImportBatch](t, e.upload("clients", map[string][]byte{"clients.csv": []byte(clientsCSV)})).ID)
	key := e.sourceKey(b.ID)
	if docs, staged := e.counts("ws_a"); docs != 0 || staged != 1 || !e.hasObject(key) {
		t.Fatalf("after upload: %d documents, %d staged, object %v", docs, staged, e.hasObject(key))
	}
	ids := []string{b.Records[0].ID, b.Records[1].ID}
	// one record still open (the second): the source stays for it
	if w := e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": ids[:1]}); w.Code != 200 {
		t.Fatalf("commit: %d %s", w.Code, w.Body)
	}
	if _, staged := e.counts("ws_a"); staged != 1 || !e.hasObject(key) {
		t.Fatalf("the source went while a record was open: %d staged", staged)
	}
	if w := e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": ids,
		"resolutions": map[string]string{ids[1]: "skip"}}); w.Code != 200 {
		t.Fatalf("commit: %d %s", w.Code, w.Body)
	}
	if docs, staged := e.counts("ws_a"); docs != 0 || staged != 0 || e.hasObject(key) {
		t.Fatalf("after the import: %d documents, %d staged, object %v", docs, staged, e.hasObject(key))
	}
}

func TestDiscardedImportDeletesItsSource(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	b := e.extracted(decode[store.ImportBatch](t, e.upload("clients", map[string][]byte{"c.csv": []byte(clientsCSV)})).ID)
	key := e.sourceKey(b.ID)
	if w := e.do("DELETE", "/api/v1/imports/"+b.ID, nil); w.Code != 204 {
		t.Fatalf("discard: %d %s", w.Code, w.Body)
	}
	if docs, staged := e.counts("ws_a"); docs != 0 || staged != 0 || e.hasObject(key) {
		t.Fatalf("after discard: %d documents, %d staged, object %v", docs, staged, e.hasObject(key))
	}
}

// The PDF of an invoice issued elsewhere is the invoice's legal original: it becomes a Document in the client's
// Invoices/<year> (the same object, kept) and is never deleted with the import's sources.
func TestIssuedOriginalBecomesADocumentInItsClientFolder(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	ctx := context.Background()
	if err := e.db.CreateClient(ctx, "ws_a", "cli_k", map[string]any{"name": "Kunde AG"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.model.replies = append(e.model.replies, answer(`{"records":[`+issuedRecord("ALT-1", "125.00")+`]}`))
	b := e.extracted(decode[store.ImportBatch](t, e.upload("invoices", map[string][]byte{"alt-1.pdf": []byte("%PDF-1.7 alt")})).ID)
	key := e.sourceKey(b.ID)
	out := decode[commitOut](t, e.do("POST", "/api/v1/imports/"+b.ID+"/commit", map[string]any{"record_ids": []string{b.Records[0].ID}}))
	if out.Results[0].Status != "created" {
		t.Fatalf("commit: %+v", out.Results)
	}
	inv, err := e.db.Invoice(ctx, "ws_a", *out.Results[0].EntityID, "2026-01-01", false)
	if err != nil || inv.SourceDocumentID == nil {
		t.Fatalf("invoice: %+v %v", inv, err)
	}
	d := inFolder(t, e.db, *e.sess, *inv.SourceDocumentID, "Clients", "Kunde AG", "Invoices", "2025")
	if d.ObjectKey != key || !e.hasObject(key) {
		t.Fatalf("original %+v, object kept %v", d, e.hasObject(key))
	}
	if docs, staged := e.counts("ws_a"); docs != 1 || staged != 0 {
		t.Fatalf("%d documents, %d staged", docs, staged)
	}
}
