package documents

import (
	"context"
	"slices"
	"strconv"
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

// systemize makes a plain folder a system folder of kind (ref "" for none), as the earlier layout had it.
func (e *env) systemize(f store.Folder, kind, ref string) store.Folder {
	e.t.Helper()
	if _, err := e.raw.Exec(context.Background(), `UPDATE document_folders SET system_kind = $2, system_ref = nullif($3, '')
		WHERE id = $1`, f.ID, kind, ref); err != nil {
		e.t.Fatal(err)
	}
	return f
}

// oldLayout: Expenses/<category>/<year> as before year first, for the category ("" for Uncategorised).
func (e *env) oldLayout(b *browser, category, name string, years ...string) (store.Folder, []store.Folder) {
	e.t.Helper()
	expenses := folderByKind(e.t, e.allFolders(b), "expenses", "")
	c := e.systemize(e.folder(b, name, &expenses.ID), "expense_category", category)
	var out []store.Folder
	for _, y := range years {
		out = append(out, e.systemize(e.folder(b, y, &c.ID), "year", ""))
	}
	return c, out
}

func TestBackfillTurnsExpenseFoldersYearFirst(t *testing.T) {
	e := newEnv(t)
	b, other := e.workspace(), e.workspace()
	travel, theirTravel := e.category(b, "Travel"), e.category(other, "Travel")
	now := strconv.Itoa(time.Now().Year())
	oldTravel, travelYears := e.oldLayout(b, travel, "Travel", "2025", "2024")
	oldNone, noneYears := e.oldLayout(b, "", store.UncategorisedFolder, "2024")
	train := e.uploaded(b, "train.pdf", pdf, "folder_id", travelYears[0].ID)
	scans := e.folder(b, "Scans", &travelYears[0].ID) // a person's folder inside: moves with its files
	scan := e.uploaded(b, "scan.pdf", pdf+"s", "folder_id", scans.ID)
	gone := e.uploaded(b, "gone.pdf", pdf+"g", "folder_id", travelYears[0].ID) // trashed: moves along, still trashed
	e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{gone.ID}})
	taxi := e.uploaded(b, "taxi.pdf", pdf+"t", "folder_id", noneYears[0].ID)
	loose := e.uploaded(b, "loose.pdf", pdf+"l", "folder_id", oldTravel.ID) // straight in the category: the year it was made
	// made on demand in the new layout before the backfill ran: the two merge, a taken name gets a free one
	var already string
	if err := e.st.Tx(context.Background(), func(q store.Q) (err error) {
		already, err = q.ExpenseYearFolder(context.Background(), b.workspace, &travel, 2025, b.user, time.Now())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	newer := e.uploaded(b, "train.pdf", pdf+"n", "folder_id", already)
	_, theirYears := e.oldLayout(other, theirTravel, "Travel", "2025")
	theirs := e.uploaded(other, "x.pdf", pdf+"x", "folder_id", theirYears[0].ID)

	for range 2 { // twice: nothing more the second time
		if err := e.svc.BackfillSystemFolders(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		b    *browser
		doc  store.Document
		want string
	}{
		{b, train, "Expenses/2025/Travel"},
		{b, newer, "Expenses/2025/Travel"},
		{b, scan, "Expenses/2025/Travel/Scans"},
		{b, taxi, "Expenses/2024/Uncategorised"},
		{b, loose, "Expenses/" + now + "/Travel"},
		{other, theirs, "Expenses/2025/Travel"},
	} {
		if got := e.path(tc.b, tc.doc.ID); got != tc.want {
			t.Errorf("%s in %q, want %q", tc.doc.Name, got, tc.want)
		}
	}
	if a, b := e.get(b, train.ID).Name, e.get(b, newer.ID).Name; a == b {
		t.Errorf("two files called %q in one folder", a)
	}
	var folder *string
	var trashed bool
	if err := e.raw.QueryRow(context.Background(), `SELECT folder_id, deleted_at IS NOT NULL FROM documents WHERE id = $1`,
		gone.ID).Scan(&folder, &trashed); err != nil || folder == nil || *folder != already || !trashed {
		t.Errorf("trashed file: folder %v trashed %v, %v", folder, trashed, err)
	}
	var left int
	if err := e.raw.QueryRow(context.Background(), `SELECT count(*) FROM document_folders WHERE id = ANY($1)`,
		[]string{oldTravel.ID, oldNone.ID, travelYears[0].ID, travelYears[1].ID, noneYears[0].ID}).Scan(&left); err != nil || left != 0 {
		t.Errorf("%d old folders left, %v", left, err)
	}
	folders := e.allFolders(b) // the empty old 2024 Travel folder made no new one
	for _, f := range folders {
		if f.SystemKind != nil && *f.SystemKind == "expense_category" && f.Name == "Travel" &&
			folderPath(folders, f) != "Expenses/2025/Travel" && folderPath(folders, f) != "Expenses/"+now+"/Travel" {
			t.Errorf("category folder at %q", folderPath(folders, f))
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
