package imports

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

// document keeps a file in Documents of ws, its bytes in storage, and returns its id.
func (e *env) document(ws, id, name string, data []byte, hr bool) string {
	e.t.Helper()
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	key := ws + "/documents/" + id
	e.files.objects[key] = data
	err := e.db.Tx(context.Background(), func(q store.Q) error {
		return q.CreateDocument(context.Background(), ws, "usr_a", store.Document{ID: id, Name: name, Size: int64(len(data)),
			ContentType: "text/plain", SHA256: &hash, ObjectKey: key, CreatedAt: time.Now(), HRPrivate: hr})
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func TestImportFromDocumentsRefuses(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	e.person("ws_b", "usr_b", "owner", nil)
	mine := e.document("ws_a", "doc_mine", "invoice.txt", []byte("Invoice 2025/IN/001"), false)
	theirs := e.document("ws_b", "doc_theirs", "theirs.txt", []byte("Invoice 9"), false)
	hr := e.document("ws_a", "doc_hr", "salary.txt", []byte("Salary slip"), true)
	trashed := e.document("ws_a", "doc_trashed", "old.txt", []byte("Old invoice"), false)
	if _, err := e.raw.Exec(context.Background(), `UPDATE documents SET deleted_at = now() WHERE id = $1`, trashed); err != nil {
		t.Fatal(err)
	}
	big := e.document("ws_a", "doc_big", "big.txt", []byte("Big"), false)
	if _, err := e.raw.Exec(context.Background(), `UPDATE documents SET size = $2 WHERE id = $1`, big, uploads.MaxRequestBytes+1); err != nil {
		t.Fatal(err)
	}
	reader := e.person("ws_a", "usr_reader", "member", []string{"read:*"})
	e.consent("ws_a", "usr_reader")
	noConsent := e.person("ws_a", "usr_new", "owner", nil)

	for _, tc := range []struct {
		name   string
		as     *store.Session
		ids    []string
		status int
		code   string
	}{
		{"none chosen", e.sess, []string{}, 400, "invalid_request"},
		{"too many", e.sess, make([]string, maxFiles+1), 400, "invalid_request"},
		{"another workspace's document", e.sess, []string{theirs}, 404, "not_found"},
		{"an HR file", e.sess, []string{hr}, 404, "not_found"},
		{"in the Trash", e.sess, []string{mine, trashed}, 400, "invalid_request"},
		{"more than one import holds", e.sess, []string{mine, big}, 413, "payload_too_large"},
		{"read-only member", reader, []string{mine}, 403, "forbidden"},
		{"no AI approval", noConsent, []string{mine}, 403, "ai_consent_required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := e.as(tc.as).do("POST", "/api/v1/imports/documents", map[string]any{"document_ids": tc.ids})
			if w.Code != tc.status || code(w) != tc.code {
				t.Fatalf("%d %s, want %d %s", w.Code, w.Body, tc.status, tc.code)
			}
		})
	}
	e.as(e.sess)
	e.s.provider = nil
	if w := e.do("POST", "/api/v1/imports/documents", map[string]any{"document_ids": []string{mine}}); w.Code != 409 || code(w) != "ai_not_configured" {
		t.Fatalf("no model: %d %s", w.Code, w.Body)
	}
	var batches int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM import_batches`).Scan(&batches); err != nil || batches != 0 {
		t.Fatalf("a refused start left %d batches (%v)", batches, err)
	}
}

func TestImportFromDocumentsReusesAndReviews(t *testing.T) {
	e := newEnv(t)
	e.consent("ws_a", "usr_a")
	e.model.replies = append(e.model.replies, answer(autoInvoice))
	doc := e.document("ws_a", "doc_inv", "invoice.txt", []byte("Invoice 2025/IN/001"), false)
	same := e.document("ws_a", "doc_copy", "invoice copy.txt", []byte("Invoice 2025/IN/001"), false)
	objects := len(e.files.objects)

	w := e.do("POST", "/api/v1/imports/documents", map[string]any{"document_ids": []string{doc, same}})
	if w.Code != 201 {
		t.Fatalf("start: %d %s", w.Code, w.Body)
	}
	started := decode[store.ImportBatch](t, w)
	if started.Kind != Auto || len(started.Files) != 1 || !started.Files[0].Reused || started.Files[0].Name != "invoice.txt" {
		t.Fatalf("batch (the same bytes are read once, from the Document): %+v", started)
	}
	if e.files.puts != 0 || len(e.files.objects) != objects || len(e.filed) != 0 {
		t.Fatalf("nothing is stored or filed again: puts %d, objects %d, filed %v", e.files.puts, len(e.files.objects), e.filed)
	}
	var docs int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM documents`).Scan(&docs); err != nil || docs != 2 {
		t.Fatalf("documents %d (%v)", docs, err)
	}

	b := e.extracted(started.ID)
	if b.Status != "review" || len(autoRecords(b, "invoices")) != 1 || len(autoRecords(b, "clients")) != 1 {
		t.Fatalf("records to review: %+v", b)
	}
	var source *string
	if err := e.raw.QueryRow(context.Background(), `SELECT document_id FROM import_files WHERE batch_id = $1`, b.ID).Scan(&source); err != nil || source == nil || *source != doc {
		t.Fatalf("the file reads the Document %v (%v)", source, err)
	}
}
