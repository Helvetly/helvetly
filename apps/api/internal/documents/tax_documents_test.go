package documents

import (
	"context"
	"slices"
	"strconv"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func (e *env) taxFolder(b *browser, year int) string {
	e.t.Helper()
	var id string
	err := e.st.Tx(context.Background(), func(q store.Q) error {
		var err error
		id, err = q.TaxDocumentsFolder(context.Background(), b.workspace, year, b.user, time.Now())
		return err
	})
	if err != nil {
		e.t.Fatal(err)
	}
	return id
}

func TestTaxDocumentsFolder(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	root := folderByKind(t, e.allFolders(b), "tax_documents", store.TaxDocumentsFolderName) // made with the other roots
	year := e.taxFolder(b, 2024)
	if again := e.taxFolder(b, 2024); again != year {
		t.Fatalf("a second Tax Documents/2024: %s, %s", again, year)
	}
	if f := folderByKind(t, e.allFolders(b), "year", "2024"); f.ID != year || *f.ParentID != root.ID {
		t.Fatalf("Tax Documents/2024: %+v", f)
	}
	mine := e.folder(b, "Mine", nil)
	for _, id := range []string{root.ID, year} {
		e.fails(b, "PATCH", "/api/v1/documents/folders/"+id, map[string]any{"name": "Renamed"}, 409, "system_folder")
		e.fails(b, "PATCH", "/api/v1/documents/folders/"+id, map[string]any{"parent_id": mine.ID}, 409, "system_folder")
		if out := e.bulk(b, map[string]any{"action": "trash", "folder_ids": []string{id}}); out.Updated != 0 || len(out.Skipped) != 1 {
			t.Fatalf("trashed %s: %+v", id, out)
		}
	}
	for lang, want := range map[string]string{"de": "Steuerunterlagen", "fr": "Documents fiscaux", "it": "Documenti fiscali", "en": "Tax Documents"} {
		if got := folderByKind(t, e.allFolders(b, "Accept-Language", lang), "tax_documents", "").Name; got != want {
			t.Errorf("%s: %q, want %q", lang, got, want)
		}
	}
	// a file there is a tax document, grouped as one
	d := e.uploaded(b, "veranlagung.pdf", pdf, "folder_id", year)
	if got := e.get(b, d.ID); !slices.Contains(got.Tags, "tax-document") || !slices.Contains(got.Tags, "year-2024") {
		t.Fatalf("tags = %v", got.Tags)
	}
	var out groupsOut
	e.do(b, "GET", "/api/v1/documents/groups?group=type", nil, 200, &out)
	if got := counts(out.Data.Groups); got["tax_documents"] != 1 {
		t.Fatalf("type groups = %+v", out.Data.Groups)
	}
	// nobody types the kind onto a file
	plain := e.uploaded(b, "plain.pdf", pdf+"p")
	e.fails(b, "PATCH", "/api/v1/documents/"+plain.ID, map[string]any{"tags": []string{"tax-document"}}, 422, "validation_failed")
	// isolation: the other workspace has its own root, and not this one's year
	for _, f := range e.allFolders(other) {
		if f.ID == root.ID || f.ID == year {
			t.Fatalf("another workspace sees %+v", f)
		}
	}
}

func TestTaxDocumentsAdoption(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	drop := func(b *browser) {
		t.Helper()
		if _, err := e.raw.Exec(ctx, `DELETE FROM document_folders WHERE workspace_id = $1 AND system_kind IN ('tax_documents', 'year')
			AND (parent_id IS NULL OR parent_id IN (SELECT id FROM document_folders WHERE system_kind = 'tax_documents'))`, b.workspace); err != nil {
			t.Fatal(err)
		}
	}
	backfill := func() {
		t.Helper()
		for range 2 {
			if err := e.svc.BackfillSystemFolders(ctx); err != nil {
				t.Fatal(err)
			}
		}
	}
	// a translated name with files: adopted, the files stay
	named, short, persons, aiMade := e.workspace(), e.workspace(), e.workspace(), e.workspace()
	for _, b := range []*browser{named, short, persons, aiMade} {
		e.allFolders(b)
		drop(b)
	}
	de := e.folder(named, "Steuerunterlagen", nil)
	kept := e.uploaded(named, "2023.pdf", pdf+"1", "folder_id", de.ID)
	empty := e.folder(short, "Steuern", nil)
	mine := e.folder(persons, "Steuern", nil)
	e.uploaded(persons, "mine.pdf", pdf+"2", "folder_id", mine.ID)
	tax := e.folder(aiMade, "Tax", nil)
	filed := e.uploaded(aiMade, "filed.pdf", pdf+"3", "folder_id", tax.ID)
	if _, err := e.raw.Exec(ctx, `INSERT INTO document_filings (document_id, workspace_id, user_id, may_move, status, due_at,
		folder_id, created_folder, created_at) VALUES ($1, $2, $3, true, 'filed', now(), $4, true, now())`,
		filed.ID, aiMade.workspace, aiMade.user, tax.ID); err != nil {
		t.Fatal(err)
	}
	backfill()
	for _, tc := range []struct {
		b      *browser
		folder string
		want   bool
	}{{named, de.ID, true}, {short, empty.ID, true}, {persons, mine.ID, false}, {aiMade, tax.ID, true}} {
		root := folderByKind(t, e.allFolders(tc.b), "tax_documents", "")
		if (root.ID == tc.folder) != tc.want {
			t.Errorf("%s adopted = %v, want %v", tc.folder, root.ID == tc.folder, tc.want)
		}
	}
	if d := e.get(named, kept.ID); d.FolderID == nil || *d.FolderID != de.ID {
		t.Fatalf("the file moved")
	}
	// the person's folder keeps its name, beside the new root
	if f := slices.IndexFunc(e.allFolders(persons), func(f store.Folder) bool { return f.ID == mine.ID && f.Name == "Steuern" && f.SystemKind == nil }); f < 0 {
		t.Fatalf("the person's folder changed")
	}
}

func TestAIFilingTaxDocuments(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	e.approveAI(b)
	e.filer(nil)
	this := strconv.Itoa(time.Now().Year())
	for _, tc := range []struct{ name, body, want, kind string }{
		{"steuererklaerung 2024.pdf", pdf + "1", "Tax Documents/2024", "tax-document"},
		{"tax return acme ag 2023.pdf", pdf + "2", "Tax Documents/2023", "tax-document"}, // never into Clients
		{"Veranlagungsverfuegung.txt", "Kantonales Steueramt\nVeranlagungsverfügung Staats- und Gemeindesteuern 2024",
			"Tax Documents/" + this, "tax-document"},
		{"ahv receipt 2025.pdf", pdf + "3", "Expenses/2025/Uncategorised", "receipt"},
	} {
		up := e.uploaded(b, tc.name, tc.body)
		e.fileDue()
		if got := e.filedPath(b, up.ID); got != tc.want {
			t.Errorf("%s filed in %q, want %q", tc.name, got, tc.want)
		}
		if got := e.get(b, up.ID); !slices.Contains(got.Tags, tc.kind) {
			t.Errorf("%s tags %v, want %s", tc.name, got.Tags, tc.kind)
		}
	}
	// organize proposes it for a file elsewhere
	misc := e.folder(b, "Misc", nil)
	old := e.uploaded(b, "steuererklaerung 2022.pdf", pdf+"o", "folder_id", misc.ID)
	var out one[struct {
		Proposals []proposal `json:"proposals"`
	}]
	e.do(b, "POST", "/api/v1/documents/organize", map[string]any{"folder_id": misc.ID}, 200, &out)
	i := slices.IndexFunc(out.Data.Proposals, func(p proposal) bool { return p.DocumentID == old.ID })
	if i < 0 || out.Data.Proposals[i].Folder != "Tax Documents/2022" || !out.Data.Proposals[i].Change {
		t.Fatalf("proposals = %+v", out.Data.Proposals)
	}
}

func TestTaxDocumentDecision(t *testing.T) {
	for _, tc := range []struct {
		name, file, text, kind string
		links                  []store.DocumentLink
		want                   bool
	}{
		{"the model says so", "scan.pdf", "", "tax-document", nil, true},
		{"a tax return by name", "Steuererklärung 2024.pdf", "", "", nil, true},
		{"a VAT statement by text", "scan.pdf", "ESTV MWST-Abrechnung Q1", "", nil, true},
		{"French", "Déclaration d'impôt 2024.pdf", "", "", nil, true},
		{"Italian", "scan.pdf", "Dichiarazione dei redditi 2024", "", nil, true},
		{"the model names a receipt", "Steuererklärung.pdf", "", "receipt", nil, false},
		{"an expense's receipt", "steuerrechnung.pdf", "", "", []store.DocumentLink{{Type: "expense"}}, false},
		{"nothing says so", "notes.pdf", "Meeting notes", "", nil, false},
	} {
		if got := taxDocument(store.Document{Name: tc.file, Links: tc.links}, tc.text, tc.kind); got != tc.want {
			t.Errorf("%s: %v, want %v", tc.name, got, tc.want)
		}
	}
}
