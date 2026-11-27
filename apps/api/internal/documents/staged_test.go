package documents

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

const batch = "batch-0001"

func (e *env) stageFile(b *browser, batchID, name, content string) (*http.Response, []byte) {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	w, err := mw.CreateFormFile("file", name)
	if err != nil {
		e.t.Fatal(err)
	}
	_, _ = w.Write([]byte(content))
	_ = mw.WriteField("batch_id", batchID)
	_ = mw.Close()
	return e.send(b, "POST", "/api/v1/documents/staged", &buf, mw.FormDataContentType())
}

func (e *env) staged(b *browser, batchID, name, content string) store.StagedUpload {
	e.t.Helper()
	resp, raw := e.stageFile(b, batchID, name, content)
	if resp.StatusCode != 201 {
		e.t.Fatalf("stage %s: %d %s", name, resp.StatusCode, raw)
	}
	var out one[store.StagedUpload]
	if err := json.Unmarshal(raw, &out); err != nil {
		e.t.Fatal(err)
	}
	return out.Data
}

func (e *env) stagedRows(ws string) int {
	e.t.Helper()
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM staged_uploads WHERE workspace_id = $1`, ws).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

func (e *env) objectCount() int {
	e.files.mu.Lock()
	defer e.files.mu.Unlock()
	return len(e.files.objects)
}

type confirmAnswer struct {
	Data struct {
		Documents  []store.Document     `json:"documents"`
		Duplicates []store.StagedUpload `json:"duplicates"`
	}
}

func TestStagedFilesAreHiddenUntilConfirmed(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	inbox := e.folder(b, "Inbox", nil)
	u := e.staged(b, batch, "contract.pdf", pdf)
	var stored int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM stored_objects WHERE workspace_id = $1`, b.workspace).Scan(&stored); err != nil || stored != 1 {
		t.Fatalf("storage counted %d objects (%v), want the staged one", stored, err)
	}
	if p := e.list(b, ""); p.Meta.Total != 0 {
		t.Fatalf("listed: %v", names(p.Data))
	}
	if p := e.list(b, "q=contract"); p.Meta.Total != 0 {
		t.Fatalf("searched: %v", names(p.Data))
	}
	e.do(b, "GET", "/api/v1/documents/"+u.ID, nil, 404, nil)
	var groups struct {
		Data struct{ Groups []struct{ Count int } }
	}
	e.do(b, "GET", "/api/v1/documents/groups?group=type", nil, 200, &groups)
	if len(groups.Data.Groups) != 0 {
		t.Fatalf("grouped: %+v", groups.Data)
	}

	var out confirmAnswer
	e.do(b, "POST", "/api/v1/documents/staged/"+batch+"/confirm", map[string]any{"folder_id": inbox.ID}, 200, &out)
	if len(out.Data.Documents) != 1 || out.Data.Documents[0].ID != u.ID || *out.Data.Documents[0].FolderID != inbox.ID {
		t.Fatalf("confirmed: %+v", out.Data)
	}
	if p := e.list(b, "folder_id="+inbox.ID); p.Meta.Total != 1 || e.stagedRows(b.workspace) != 0 {
		t.Fatalf("after confirm: %v, %d staged", names(p.Data), e.stagedRows(b.workspace))
	}
	var events int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM financial_events WHERE workspace_id = $1
		AND kind = 'documents.upload_filed'`, b.workspace).Scan(&events); err != nil || events != 1 {
		t.Fatalf("audit entries %d (%v)", events, err)
	}
	// confirming again finds nothing
	e.do(b, "POST", "/api/v1/documents/staged/"+batch+"/confirm", map[string]any{}, 404, nil)
}

func TestStagedDuplicatesAreRefused(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	kept := e.uploaded(b, "kept.pdf", pdf)
	before := e.objectCount()
	resp, raw := e.stageFile(b, batch, "renamed.pdf", pdf)
	if resp.StatusCode != 409 || !strings.Contains(string(raw), kept.ID) {
		t.Fatalf("existing duplicate: %d %s", resp.StatusCode, raw)
	}
	e.staged(b, batch, "a.png", png)
	resp, raw = e.stageFile(b, batch, "a copy.png", png)
	if resp.StatusCode != 409 || !strings.Contains(string(raw), `"duplicate_file"`) {
		t.Fatalf("in-batch duplicate: %d %s", resp.StatusCode, raw)
	}
	if e.objectCount() != before+1 || e.stagedRows(b.workspace) != 1 {
		t.Fatalf("stored %d objects, %d staged", e.objectCount()-before, e.stagedRows(b.workspace))
	}
	// the same bytes uploaded meanwhile elsewhere: confirm reports the staged copy as a duplicate and stores nothing twice
	e.uploaded(b, "first.png", png)
	var out confirmAnswer
	e.do(b, "POST", "/api/v1/documents/staged/"+batch+"/confirm", map[string]any{}, 200, &out)
	if len(out.Data.Documents) != 0 || len(out.Data.Duplicates) != 1 || e.stagedRows(b.workspace) != 0 {
		t.Fatalf("confirm: %+v", out.Data)
	}
}

func TestStagedCancelExpiryAndOwnership(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	colleague := e.join(b.workspace, "admin")
	other := e.workspace()
	e.staged(b, batch, "mine.pdf", pdf)
	// another member, or another workspace, cannot confirm or cancel my batch
	e.do(colleague, "POST", "/api/v1/documents/staged/"+batch+"/confirm", map[string]any{}, 404, nil)
	e.do(other, "POST", "/api/v1/documents/staged/"+batch+"/confirm", map[string]any{}, 404, nil)
	e.do(colleague, "POST", "/api/v1/documents/staged/"+batch+"/cancel", nil, 204, nil)
	if e.stagedRows(b.workspace) != 1 || e.objectCount() != 1 {
		t.Fatal("another member's cancel deleted my file")
	}
	e.do(b, "POST", "/api/v1/documents/staged/"+batch+"/cancel", nil, 204, nil)
	if e.stagedRows(b.workspace) != 0 || e.objectCount() != 0 {
		t.Fatalf("after cancel: %d staged, %d objects", e.stagedRows(b.workspace), e.objectCount())
	}

	fresh := e.staged(b, "batch-0002", "fresh.pdf", pdf)
	e.staged(b, "batch-0003", "old.png", png)
	if _, err := e.raw.Exec(context.Background(), `UPDATE staged_uploads SET created_at = now() - interval '25 hours'
		WHERE workspace_id = $1 AND id <> $2`, b.workspace, fresh.ID); err != nil {
		t.Fatal(err)
	}
	e.svc.ExpireStaged(context.Background())
	if e.stagedRows(b.workspace) != 1 || e.objectCount() != 1 {
		t.Fatalf("after expiry: %d staged, %d objects", e.stagedRows(b.workspace), e.objectCount())
	}
}

func TestStagedApplyFilesIntoSystemFolders(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	ctx := context.Background()
	if err := e.st.CreateClient(ctx, b.workspace, "cli_k", map[string]any{"name": "Kunde AG"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	inbox := e.folder(b, "Inbox", nil)
	statement := e.staged(b, batch, "statement.pdf", pdf)
	tax := e.staged(b, batch, "assessment.png", png)
	left := e.staged(b, batch, "notes.txt", "notes")
	items := []map[string]any{
		{"document_id": statement.ID, "folder": "Clients/Kunde AG/Documents/2026/Bank Statements", "tags": []string{"bank-statement"}},
		{"document_id": tax.ID, "folder": "Tax Documents/2025", "tags": []string{"tax-document"}},
		{"document_id": "doc_foreign", "folder": "Stolen", "tags": []string{}},
	}
	var out confirmAnswer
	e.do(b, "POST", "/api/v1/documents/staged/"+batch+"/confirm", map[string]any{"folder_id": inbox.ID, "items": items}, 200, &out)
	if len(out.Data.Documents) != 3 {
		t.Fatalf("confirmed %+v", out.Data)
	}
	var all one[[]store.Folder]
	e.do(b, "GET", "/api/v1/documents/folders", nil, 200, &all)
	folders := all.Data
	path := func(id *string) string {
		if id == nil {
			return ""
		}
		f := folderByID(folders, *id)
		parts := []string{f.Name}
		for f.ParentID != nil {
			f = folderByID(folders, *f.ParentID)
			parts = append([]string{f.Name}, parts...)
		}
		return strings.Join(parts, "/")
	}
	ds, dt, dl := e.get(b, statement.ID), e.get(b, tax.ID), e.get(b, left.ID)
	if path(ds.FolderID) != "Clients/Kunde AG/Documents/2026/Bank Statements" || !slices.Contains(ds.LockedTags, "bank-statement") {
		t.Fatalf("statement in %q: %+v", path(ds.FolderID), ds)
	}
	if path(dt.FolderID) != "Tax Documents/2025" || !slices.Contains(dt.LockedTags, "tax-document") {
		t.Fatalf("tax document in %q: %+v", path(dt.FolderID), dt)
	}
	if path(dl.FolderID) != "Inbox" { // left out of the items: the folder the person was in
		t.Fatalf("left file in %q", path(dl.FolderID))
	}
	if slices.ContainsFunc(folders, func(f store.Folder) bool { return f.Name == "Stolen" }) {
		t.Fatal("a row of no staged file made a folder")
	}
}

func TestStagedAnalyze(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	u := e.staged(b, batch, "invoice-acme.txt", "Invoice 42 from Acme")
	e.fails(b, "POST", "/api/v1/documents/staged/"+batch+"/analyze", map[string]any{"ids": []string{u.ID}}, 503, "ai_unavailable")

	m := e.filer(nil)
	e.fails(b, "POST", "/api/v1/documents/staged/"+batch+"/analyze", map[string]any{"ids": []string{u.ID}}, 403, "ai_consent_required")
	e.approveAI(b)
	colleague := e.join(b.workspace, "admin")
	e.approveAI(colleague)
	e.do(colleague, "POST", "/api/v1/documents/staged/"+batch+"/analyze", map[string]any{"ids": []string{u.ID}}, 404, nil)
	var out organizeAnswer
	e.do(b, "POST", "/api/v1/documents/staged/"+batch+"/analyze", map[string]any{"ids": []string{u.ID}}, 200, &out)
	if len(out.Data.Proposals) != 1 || out.Data.Proposals[0].DocumentID != u.ID || out.Data.Considered != 1 {
		t.Fatalf("analysis %+v", out.Data)
	}
	if asked := m.asked(); len(asked) != 1 || !strings.Contains(asked[0].Message, "Invoice 42 from Acme") {
		t.Fatalf("model asked %d times", len(asked))
	}
	if e.stagedRows(b.workspace) != 1 || e.list(b, "").Meta.Total != 0 {
		t.Fatal("analysing changed the batch")
	}
}

// A ZIP an earlier import kept in Documents only as its source leaves Documents for the staging area (and is deleted
// with it a day later); one a person tagged stays.
func TestLegacyImportSourcesLeaveDocuments(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	ctx := context.Background()
	source := e.uploaded(b, "invoices.zip", "PK\x03\x04zip")
	tagged := e.uploaded(b, "kept.zip", "PK\x03\x04kept")
	e.do(b, "PATCH", "/api/v1/documents/"+tagged.ID, map[string]any{"tags": []string{"mine"}}, 200, nil)
	if source.ContentType != "application/zip" {
		t.Fatalf("type %s", source.ContentType)
	}
	for i, id := range []string{source.ID, tagged.ID} {
		if _, err := e.raw.Exec(ctx, `INSERT INTO import_batches (id, workspace_id, user_id, kind, created_at) VALUES ($1, $2, $3, 'invoices', now())`,
			"imp_"+id, b.workspace, b.user); err != nil {
			t.Fatal(err)
		}
		if _, err := e.raw.Exec(ctx, `INSERT INTO import_files (id, batch_id, workspace_id, position, name, size, content_type, object_key,
			document_id, status, created_at, updated_at) SELECT 'imf_' || id, 'imp_' || id, workspace_id, $3, name, size, content_type,
			object_key, id, 'done', now(), now() FROM documents WHERE id = $1 AND workspace_id = $2`, id, b.workspace, i); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 { // idempotent
		if err := e.svc.StageLegacySources(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if p := e.list(b, ""); p.Meta.Total != 1 || p.Data[0].ID != tagged.ID || e.stagedRows(b.workspace) != 1 {
		t.Fatalf("after repair: %v, %d staged", names(p.Data), e.stagedRows(b.workspace))
	}
	var events int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM financial_events WHERE workspace_id = $1 AND kind = 'documents.import_sources_removed'`,
		b.workspace).Scan(&events); err != nil || events != 1 {
		t.Fatalf("audit entries %d (%v)", events, err)
	}
}
