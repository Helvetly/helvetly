package expenses

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

type docRow struct {
	ID, Name string
	Folder   []string
	Tags     []string
}

// docs: the workspace's live documents with their folder path (top level first).
func (e *env) docs(ws string) []docRow {
	e.t.Helper()
	rows, err := e.raw.Query(context.Background(), `WITH RECURSIVE p(id, path) AS (
		SELECT id, ARRAY[name] FROM document_folders WHERE parent_id IS NULL AND workspace_id = $1
		UNION ALL SELECT f.id, p.path || f.name FROM document_folders f JOIN p ON f.parent_id = p.id)
		SELECT d.id, d.name, coalesce(p.path, '{}'), d.tags FROM documents d LEFT JOIN p ON p.id = d.folder_id
		WHERE d.workspace_id = $1 AND d.deleted_at IS NULL ORDER BY d.name`, ws)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	var out []docRow
	for rows.Next() {
		var d docRow
		if err := rows.Scan(&d.ID, &d.Name, &d.Folder, &d.Tags); err != nil {
			e.t.Fatal(err)
		}
		out = append(out, d)
	}
	return out
}

func wsOf(e *env, b *browser, id string) string {
	e.t.Helper()
	var ws string
	if err := e.raw.QueryRow(context.Background(), `SELECT workspace_id FROM expenses WHERE id = $1`, id).Scan(&ws); err != nil {
		e.t.Fatal(err)
	}
	return ws
}

func TestReceiptIsCopiedToDocumentsAndFollowsCategoryChange(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cats := e.categories(b)
	x := e.create(b, complete(cats["6640"].ID))
	if r := e.upload(b, x.ID, "train.pdf", pdf); r.StatusCode != 201 {
		t.Fatalf("upload: %d", r.StatusCode)
	}
	ws := wsOf(e, b, x.ID)
	list := e.docs(ws)
	name := cats["6640"].Name
	if len(list) != 1 || !slices.Equal(list[0].Folder, []string{"Expenses", "2026", name}) || list[0].Name != "train.pdf" ||
		!slices.Contains(list[0].Tags, "expense") || !slices.Contains(list[0].Tags, toLower(name)) {
		t.Fatalf("documents: %+v", list)
	}
	var linked int
	_ = e.raw.QueryRow(context.Background(), `SELECT count(*) FROM document_links WHERE document_id = $1 AND target_type = 'expense' AND target_id = $2`, list[0].ID, x.ID).Scan(&linked)
	if linked != 1 {
		t.Fatalf("links: %d", linked)
	}

	var other category
	for code, c := range cats {
		// a name with a slash gets a different folder name; this checks the move, not the renaming
		if code != "6640" && !c.IsArchived && !strings.ContainsAny(c.Name, `/\`) {
			other = c
			break
		}
	}
	e.do(b, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"category_id": other.ID, "document_date": "2025-12-30"}, 200, nil)
	list = e.docs(ws)
	if len(list) != 1 || !slices.Equal(list[0].Folder, []string{"Expenses", "2025", other.Name}) ||
		slices.Contains(list[0].Tags, toLower(name)) || !slices.Contains(list[0].Tags, toLower(other.Name)) || !slices.Contains(list[0].Tags, "expense") {
		t.Fatalf("after change: %+v", list)
	}

	// renaming the category renames its folder; a draft without a category files under Uncategorised
	e.do(b, "PATCH", "/api/v1/expense-categories/"+other.ID, map[string]any{"name": "Renamed / Category"}, 200, nil)
	if list = e.docs(ws); !slices.Equal(list[0].Folder, []string{"Expenses", "2025", "Renamed - Category"}) {
		t.Fatalf("after rename: %+v", list)
	}
	e.do(b, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"category_id": nil}, 200, nil)
	if list = e.docs(ws); !slices.Equal(list[0].Folder, []string{"Expenses", "2025", store.UncategorisedFolder}) {
		t.Fatalf("without a category: %+v", list)
	}
}

func TestMovedDocumentStaysWhenCategoryChanges(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cats := e.categories(b)
	x := e.create(b, complete(cats["6640"].ID))
	e.upload(b, x.ID, "train.pdf", pdf)
	ws := wsOf(e, b, x.ID)
	if _, err := e.raw.Exec(context.Background(), `UPDATE documents SET folder_id = NULL WHERE workspace_id = $1`, ws); err != nil {
		t.Fatal(err)
	}
	var other category
	for code, c := range cats {
		// a name with a slash gets a different folder name; this checks the move, not the renaming
		if code != "6640" && !c.IsArchived && !strings.ContainsAny(c.Name, `/\`) {
			other = c
			break
		}
	}
	e.do(b, "PATCH", "/api/v1/expenses/"+x.ID, map[string]any{"category_id": other.ID}, 200, nil)
	if list := e.docs(ws); len(list) != 1 || len(list[0].Folder) != 0 {
		t.Fatalf("moved document was moved back: %+v", list)
	}
}

func TestReceiptCopiesNeverCrossTenants(t *testing.T) {
	e := newEnv(t)
	a, b := e.workspace(), e.workspace()
	xa := e.create(a, complete(e.categories(a)["6640"].ID))
	xb := e.create(b, complete(e.categories(b)["6640"].ID))
	for _, c := range []struct {
		b *browser
		x expense
	}{{a, xa}, {b, xb}} {
		if r := e.upload(c.b, c.x.ID, "same.pdf", pdf); r.StatusCode != 201 {
			t.Fatalf("upload: %d", r.StatusCode)
		}
	}
	for _, x := range []expense{xa, xb} {
		if n := len(e.docs(wsOf(e, nil, x.ID))); n != 1 {
			t.Fatalf("workspace has %d documents, want its own 1", n)
		}
	}
}

func toLower(s string) string { return expenseTags(nil, s)[1] }

// receiptKeys: the stored receipt objects, not the linked copies in Documents.
func (f *fakeStorage) receiptKeys() []string {
	var out []string
	for _, k := range f.keys() {
		if strings.Contains(k, "/expenses/") {
			out = append(out, k)
		}
	}
	return out
}

// seedDocument: a live Document with the bytes of pdf, as another entry point would have stored it.
func (e *env) seedDocument(b *browser, folderID *string) string {
	e.t.Helper()
	sum := fmt.Sprintf("%x", sha256.Sum256(pdf))
	id := "doc_seed" + strings.ToLower(rand.Text())[:8]
	if err := e.st.CreateDocument(context.Background(), b.workspace, b.user, store.Document{ID: id, Name: "existing.pdf", FolderID: folderID,
		Size: int64(len(pdf)), ContentType: "application/pdf", SHA256: &sum, ObjectKey: b.workspace + "/documents/" + id, CreatedAt: time.Now()}); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) docLinks(id string) int {
	var n int
	_ = e.raw.QueryRow(context.Background(), `SELECT count(*) FROM document_links WHERE document_id = $1 AND target_type = 'expense'`, id).Scan(&n)
	return n
}

func TestReceiptReusesExistingDocument(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cats := e.categories(b)
	x := e.create(b, complete(cats["6640"].ID))
	id := e.seedDocument(b, nil)
	if r := e.upload(b, x.ID, "train.pdf", pdf); r.StatusCode != 201 {
		t.Fatalf("upload: %d", r.StatusCode)
	}
	list := e.docs(b.workspace)
	if len(list) != 1 || list[0].ID != id || !slices.Equal(list[0].Folder, []string{"Expenses", "2026", cats["6640"].Name}) || e.docLinks(id) != 1 {
		t.Fatalf("documents: %+v links %d", list, e.docLinks(id))
	}
	if len(e.files.receiptKeys()) != 1 {
		t.Fatalf("the receipt object is the expense's own: %v", e.files.keys())
	}
	// Deleting the receipt keeps the Document and only drops the link.
	var rc struct{ Data []struct{ ID string } }
	e.do(b, "GET", "/api/v1/expenses/"+x.ID+"/receipts", nil, 200, &rc)
	e.do(b, "DELETE", "/api/v1/expenses/"+x.ID+"/receipts/"+rc.Data[0].ID, nil, 204, nil)
	if list := e.docs(b.workspace); len(list) != 1 || list[0].ID != id || e.docLinks(id) != 0 {
		t.Fatalf("after delete: %+v links %d", list, e.docLinks(id))
	}
}

func TestReceiptLeavesPlacedDocumentInPlace(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	x := e.create(b, complete(e.categories(b)["6640"].ID))
	var folder string
	_ = e.st.Tx(context.Background(), func(q store.Q) (err error) {
		folder, err = q.FolderPath(context.Background(), b.workspace, b.user, []string{"Mine"}, time.Now())
		return
	})
	id := e.seedDocument(b, &folder)
	if r := e.upload(b, x.ID, "train.pdf", pdf); r.StatusCode != 201 {
		t.Fatalf("upload: %d", r.StatusCode)
	}
	if list := e.docs(b.workspace); len(list) != 1 || list[0].ID != id || !slices.Equal(list[0].Folder, []string{"Mine"}) || e.docLinks(id) != 1 {
		t.Fatalf("placed document moved: %+v", list)
	}
}

func TestReceiptStillConflictsWithAnotherReceiptWhenDocumentExists(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	cat := e.categories(b)["6640"].ID
	x, y := e.create(b, complete(cat)), e.create(b, complete(cat))
	e.seedDocument(b, nil)
	if r := e.upload(b, x.ID, "a.pdf", pdf); r.StatusCode != 201 {
		t.Fatalf("first: %d", r.StatusCode)
	}
	if r := e.upload(b, y.ID, "b.pdf", pdf); r.StatusCode != 409 {
		t.Fatalf("receipt vs receipt: %d, want 409", r.StatusCode)
	}
}

func TestFullWorkspaceSendsNoReceiptBytesToStorage(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	x := e.create(b, complete(e.categories(b)["6640"].ID))
	e.st.SetAdmission(func(_ context.Context, _ store.Q, _, resource string, _ int64) error {
		if resource == "storage_bytes" {
			return errors.New("storage full")
		}
		return nil
	})
	if r := e.upload(b, x.ID, "train.pdf", pdf); r.StatusCode == 201 {
		t.Fatalf("upload into a full workspace: %d", r.StatusCode)
	}
	if n := len(e.files.keys()); n != 0 {
		t.Fatalf("%d objects written to a full workspace", n)
	}
}
