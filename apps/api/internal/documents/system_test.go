package documents

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// folderByKind: the folder of that system kind (and name, when given) among folders.
func folderByKind(t *testing.T, folders []store.Folder, kind, name string) store.Folder {
	t.Helper()
	i := slices.IndexFunc(folders, func(f store.Folder) bool {
		return f.SystemKind != nil && *f.SystemKind == kind && (name == "" || f.Name == name)
	})
	if i < 0 {
		t.Fatalf("no %s folder %q among %+v", kind, name, folders)
	}
	return folders[i]
}

func (e *env) allFolders(b *browser, header ...string) []store.Folder {
	e.t.Helper()
	var all one[[]store.Folder]
	e.do2(b, "/api/v1/documents/folders", &all, header...)
	return all.Data
}

// do2: a GET with extra headers.
func (e *env) do2(b *browser, path string, out any, header ...string) {
	e.t.Helper()
	resp, raw := e.send(b, "GET", path, nil, "", header...)
	if resp.StatusCode != 200 {
		e.t.Fatalf("GET %s = %d %s", path, resp.StatusCode, raw)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		e.t.Fatal(err)
	}
}

// recordFolder files the client's record folder through the store, as issuing does.
func (e *env) recordFolder(b *browser, client, kind string, year int) string {
	e.t.Helper()
	var id string
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		var err error
		id, err = q.ClientRecordFolder(context.Background(), b.workspace, client, kind, year, b.user, time.Now())
		return err
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func TestSystemFoldersCannotBeRenamedMovedOrDeleted(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	acme := e.client(b, "Acme AG")
	year := e.recordFolder(b, acme, "invoices", 2026)
	folders := e.allFolders(b)
	clients, expenses := folderByKind(t, folders, "clients", "Clients"), folderByKind(t, folders, "expenses", "Expenses")
	client, invoices := folderByKind(t, folders, "client", "Acme AG"), folderByKind(t, folders, "invoices", "Invoices")
	if client.ParentID == nil || *client.ParentID != clients.ID || invoices.ParentID == nil || *invoices.ParentID != client.ID {
		t.Fatalf("structure: %+v", folders)
	}
	mine := e.folder(b, "Mine", nil)
	for _, id := range []string{clients.ID, expenses.ID, client.ID, invoices.ID, year} {
		e.fails(b, "PATCH", "/api/v1/documents/folders/"+id, map[string]any{"name": "Renamed"}, 409, "system_folder")
		e.fails(b, "PATCH", "/api/v1/documents/folders/"+id, map[string]any{"parent_id": mine.ID}, 409, "system_folder")
		for _, action := range []string{"trash", "move"} {
			body := map[string]any{"action": action, "folder_ids": []string{id}}
			if action == "move" {
				body["folder_id"] = mine.ID
			}
			if out := e.bulk(b, body); out.Updated != 0 || len(out.Skipped) != 1 || !strings.Contains(out.Skipped[0].Reason, "can't be renamed") {
				t.Fatalf("%s %s: %+v", action, id, out)
			}
		}
	}
	// people still file into them and make their own folders inside
	inner := e.folder(b, "Notes", &clients.ID)
	e.uploaded(b, "a.pdf", pdf, "folder_id", year)
	e.do(b, "PATCH", "/api/v1/documents/folders/"+inner.ID, map[string]any{"name": "Notes 2"}, 200, nil)
	e.bulk(b, map[string]any{"action": "trash", "folder_ids": []string{inner.ID}})
	if got := e.allFolders(b); len(got) != len(folders)+1 { // Mine
		t.Fatalf("folders after trash: %+v", got)
	}
}

func TestSystemFolderNamesFollowTheLanguage(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	acme := e.client(b, "Acme AG")
	year := e.recordFolder(b, acme, "quotes", 2025)
	doc := e.uploaded(b, "q.pdf", pdf, "folder_id", year)
	names := func(header ...string) []string {
		var out []string
		for _, f := range e.allFolders(b, header...) {
			out = append(out, f.Name)
		}
		slices.Sort(out)
		return out
	}
	en := names()
	cases := map[string][]string{
		"de-CH,de;q=0.9": {"2025", "Acme AG", "Ausgaben", "Kunden", "Offerten"},
		"fr":             {"2025", "Acme AG", "Clients", "Devis", "Dépenses"},
		"it-IT":          {"2025", "Acme AG", "Clienti", "Preventivi", "Spese"},
		"pl,en;q=0.5":    {"2025", "Acme AG", "Clients", "Expenses", "Quotes"},
	}
	for lang, want := range cases {
		if got := names("Accept-Language", lang); !slices.Equal(got, want) {
			t.Fatalf("%s: %v, want %v", lang, got, want)
		}
	}
	if got := names(); !slices.Equal(got, en) { // asking in other languages made nothing new
		t.Fatalf("after other languages: %v, was %v", got, en)
	}
	var d one[store.Document]
	e.do2(b, "/api/v1/documents/"+doc.ID+"?lang=de", &d)
	if d.Data.Folder == nil || d.Data.Folder.Name != "2025" {
		t.Fatalf("document folder: %+v", d.Data.Folder)
	}
	var trash one[[]store.TrashItem]
	e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{doc.ID}})
	e.do2(b, "/api/v1/documents/trash", &trash, "Accept-Language", "de")
	if len(trash.Data) != 1 || trash.Data[0].Location == nil || trash.Data[0].Location.Name != "2025" {
		t.Fatalf("trash: %+v", trash.Data)
	}
}

func TestClientRecordFoldersFollowTheClient(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	first, second := e.client(b, "Acme AG"), e.client(b, "Acme AG")
	a := e.recordFolder(b, first, "invoices", 2026)
	if again := e.recordFolder(b, first, "invoices", 2026); again != a {
		t.Fatalf("made twice: %s, %s", a, again)
	}
	e.recordFolder(b, second, "invoices", 2026)
	e.recordFolder(b, first, "documents", 2025)
	folders := e.allFolders(b)
	folderByKind(t, folders, "client", "Acme AG")
	folderByKind(t, folders, "client", "Acme AG (2)")
	if n := len(slices.DeleteFunc(slices.Clone(folders), func(f store.Folder) bool { return f.SystemKind == nil || *f.SystemKind != "clients" })); n != 1 {
		t.Fatalf("%d Clients folders", n)
	}

	// renaming the client renames its folder, among its siblings
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		_, err := q.UpdateClient(context.Background(), b.workspace, second, map[string]any{"name": "Beta / GmbH"}, time.Now())
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	folderByKind(t, e.allFolders(b), "client", "Beta - GmbH")

	// another workspace has its own system folders and cannot reach these
	theirs := e.allFolders(other)
	if len(theirs) != 2 {
		t.Fatalf("other workspace: %+v", theirs)
	}
	e.fails(other, "PATCH", "/api/v1/documents/folders/"+a, map[string]any{"name": "x"}, 404, "not_found")
	if out := e.bulk(other, map[string]any{"action": "trash", "folder_ids": []string{a}}); out.Updated != 0 {
		t.Fatalf("other trashed: %+v", out)
	}
}

func TestClientUploadsFileIntoTheClientsDocuments(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	acme := e.client(b, "Acme AG")
	var id string
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		f := store.ClientFile{ID: auth.NewID("doc"), Name: "brief.pdf", Size: 3, ContentType: "application/pdf",
			ObjectKey: "k/brief.pdf", CreatedAt: time.Date(2024, 5, 1, 9, 0, 0, 0, time.UTC)}
		id = f.ID
		return q.CreateClientFile(context.Background(), b.workspace, acme, b.user, &f)
	})
	if err != nil {
		t.Fatal(err)
	}
	d := e.get(b, id)
	folders := e.allFolders(b)
	year := folderByKind(t, folders, "year", "2024")
	docs := folderByKind(t, folders, "documents", "Documents")
	if d.FolderID == nil || *d.FolderID != year.ID || *year.ParentID != docs.ID {
		t.Fatalf("filed in %+v; folders %+v", d.Folder, folders)
	}
}

func TestBackfillSystemFolders(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	ctx := context.Background()
	acme := e.client(b, "Acme AG")
	theirs := e.client(other, "Zeta AG")
	// before the system folders: an issued invoice's PDF, a draft without one, and a client file loose in Clients
	issue := func(ws, client, number, key string) string {
		id := auth.NewID("inv")
		if _, err := e.raw.Exec(ctx, `INSERT INTO invoices (id, workspace_id, kind, status, number, client_id, issue_date, due_date,
				currency, language, vat_mode, discount_percent, subtotal, discount_amount, net_total, vat_total, total, rounding_amount,
				vat_breakdown, pdf_key, created_at, updated_at)
			VALUES ($1, $2, 'invoice', 'open', $3, $4, '2025-03-01', '2025-03-31', 'CHF', 'de', 'none', 0, 0, 0, 0, 0, 0, 0,
				'[]', $5, now(), now())`, id, ws, number, client, key); err != nil {
			t.Fatal(err)
		}
		return id
	}
	inv := issue(b.workspace, acme, "RE-1", "workspaces/a/invoices/RE-1.pdf")
	issue(other.workspace, theirs, "RE-1", "workspaces/b/invoices/RE-1.pdf")
	loose := e.uploaded(b, "brief.pdf", pdf)
	clients := folderByKind(t, e.allFolders(b), "clients", "")
	e.bulk(b, map[string]any{"action": "move", "document_ids": []string{loose.ID}, "folder_id": clients.ID})
	e.do(b, "POST", "/api/v1/documents/"+loose.ID+"/links", map[string]any{"type": "client", "id": acme}, 201, nil)
	if _, err := e.raw.Exec(ctx, `DELETE FROM document_folders WHERE workspace_id = $1 AND system_kind = 'expenses'`, b.workspace); err != nil {
		t.Fatal(err)
	}

	for range 2 { // twice: nothing more the second time
		if err := e.svc.BackfillSystemFolders(ctx); err != nil {
			t.Fatal(err)
		}
	}
	folders := e.allFolders(b)
	folderByKind(t, folders, "expenses", "Expenses")
	invYear := folderByKind(t, folders, "year", "2025")
	inFolder := e.list(b, "folder_id="+invYear.ID).Data
	if len(inFolder) != 1 || inFolder[0].Name != "Invoice-RE-1.pdf" || len(inFolder[0].Links) != 1 ||
		inFolder[0].Links[0].ID != inv || !inFolder[0].Links[0].Retains {
		t.Fatalf("invoice PDF: %+v", inFolder)
	}
	// it shares the invoice's object, so it is kept as long as the invoice
	if out := e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{inFolder[0].ID}}); out.Updated != 0 {
		t.Fatalf("trashed the invoice's PDF: %+v", out)
	}
	moved := e.get(b, loose.ID)
	if moved.Folder == nil || moved.Folder.SystemKind == nil || *moved.Folder.SystemKind != "year" {
		t.Fatalf("loose client file: %+v", moved.Folder)
	}
	var n int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM documents WHERE object_key LIKE 'workspaces/%/invoices/%'`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("invoice documents = %d, %v", n, err)
	}
	var ws string
	if err := e.raw.QueryRow(ctx, `SELECT workspace_id FROM documents WHERE object_key = 'workspaces/b/invoices/RE-1.pdf'`).Scan(&ws); err != nil || ws != other.workspace {
		t.Fatalf("other workspace's invoice filed in %s, %v", ws, err)
	}
}

func TestAIFilingUsesTheSystemFolders(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.approveAI(b)
	e.filer(nil)
	e.client(b, "Acme AG")
	invoice := e.uploaded(b, "acme ag invoice 2024.pdf", pdf)
	receipt := e.uploaded(b, "taxi receipt 2023.pdf", pdf+"r")
	unknown := e.uploaded(b, "zeta corp invoice 2024.pdf", pdf+"z")
	e.fileDue()
	folders := e.allFolders(b)
	path := func(id *string) string {
		if id == nil {
			return ""
		}
		i := slices.IndexFunc(folders, func(f store.Folder) bool { return f.ID == *id })
		return folderPath(folders, folders[i])
	}
	if got := path(e.get(b, invoice.ID).FolderID); got != "Clients/Acme AG/Invoices/2024" {
		t.Fatalf("invoice filed in %q", got)
	}
	if got := path(e.get(b, receipt.ID).FolderID); got != "Expenses/2023/Uncategorised" {
		t.Fatalf("receipt filed in %q", got)
	}
	if got := e.get(b, unknown.ID); got.FolderID != nil && strings.HasPrefix(path(got.FolderID), "Clients") {
		t.Fatalf("an unknown client's invoice went to %q", path(got.FolderID))
	}
	for _, f := range folders {
		if strings.HasPrefix(folderPath(folders, f), "Clients/") && f.SystemKind == nil {
			t.Fatalf("filing made a plain folder in Clients: %+v", f)
		}
	}
	// undo puts it back and keeps the system folders
	e.do(b, "DELETE", "/api/v1/documents/"+invoice.ID+"/filing", nil, 200, nil)
	if d := e.get(b, invoice.ID); d.FolderID != nil {
		t.Fatalf("after undo: %+v", d.Folder)
	}
	if after := e.allFolders(b); len(after) != len(folders) {
		t.Fatalf("undo removed system folders: %d of %d", len(after), len(folders))
	}
}

func TestRecordPath(t *testing.T) {
	travel := "exc_travel"
	names := recordNames{clients: []store.ClientName{{ID: "c1", Name: "Acme  AG"}, {ID: "c2", Name: "Twin"}, {ID: "c3", Name: "twin"}},
		categories: []store.CategoryName{{ID: travel, Name: "Travel"}}}
	cases := []struct {
		path   string
		system bool
		want   *recordPlace
	}{
		{"Contracts/2025", false, nil},
		{"Clients/Acme AG/Invoices/2025", true, &recordPlace{clientID: "c1", kind: "invoices", year: 2025}},
		{"clients/acme ag/quotes/2024", true, &recordPlace{clientID: "c1", kind: "quotes", year: 2024}},
		{"Clients/Acme AG/Contracts/2025", true, nil},
		{"Clients/Acme AG/Invoices", true, nil},
		{"Clients/Acme AG/Invoices/25", true, nil},
		{"Clients/Nobody/Invoices/2025", true, nil},
		{"Clients/Twin/Invoices/2025", true, nil}, // two clients by that name
		{"Expenses/2024/travel", true, &recordPlace{kind: "expenses", year: 2024, categoryID: &travel}},
		{"Expenses/2024/Uncategorised", true, &recordPlace{kind: "expenses", year: 2024}},
		{"Expenses/Travel/2024", true, nil}, // the earlier layout
		{"Expenses/2024/Made Up", true, nil},
		{"Expenses/2024", true, nil},
		{"Expenses/Travel", true, nil},
		{"Expenses", true, nil},
	}
	for _, tc := range cases {
		path, _ := splitPath(tc.path, organizeApplyDepth)
		got, system := recordPath(path, names)
		if system != tc.system || (got == nil) != (tc.want == nil) ||
			got != nil && (got.clientID != tc.want.clientID || got.kind != tc.want.kind || got.year != tc.want.year ||
				(got.categoryID == nil) != (tc.want.categoryID == nil) || got.categoryID != nil && *got.categoryID != *tc.want.categoryID) {
			t.Errorf("%s: %+v %v, want %+v %v", tc.path, got, system, tc.want, tc.system)
		}
	}
}

func TestLanguage(t *testing.T) {
	for header, want := range map[string]string{"": "en", "de-CH": "de", "pl, it;q=0.8": "it", "FR-ch": "fr", "es": "en"} {
		r := httptest.NewRequest("GET", "/", nil)
		r.Header.Set("Accept-Language", header)
		if got := language(r); got != want {
			t.Errorf("%q: %s, want %s", header, got, want)
		}
	}
	kind := "invoices"
	if got := folderName("de", &kind, "Invoices"); got != "Rechnungen" {
		t.Errorf("de invoices = %s", got)
	}
	year := "year"
	if got := folderName("de", &year, "2025"); got != "2025" {
		t.Errorf("year translated: %s", got)
	}
}

func TestOrganizeApplyFilesIntoTheSystemFolders(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.client(b, "Acme AG")
	e.category(b, "Travel")
	a := e.uploaded(b, "a.txt", "a")
	r := e.uploaded(b, "r.txt", "r")
	x := e.uploaded(b, "x.txt", "x")
	var out applyAnswer
	e.do(b, "POST", "/api/v1/documents/organize/apply", map[string]any{"items": []map[string]any{
		{"document_id": a.ID, "folder": "Clients/acme ag/invoices/2024", "tags": []string{}},
		{"document_id": r.ID, "folder": "Expenses/2023/travel", "tags": []string{}},
		{"document_id": x.ID, "folder": "Clients/Made Up", "tags": []string{}}, // not their structure: stays
	}}, 200, &out)
	folders := e.allFolders(b)
	path := func(d store.Document) string {
		if d.FolderID == nil {
			return ""
		}
		i := slices.IndexFunc(folders, func(f store.Folder) bool { return f.ID == *d.FolderID })
		return folderPath(folders, folders[i])
	}
	if got := path(e.get(b, a.ID)); got != "Clients/Acme AG/Invoices/2024" {
		t.Fatalf("a in %q", got)
	}
	if got := path(e.get(b, r.ID)); got != "Expenses/2023/Travel" {
		t.Fatalf("r in %q", got)
	}
	if got := e.get(b, x.ID); got.FolderID != nil {
		t.Fatalf("x moved to %q", path(got))
	}
	folderByKind(t, folders, "expense_category", "Travel")
	folderByKind(t, folders, "year", "2023")
	// undo deletes only the plain folders the run made
	e.do(b, "POST", "/api/v1/documents/organize/undo", out.Data.Undo, 200, nil)
	for _, f := range e.allFolders(b) {
		if f.SystemKind == nil {
			t.Fatalf("left a plain folder: %+v", f)
		}
	}
}
