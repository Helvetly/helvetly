package documents

import (
	"context"
	"slices"
	"sync"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

func (e *env) category(b *browser, name string) string {
	e.t.Helper()
	id := auth.NewID("exc")
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO expense_categories (id, workspace_id, name, account_code, created_at, updated_at)
		VALUES ($1, $2, $3, '6640', now(), now())`, id, b.workspace, name); err != nil {
		e.t.Fatal(err)
	}
	return id
}

// expense: a draft expense of the category ("" for none) dated date ("" for none).
func (e *env) expense(b *browser, category, date string) string {
	e.t.Helper()
	id := auth.NewID("exp")
	if _, err := e.raw.Exec(context.Background(), `INSERT INTO expenses (id, workspace_id, number, status, currency, amount_mode,
			input_tax, deductible_percent, net_total, vat_total, total, deductible_vat, vat_breakdown, exchange_rate, base_currency,
			base_net_total, base_vat_total, base_total, base_deductible_vat, payment_status, category_id, document_date, created_at, updated_at)
		VALUES ($1, $2, (SELECT count(*) + 1 FROM expenses WHERE workspace_id = $2), 'draft', 'CHF', 'gross', 'none', 0, 0, 0, 0, 0,
			'[]', 1000000, 'CHF', 0, 0, 0, 0, 'unpaid', nullif($3, ''), nullif($4, '')::date, '2024-02-01T10:00:00Z', now())`,
		id, b.workspace, category, date); err != nil {
		e.t.Fatal(err)
	}
	return id
}

// path: the "/"-joined folder path of a document, "" at the top level.
func (e *env) path(b *browser, id string) string {
	e.t.Helper()
	d := e.get(b, id)
	if d.FolderID == nil {
		return ""
	}
	folders := e.allFolders(b)
	return folderPath(folders, folders[slices.IndexFunc(folders, func(f store.Folder) bool { return f.ID == *d.FolderID })])
}

// legacyYear: a year folder straight in Expenses, as before Expenses/<category>/<year>.
func (e *env) legacyYear(b *browser, year string) store.Folder {
	e.t.Helper()
	expenses := folderByKind(e.t, e.allFolders(b), "expenses", "")
	f := e.folder(b, year, &expenses.ID)
	if _, err := e.raw.Exec(context.Background(), `UPDATE document_folders SET system_kind = 'year' WHERE id = $1`, f.ID); err != nil {
		e.t.Fatal(err)
	}
	return f
}

func TestBackfillMovesExpenseFilesIntoCategoryFolders(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	travel := e.category(b, "Travel")
	withCategory, without := e.expense(b, travel, "2025-03-01"), e.expense(b, "", "")
	// the earlier layout: Expenses/2025 and Expenses/2025/Travel, with linked files, a loose file and an empty year
	y2025, y2023 := e.legacyYear(b, "2025"), e.legacyYear(b, "2023")
	inCategory := e.folder(b, "Travel", &y2025.ID)
	train := e.uploaded(b, "train.pdf", pdf, "folder_id", inCategory.ID)
	taxi := e.uploaded(b, "taxi.pdf", pdf+"t", "folder_id", y2025.ID)
	notes := e.uploaded(b, "notes.pdf", pdf+"n", "folder_id", y2025.ID)      // linked to nothing: stays
	elsewhere := e.uploaded(b, "hotel.pdf", pdf+"h")                         // the person put it at the top: stays
	theirYear := e.legacyYear(other, "2025")                                 // another workspace's: untouched files there
	theirs := e.uploaded(other, "x.pdf", pdf+"x", "folder_id", theirYear.ID) // nothing linked
	for doc, exp := range map[string]string{train.ID: withCategory, taxi.ID: without, elsewhere.ID: withCategory} {
		e.do(b, "POST", "/api/v1/documents/"+doc+"/links", map[string]any{"type": "expense", "id": exp}, 201, nil)
	}

	for range 2 { // twice: nothing more the second time
		if err := e.svc.BackfillSystemFolders(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	for id, want := range map[string]string{train.ID: "Expenses/Travel/2025", taxi.ID: "Expenses/Uncategorised/2024",
		notes.ID: "Expenses/2025", elsewhere.ID: ""} {
		if got := e.path(b, id); got != want {
			t.Errorf("%s in %q, want %q", e.get(b, id).Name, got, want)
		}
	}
	if got := e.path(other, theirs.ID); got != "Expenses/2025" {
		t.Errorf("other workspace's file in %q", got)
	}
	folders := e.allFolders(b)
	folderByKind(t, folders, "expense_category", "Travel")
	folderByKind(t, folders, "expense_category", store.UncategorisedFolder)
	for _, f := range folders {
		switch f.ID {
		case y2025.ID: // kept for the file left in it, as a plain folder people may rename or delete
			if f.SystemKind != nil {
				t.Errorf("old year folder still a system folder: %+v", f)
			}
			e.do(b, "PATCH", "/api/v1/documents/folders/"+f.ID, map[string]any{"name": "Old 2025"}, 200, nil)
		case y2023.ID, inCategory.ID:
			t.Errorf("empty old folder left: %+v", f)
		}
	}
}

func TestExpenseCategoryFoldersAreSystemFoldersInEveryLanguage(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	travel := e.category(b, "Travel")
	var cat, none string
	err := e.st.Tx(context.Background(), func(q store.Q) (err error) {
		if cat, err = q.ExpenseYearFolder(context.Background(), b.workspace, &travel, 2026, b.user, time.Now()); err != nil {
			return err
		}
		none, err = q.ExpenseYearFolder(context.Background(), b.workspace, nil, 2026, b.user, time.Now())
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	folders := e.allFolders(b)
	travelFolder := folderByKind(t, folders, "expense_category", "Travel")
	for _, id := range []string{travelFolder.ID, cat, none} {
		e.fails(b, "PATCH", "/api/v1/documents/folders/"+id, map[string]any{"name": "Renamed"}, 409, "system_folder")
		if out := e.bulk(b, map[string]any{"action": "trash", "folder_ids": []string{id}}); out.Updated != 0 {
			t.Fatalf("trashed %s: %+v", id, out)
		}
	}
	names := func(lang string) []string {
		var out []string
		for _, f := range e.allFolders(b, "Accept-Language", lang) {
			if f.SystemKind != nil && *f.SystemKind == "expense_category" {
				out = append(out, f.Name)
			}
		}
		slices.Sort(out)
		return out
	}
	for lang, want := range map[string][]string{"en": {"Travel", "Uncategorised"}, "de": {"Ohne Kategorie", "Travel"},
		"fr": {"Sans catégorie", "Travel"}, "it": {"Senza categoria", "Travel"}} {
		if got := names(lang); !slices.Equal(got, want) {
			t.Errorf("%s: %v, want %v", lang, got, want)
		}
	}
}

func TestExpenseYearFolderIsMadeOnceUnderConcurrency(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	travel := e.category(b, "Travel")
	ids := make([]string, 8)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Go(func() {
			err := e.st.Tx(context.Background(), func(q store.Q) (err error) {
				ids[i], err = q.ExpenseYearFolder(context.Background(), b.workspace, &travel, 2026, b.user, time.Now())
				return err
			})
			if err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	for _, id := range ids {
		if id != ids[0] {
			t.Fatalf("made more than once: %v", ids)
		}
	}
	var n int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM document_folders WHERE workspace_id = $1
		AND system_kind = 'expense_category'`, b.workspace).Scan(&n); err != nil || n != 1 {
		t.Fatalf("%d category folders, %v", n, err)
	}
}
