package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// System folders (migrations 00040, 00044, 00082): Clients/<client>/<record type>/<year> (with
// Documents/<year>/Contracts and Documents/<year>/Bank Statements), Expenses/<year>/<category> and Tax
// Documents/<year>. The
// app makes them on demand and nobody renames, moves or deletes them; the stored name of a typed one is English, shown
// translated.

// RecordFolders: the record types that belong to a client, by system_kind, with their stored (English) names.
var RecordFolders = map[string]string{"invoices": "Invoices", "quotes": "Quotes", "engagements": "Engagements",
	"signatures": "Signatures", "documents": "Documents"}

// SystemRoots: the top-level system folders, by system_kind.
var SystemRoots = map[string]string{"clients": "Clients", "expenses": "Expenses", "tax_documents": TaxDocumentsFolderName}

// BankStatementsFolderName: the stored name of a client's Documents/<year>/Bank Statements (and of the top-level folder
// of migration 00079, which RepairBankStatementsRoot takes apart).
const BankStatementsFolderName = "Bank Statements"

// TaxDocumentsFolderName: the stored name of the top-level folder of tax documents.
const TaxDocumentsFolderName = "Tax Documents"

// SystemRootKinds: the top-level system folders' kinds, in the order they are made.
var SystemRootKinds = []string{"clients", "expenses", "tax_documents"}

// adoptedNames: the names of a system folder in the app's languages (lower case), by kind; a plain sibling by one of
// them becomes it (renamed to its stored English name).
var adoptedNames = map[string][]string{
	"client_bank_statements": {"bank statements", "kontoauszüge", "relevés bancaires", "estratti conto"},
	"tax_documents":          {"tax documents", "steuerunterlagen", "documents fiscaux", "documenti fiscali"},
}

// taxFolderNames: short names of a tax folder (lower case); a plain top-level one becomes Tax Documents only when it
// is empty or AI filing made it, never a person's folder with files.
var taxFolderNames = []string{"tax", "taxes", "steuern", "impôts", "impots", "tasse"}

// UncategorisedFolder: the stored name of the folder in Expenses for expenses without a category.
const UncategorisedFolder = "Uncategorised"

const maxSystemFolderRunes = 60

// systemFolder: the live system folder of kind (and ref, the client of a client folder or the category of an expense
// category folder, "" for Uncategorised; the name of a year) in parent,
// made when missing. A plain folder already there by that name becomes it; a name another system folder holds gets a
// free one ("Acme (2)" for a second client called Acme). Run it in a transaction.
func (q Q) systemFolder(ctx context.Context, workspaceID string, parent *string, kind, ref, name, userID string, now time.Time) (string, error) {
	if err := q.LockContainer(ctx, workspaceID, parent); err != nil {
		return "", err
	}
	var id string
	err := q.db.QueryRow(ctx, `SELECT id FROM document_folders WHERE workspace_id = $1 AND parent_id IS NOT DISTINCT FROM $2
		AND system_kind = $3 AND deleted_at IS NULL AND CASE $3 WHEN 'client' THEN system_ref = $4
			WHEN 'expense_category' THEN system_ref IS NOT DISTINCT FROM nullif($4, '') WHEN 'year' THEN name = $5 ELSE true END
		ORDER BY created_at, id LIMIT 1`, workspaceID, parent, kind, ref, name).Scan(&id)
	if err == nil || !errors.Is(err, ErrNotFound) {
		return id, err
	}
	var system bool
	err = q.db.QueryRow(ctx, `SELECT id, system_kind IS NOT NULL FROM document_folders WHERE workspace_id = $1
		AND parent_id IS NOT DISTINCT FROM $2 AND lower(name) = lower($3) AND deleted_at IS NULL LIMIT 1`,
		workspaceID, parent, name).Scan(&id, &system)
	switch {
	case err == nil && !system:
		_, err = q.db.Exec(ctx, `UPDATE document_folders SET system_kind = $2, system_ref = nullif($3, ''), updated_at = $4
			WHERE id = $1`, id, kind, ref, now)
		return id, err
	case err == nil:
		if name, err = q.FreeFolderName(ctx, workspaceID, parent, name); err != nil {
			return "", err
		}
	case !errors.Is(err, ErrNotFound):
		return "", err
	}
	id = "fld_" + strings.ToLower(rand.Text())
	_, err = q.db.Exec(ctx, `INSERT INTO document_folders (id, workspace_id, parent_id, name, created_by, created_at, updated_at,
			system_kind, system_ref)
		VALUES ($1, $2, $3, $4, nullif($5, ''), $6, $6, $7, nullif($8, ''))`, id, workspaceID, parent, name, userID, now, kind, ref)
	return id, err
}

// ClientsFolder: the top-level system folder Clients, made when missing.
func (q Q) ClientsFolder(ctx context.Context, workspaceID, userID string, now time.Time) (string, error) {
	return q.systemFolder(ctx, workspaceID, nil, "clients", "", SystemRoots["clients"], userID, now)
}

// EnsureSystemRoots makes the top-level system folders a workspace is missing.
func (q Q) EnsureSystemRoots(ctx context.Context, workspaceID string, now time.Time) error {
	for _, kind := range SystemRootKinds {
		if _, err := q.rootFolder(ctx, workspaceID, kind, "", now); err != nil {
			return err
		}
	}
	return nil
}

// rootFolder: the top-level system folder of kind, made when missing (adopting a plain folder named in another of the
// app's languages).
func (q Q) rootFolder(ctx context.Context, workspaceID, kind, userID string, now time.Time) (string, error) {
	if err := q.adopt(ctx, workspaceID, nil, kind, SystemRoots[kind], now); err != nil {
		return "", err
	}
	return q.systemFolder(ctx, workspaceID, nil, kind, "", SystemRoots[kind], userID, now)
}

// adopt turns the oldest plain folder in parent named like kind in one of the app's languages (adoptedNames; for
// Tax Documents also a short tax name when the folder is empty or AI filing made it) into that system folder, renamed
// to name; nothing when parent already has it or a folder called name. Run it in a transaction.
func (q Q) adopt(ctx context.Context, workspaceID string, parent *string, kind, name string, now time.Time) error {
	names, ok := adoptedNames[kind]
	if !ok {
		return nil
	}
	short := []string{}
	if kind == "tax_documents" {
		short = taxFolderNames
	}
	if err := q.LockContainer(ctx, workspaceID, parent); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, `UPDATE document_folders SET system_kind = $3, name = $4, updated_at = $5
		WHERE id = (SELECT f.id FROM document_folders f WHERE f.workspace_id = $1 AND f.parent_id IS NOT DISTINCT FROM $2
			AND f.deleted_at IS NULL AND f.system_kind IS NULL
			AND (lower(f.name) = ANY($6) OR lower(f.name) = ANY($7) AND (
				EXISTS (SELECT 1 FROM document_filings ff WHERE ff.folder_id = f.id AND ff.created_folder)
				OR NOT EXISTS (SELECT 1 FROM documents d WHERE d.workspace_id = $1 AND d.folder_id = f.id)
					AND NOT EXISTS (SELECT 1 FROM document_folders c WHERE c.workspace_id = $1 AND c.parent_id = f.id)))
			AND NOT EXISTS (SELECT 1 FROM document_folders b WHERE b.workspace_id = $1 AND b.parent_id IS NOT DISTINCT FROM $2
				AND b.deleted_at IS NULL AND (b.system_kind = $3 OR lower(b.name) = lower($4)))
			ORDER BY lower(f.name) = ANY($6) DESC, f.created_at, f.id LIMIT 1)`,
		workspaceID, parent, kind, name, now, names, short)
	return err
}

// TaxDocumentsFolder: Tax Documents/<year>, made where missing. Run it in a transaction.
func (q Q) TaxDocumentsFolder(ctx context.Context, workspaceID string, year int, userID string, now time.Time) (string, error) {
	root, err := q.rootFolder(ctx, workspaceID, "tax_documents", userID, now)
	if err != nil {
		return "", err
	}
	return q.systemFolder(ctx, workspaceID, &root, "year", "", strconv.Itoa(year), userID, now)
}

// ClientBankStatementsFolder: Clients/<client>/Documents/<year>/Bank Statements, made where missing (adopting a
// plain sibling named in another of the app's languages). Run it in a transaction.
func (q Q) ClientBankStatementsFolder(ctx context.Context, workspaceID, clientID string, year int, userID string, now time.Time) (string, error) {
	yearFolder, err := q.ClientRecordFolder(ctx, workspaceID, clientID, "documents", year, userID, now)
	if err != nil {
		return "", err
	}
	if err := q.adopt(ctx, workspaceID, &yearFolder, "client_bank_statements", BankStatementsFolderName, now); err != nil {
		return "", err
	}
	return q.systemFolder(ctx, workspaceID, &yearFolder, "client_bank_statements", "", BankStatementsFolderName, userID, now)
}

// clientFolderName: the client's name as a folder name (no slashes, at most 60 characters).
func clientFolderName(name string) string { return recordFolderName(name, "Client") }

// recordFolderName: a record's name as a folder name (no slashes, at most 60 characters), fallback when none is left.
func recordFolderName(name, fallback string) string {
	name = strings.Join(strings.Fields(strings.NewReplacer("/", "-", `\`, "-").Replace(name)), " ")
	if name == "" || name == "." || name == ".." {
		return fallback
	}
	for utf8.RuneCountInString(name) > maxSystemFolderRunes {
		name = name[:len(name)-1]
	}
	return strings.TrimSpace(strings.ToValidUTF8(name, ""))
}

// ClientRecordFolder: Clients/<client>/<record type>/<year>, made where missing. kind is a key of RecordFolders.
func (q Q) ClientRecordFolder(ctx context.Context, workspaceID, clientID, kind string, year int, userID string, now time.Time) (string, error) {
	typeName, ok := RecordFolders[kind]
	if !ok {
		return "", errors.New("client record folder: unknown kind " + strconv.Quote(kind))
	}
	var clientName string
	if err := q.db.QueryRow(ctx, `SELECT name FROM clients WHERE workspace_id = $1 AND id = $2`, workspaceID, clientID).
		Scan(&clientName); err != nil {
		return "", err
	}
	root, err := q.ClientsFolder(ctx, workspaceID, userID, now)
	if err != nil {
		return "", err
	}
	client, err := q.systemFolder(ctx, workspaceID, &root, "client", clientID, clientFolderName(clientName), userID, now)
	if err != nil {
		return "", err
	}
	typed, err := q.systemFolder(ctx, workspaceID, &client, kind, "", typeName, userID, now)
	if err != nil {
		return "", err
	}
	return q.systemFolder(ctx, workspaceID, &typed, "year", "", strconv.Itoa(year), userID, now)
}

// RenameClientFolder gives the client's system folder the client's new name (a free one among its siblings).
func (q Q) RenameClientFolder(ctx context.Context, workspaceID, clientID, name string, now time.Time) error {
	return q.renameRecordFolder(ctx, workspaceID, "client", clientID, clientFolderName(name), now)
}

// RenameCategoryFolder gives the expense category's system folder the category's new name.
func (q Q) RenameCategoryFolder(ctx context.Context, workspaceID, categoryID, name string, now time.Time) error {
	return q.renameRecordFolder(ctx, workspaceID, "expense_category", categoryID, recordFolderName(name, "Category"), now)
}

// renameRecordFolder: each system folder of kind and ref (a client has one, a category one per year) takes name, or a
// free one among its siblings.
func (q Q) renameRecordFolder(ctx context.Context, workspaceID, kind, ref, name string, now time.Time) error {
	rows, err := q.db.Query(ctx, `SELECT id, parent_id FROM document_folders WHERE workspace_id = $1 AND system_kind = $2
		AND system_ref = $3 AND deleted_at IS NULL ORDER BY created_at, id`, workspaceID, kind, ref)
	if err != nil {
		return err
	}
	type folder struct {
		id     string
		parent *string
	}
	var found []folder
	for rows.Next() {
		var f folder
		if err := rows.Scan(&f.id, &f.parent); err != nil {
			rows.Close()
			return err
		}
		found = append(found, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, f := range found {
		if err := q.renameFolder(ctx, workspaceID, f.id, f.parent, name, now); err != nil {
			return err
		}
	}
	return nil
}

// renameFolder: the folder takes name, or a free one among its siblings.
func (q Q) renameFolder(ctx context.Context, workspaceID, id string, parent *string, name string, now time.Time) error {
	if err := q.LockContainer(ctx, workspaceID, parent); err != nil {
		return err
	}
	rows, err := q.db.Query(ctx, `SELECT lower(name) FROM document_folders WHERE workspace_id = $1
		AND parent_id IS NOT DISTINCT FROM $2 AND id <> $3 AND deleted_at IS NULL`, workspaceID, parent, id)
	if err != nil {
		return err
	}
	names, err := collect(rows)
	if err != nil {
		return err
	}
	name = FreeName(name, false, func(n string) bool {
		for _, t := range names {
			if t == strings.ToLower(n) {
				return true
			}
		}
		return false
	})
	_, err = q.db.Exec(ctx, `UPDATE document_folders SET name = $2, updated_at = $3 WHERE id = $1 AND name <> $2`, id, name, now)
	return err
}

// FileClientRecord stores d (a generated file of the client's record) in Clients/<client>/<kind>/<year> under a free
// name, linked to targetType/targetID when given. Run it in a transaction.
func (q Q) FileClientRecord(ctx context.Context, workspaceID, clientID, kind string, year int, userID string, d Document, targetType, targetID string) error {
	folder, err := q.ClientRecordFolder(ctx, workspaceID, clientID, kind, year, userID, d.CreatedAt)
	if err != nil {
		return err
	}
	if err := q.LockContainer(ctx, workspaceID, &folder); err != nil {
		return err
	}
	if d.Name, err = q.FreeFileName(ctx, workspaceID, &folder, d.Name); err != nil {
		return err
	}
	d.FolderID = &folder
	if err := q.CreateDocument(ctx, workspaceID, userID, d); err != nil {
		return err
	}
	if targetType == "" {
		return nil
	}
	return q.AddDocumentLink(ctx, workspaceID, d.ID, targetType, targetID, userID, d.CreatedAt)
}

// ExpenseYearFolder: Expenses/<year>/<category>, made where missing; categoryID nil for Uncategorised. Run it in a
// transaction.
func (q Q) ExpenseYearFolder(ctx context.Context, workspaceID string, categoryID *string, year int, userID string, now time.Time) (string, error) {
	ref, name := "", UncategorisedFolder
	if categoryID != nil {
		if err := q.db.QueryRow(ctx, `SELECT name FROM expense_categories WHERE workspace_id = $1 AND id = $2`,
			workspaceID, *categoryID).Scan(&name); err != nil {
			return "", err
		}
		ref, name = *categoryID, recordFolderName(name, "Category")
	}
	return q.expenseFolder(ctx, workspaceID, ref, name, year, userID, now)
}

// expenseFolder: Expenses/<year>/<name>, the folder of category ref ("" for Uncategorised), made where missing.
func (q Q) expenseFolder(ctx context.Context, workspaceID, ref, name string, year int, userID string, now time.Time) (string, error) {
	root, err := q.systemFolder(ctx, workspaceID, nil, "expenses", "", SystemRoots["expenses"], userID, now)
	if err != nil {
		return "", err
	}
	yearFolder, err := q.systemFolder(ctx, workspaceID, &root, "year", "", strconv.Itoa(year), userID, now)
	if err != nil {
		return "", err
	}
	return q.systemFolder(ctx, workspaceID, &yearFolder, "expense_category", ref, name, userID, now)
}

// ExistingExpenseYearFolder: like ExpenseYearFolder but makes nothing; "" when it is missing.
func (q Q) ExistingExpenseYearFolder(ctx context.Context, workspaceID string, categoryID *string, year int) (string, error) {
	var id string
	err := q.db.QueryRow(ctx, `SELECT c.id FROM document_folders c
		JOIN document_folders y ON y.id = c.parent_id AND y.system_kind = 'year' AND y.name = $3 AND y.deleted_at IS NULL
		JOIN document_folders r ON r.id = y.parent_id AND r.system_kind = 'expenses' AND r.parent_id IS NULL AND r.deleted_at IS NULL
		WHERE c.workspace_id = $1 AND c.system_kind = 'expense_category' AND c.system_ref IS NOT DISTINCT FROM $2
			AND c.deleted_at IS NULL
		ORDER BY c.created_at, c.id LIMIT 1`, workspaceID, categoryID, strconv.Itoa(year)).Scan(&id)
	if errors.Is(err, ErrNotFound) {
		return "", nil
	}
	return id, err
}

// ExpenseYear: the year of an expense's folder, from its document date (YYYY-MM-DD) or today.
func ExpenseYear(documentDate *string, today string) int {
	day := today
	if documentDate != nil && len(*documentDate) >= 4 {
		day = *documentDate
	}
	y, _ := strconv.Atoi(day[:4])
	return y
}

// OldExpenseFolder: a category folder of the earlier layout Expenses/<category>/<year>.
type OldExpenseFolder struct{ WorkspaceID, ID string }

// OldExpenseFolders: up to limit live category folders straight in Expenses (the layout before year first).
func (q Q) OldExpenseFolders(ctx context.Context, limit int) ([]OldExpenseFolder, error) {
	rows, err := q.db.Query(ctx, `SELECT c.workspace_id, c.id FROM document_folders c
		JOIN document_folders r ON r.id = c.parent_id AND r.system_kind = 'expenses' AND r.parent_id IS NULL
		WHERE c.system_kind = 'expense_category' AND c.deleted_at IS NULL ORDER BY c.workspace_id, c.id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OldExpenseFolder
	for rows.Next() {
		var f OldExpenseFolder
		if err := rows.Scan(&f.WorkspaceID, &f.ID); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ConvertOldExpenseFolder moves what an old Expenses/<category> folder holds into Expenses/<year>/<category>: each
// year folder's files and folders (live and trashed) into that year's, anything else straight in it into the year it
// was made in (the workspace's time zone); then the emptied old folders are deleted. Nothing when the folder is no
// longer an old one. Run it in a transaction.
func (q Q) ConvertOldExpenseFolder(ctx context.Context, workspaceID, folderID string, now time.Time) error {
	var ref, name string
	err := q.db.QueryRow(ctx, `SELECT coalesce(c.system_ref, ''), c.name FROM document_folders c
		JOIN document_folders r ON r.id = c.parent_id AND r.system_kind = 'expenses' AND r.parent_id IS NULL
		WHERE c.workspace_id = $1 AND c.id = $2 AND c.system_kind = 'expense_category' AND c.deleted_at IS NULL`,
		workspaceID, folderID).Scan(&ref, &name)
	if errors.Is(err, ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	if err := q.LockContainer(ctx, workspaceID, &folderID); err != nil {
		return err
	}
	rows, err := q.db.Query(ctx, `SELECT id, name FROM document_folders WHERE workspace_id = $1 AND parent_id = $2
		AND system_kind = 'year' AND deleted_at IS NULL ORDER BY name, id`, workspaceID, folderID)
	if err != nil {
		return err
	}
	type yearFolder struct{ id, name string }
	var years []yearFolder
	for rows.Next() {
		var y yearFolder
		if err := rows.Scan(&y.id, &y.name); err != nil {
			rows.Close()
			return err
		}
		years = append(years, y)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	name = recordFolderName(name, "Category")
	if ref == "" {
		name = UncategorisedFolder
	}
	for _, y := range years {
		year, err := strconv.Atoi(y.name)
		if err != nil {
			continue // not a year after all: it stays with the folder's other contents below
		}
		var empty bool
		if err := q.db.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM documents WHERE workspace_id = $1 AND folder_id = $2)
			AND NOT EXISTS (SELECT 1 FROM document_folders WHERE workspace_id = $1 AND parent_id = $2)`, workspaceID, y.id).
			Scan(&empty); err != nil {
			return err
		}
		if !empty { // an empty year makes no new folder
			to, err := q.expenseFolder(ctx, workspaceID, ref, name, year, "", now)
			if err != nil {
				return err
			}
			if err := q.moveContents(ctx, workspaceID, y.id, "", to, now); err != nil {
				return err
			}
		}
		if _, err := q.db.Exec(ctx, `DELETE FROM document_folders WHERE workspace_id = $1 AND id = $2`, workspaceID, y.id); err != nil {
			return err
		}
	}
	rows, err = q.db.Query(ctx, `SELECT DISTINCT extract(year FROM created_at AT TIME ZONE
			(SELECT w.timezone FROM workspaces w WHERE w.id = $1))::int AS year FROM (
		SELECT created_at FROM document_folders WHERE workspace_id = $1 AND parent_id = $2
		UNION ALL SELECT created_at FROM documents WHERE workspace_id = $1 AND folder_id = $2) x ORDER BY year`,
		workspaceID, folderID)
	if err != nil {
		return err
	}
	var loose []int
	for rows.Next() {
		var year int
		if err := rows.Scan(&year); err != nil {
			rows.Close()
			return err
		}
		loose = append(loose, year)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, year := range loose {
		to, err := q.expenseFolder(ctx, workspaceID, ref, name, year, "", now)
		if err != nil {
			return err
		}
		if err := q.moveContents(ctx, workspaceID, folderID, strconv.Itoa(year), to, now); err != nil {
			return err
		}
	}
	_, err = q.db.Exec(ctx, `DELETE FROM document_folders WHERE workspace_id = $1 AND id = $2`, workspaceID, folderID)
	return err
}

// moveContents moves the files and folders straight in from (live and trashed; only those made in year, in the
// workspace's time zone, unless year is "") into to, the live ones under free names, and points the signature
// requests that file into from at to.
func (q Q) moveContents(ctx context.Context, workspaceID, from, year, to string, now time.Time) error {
	for _, id := range []string{from, to} {
		if err := q.LockContainer(ctx, workspaceID, &id); err != nil {
			return err
		}
	}
	const made = ` AND ($3 = '' OR extract(year FROM created_at AT TIME ZONE
		(SELECT w.timezone FROM workspaces w WHERE w.id = $1))::text = $3)`
	for _, table := range []string{"documents", "document_folders"} {
		parent := "folder_id"
		if table == "document_folders" {
			parent = "parent_id"
		}
		rows, err := q.db.Query(ctx, `SELECT id, name, deleted_at IS NOT NULL FROM `+table+` WHERE workspace_id = $1
			AND `+parent+` = $2`+made+` ORDER BY created_at, id`, workspaceID, from, year)
		if err != nil {
			return err
		}
		type item struct {
			id, name string
			trashed  bool
		}
		var items []item
		for rows.Next() {
			var it item
			if err := rows.Scan(&it.id, &it.name, &it.trashed); err != nil {
				rows.Close()
				return err
			}
			items = append(items, it)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, it := range items {
			if !it.trashed {
				if table == "documents" {
					it.name, err = q.FreeFileName(ctx, workspaceID, &to, it.name)
				} else {
					it.name, err = q.FreeFolderName(ctx, workspaceID, &to, it.name)
				}
				if err != nil {
					return err
				}
			}
			if _, err := q.db.Exec(ctx, `UPDATE `+table+` SET `+parent+` = $3, name = $4, updated_at = $5
				WHERE workspace_id = $1 AND id = $2`, workspaceID, it.id, to, it.name, now); err != nil {
				return err
			}
		}
	}
	_, err := q.db.Exec(ctx, `UPDATE signature_requests SET folder_id = $3 WHERE workspace_id = $1 AND folder_id = $2`,
		workspaceID, from, to)
	return err
}

// PendingRecordFile: a generated PDF of a client's record that has no Documents file yet (backfill).
type PendingRecordFile struct {
	WorkspaceID, ClientID, Kind, TargetType, TargetID, Name, ObjectKey string
	Year                                                               int
	Size                                                               int64
	CreatedAt                                                          time.Time
}

// pendingRecordsSQL: issued invoices and sent quotes whose stored PDF no document points at.
const pendingRecordsSQL = `SELECT i.workspace_id, i.client_id, 'invoices', 'invoice', i.id,
		CASE WHEN i.kind = 'credit_note' THEN 'Credit-note' ELSE 'Invoice' END || '-' || replace(coalesce(i.number, i.id), '/', '-') || '.pdf',
		i.pdf_key, extract(year FROM i.issue_date)::int, coalesce(o.size, 0), coalesce(i.issued_at, i.created_at)
	FROM invoices i LEFT JOIN stored_objects o ON o.object_key = i.pdf_key
	WHERE i.pdf_key IS NOT NULL AND i.client_id IS NOT NULL AND i.status <> 'draft'
		AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.workspace_id = i.workspace_id AND d.object_key = i.pdf_key)
	UNION ALL
	SELECT t.workspace_id, t.client_id, 'quotes', '', t.id,
		'Quote-' || replace(coalesce(t.number, t.id), '/', '-') || CASE WHEN t.revision > 1 THEN '-r' || t.revision ELSE '' END || '.pdf',
		t.pdf_key, extract(year FROM t.issue_date)::int, coalesce(o.size, 0), coalesce(t.sent_at, t.updated_at)
	FROM quotes t LEFT JOIN stored_objects o ON o.object_key = t.pdf_key
	WHERE t.pdf_key IS NOT NULL AND t.client_id IS NOT NULL
		AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.workspace_id = t.workspace_id AND d.object_key = t.pdf_key)
	ORDER BY 1, 10 LIMIT $1`

// PendingRecordFiles: up to limit generated PDFs to file in (every workspace).
func (q Q) PendingRecordFiles(ctx context.Context, limit int) ([]PendingRecordFile, error) {
	rows, err := q.db.Query(ctx, pendingRecordsSQL, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PendingRecordFile
	for rows.Next() {
		var p PendingRecordFile
		if err := rows.Scan(&p.WorkspaceID, &p.ClientID, &p.Kind, &p.TargetType, &p.TargetID, &p.Name, &p.ObjectKey,
			&p.Year, &p.Size, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// RecordFileExists: a document of the workspace already points at the object.
func (q Q) RecordFileExists(ctx context.Context, workspaceID, objectKey string) (bool, error) {
	var ok bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM documents WHERE workspace_id = $1 AND object_key = $2)`,
		workspaceID, objectKey).Scan(&ok)
	return ok, err
}

// LooseClientFile: a client's file the app put straight into Clients (before the per-client folders).
type LooseClientFile struct {
	WorkspaceID, DocumentID, ClientID, Name string
	Year                                    int
}

// LooseClientFiles: up to limit live files directly in a workspace's Clients folder linked to exactly one client.
func (q Q) LooseClientFiles(ctx context.Context, limit int) ([]LooseClientFile, error) {
	rows, err := q.db.Query(ctx, `SELECT d.workspace_id, d.id, min(l.target_id), d.name,
			extract(year FROM d.created_at AT TIME ZONE (SELECT w.timezone FROM workspaces w WHERE w.id = d.workspace_id))::int
		FROM documents d JOIN document_folders f ON f.id = d.folder_id AND f.system_kind = 'clients' AND f.deleted_at IS NULL
		JOIN document_links l ON l.document_id = d.id AND l.workspace_id = d.workspace_id AND l.target_type = 'client'
		WHERE d.deleted_at IS NULL AND NOT d.hr_private
			AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.workspace_id = d.workspace_id AND i.source_document_id = d.id)
		GROUP BY d.workspace_id, d.id, d.name, d.created_at HAVING count(DISTINCT l.target_id) = 1
		ORDER BY d.workspace_id, d.id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LooseClientFile
	for rows.Next() {
		var f LooseClientFile
		if err := rows.Scan(&f.WorkspaceID, &f.DocumentID, &f.ClientID, &f.Name, &f.Year); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// WorkspacesWithoutSystemRoots: up to limit workspaces missing a top-level system folder.
func (q Q) WorkspacesWithoutSystemRoots(ctx context.Context, limit int) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT w.id FROM workspaces w WHERE (SELECT count(DISTINCT f.system_kind) FROM document_folders f
		WHERE f.workspace_id = w.id AND f.parent_id IS NULL AND f.deleted_at IS NULL AND f.system_kind IN ('clients', 'expenses', 'tax_documents')) < 3
		ORDER BY w.id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return collect(rows)
}

// RecordPDF: the Documents file of a record's stored PDF; it shares the record's object (see retainedSQL).
func RecordPDF(id, key, name string, body []byte, now time.Time) Document {
	sum := sha256.Sum256(body)
	hash := hex.EncodeToString(sum[:])
	return Document{ID: id, Name: name, Size: int64(len(body)), ContentType: "application/pdf", SHA256: &hash, ObjectKey: key,
		CreatedAt: now}
}

// YearOf: the year of a YYYY-MM-DD date, or of fallback when it has none.
func YearOf(date string, fallback time.Time) int {
	if len(date) >= 4 {
		if y, err := strconv.Atoi(date[:4]); err == nil {
			return y
		}
	}
	return fallback.Year()
}

// ClientName: a client as AI filing names it, with its UID (the verified one, else its VAT number) to recognise it by.
type ClientName struct {
	ID, Name, UID string
}

// ClientNames: up to limit live clients of the workspace, most recently changed first.
func (q Q) ClientNames(ctx context.Context, workspaceID string, limit int) ([]ClientName, error) {
	rows, err := q.db.Query(ctx, `SELECT id, name, coalesce(verified_uid, vat_number, '') FROM clients
		WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC, id LIMIT $2`, workspaceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ClientName{}
	for rows.Next() {
		var c ClientName
		if err := rows.Scan(&c.ID, &c.Name, &c.UID); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CategoryName: an expense category as AI filing names it.
type CategoryName struct {
	ID, Name string
}

// ExpenseCategoryNames: up to limit live expense categories of the workspace, by name.
func (q Q) ExpenseCategoryNames(ctx context.Context, workspaceID string, limit int) ([]CategoryName, error) {
	rows, err := q.db.Query(ctx, `SELECT id, name FROM expense_categories WHERE workspace_id = $1 AND archived_at IS NULL
		ORDER BY lower(name), id LIMIT $2`, workspaceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CategoryName{}
	for rows.Next() {
		var c CategoryName
		if err := rows.Scan(&c.ID, &c.Name); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// RecordRef: an invoice (any kind) or quote of a live client, as AI organizing and filing recognise its files: by its
// number, its stored PDF (ObjectKey, "" for none; a quote has one row per sent revision's PDF) or the original file
// an imported invoice was read from (DocumentID, "" for none).
type RecordRef struct {
	Kind       string // the client record folder: invoices or quotes
	Type       string // the invoice kind, or quote
	Number     string // "" for none (a draft)
	ClientID   string
	Year       int
	ObjectKey  string
	DocumentID string
}

// RecordRefs: up to limit records of the workspace with a number or a stored PDF.
func (q Q) RecordRefs(ctx context.Context, workspaceID string, limit int) ([]RecordRef, error) {
	rows, err := q.db.Query(ctx, `SELECT 'invoices', i.kind, coalesce(i.number, ''), i.client_id,
			extract(year FROM i.issue_date)::int, coalesce(i.pdf_key, ''), coalesce(i.source_document_id, '')
		FROM invoices i JOIN clients c ON c.id = i.client_id AND c.deleted_at IS NULL
		WHERE i.workspace_id = $1 AND (i.number IS NOT NULL OR i.pdf_key IS NOT NULL OR i.source_document_id IS NOT NULL)
		UNION ALL
		SELECT 'quotes', 'quote', coalesce(t.number, ''), t.client_id, extract(year FROM t.issue_date)::int, coalesce(t.pdf_key, ''), ''
		FROM quotes t JOIN clients c ON c.id = t.client_id AND c.deleted_at IS NULL
		WHERE t.workspace_id = $1 AND (t.number IS NOT NULL OR t.pdf_key IS NOT NULL)
		UNION ALL
		SELECT 'quotes', 'quote', coalesce(t.number, ''), t.client_id, extract(year FROM t.issue_date)::int, r.pdf_key, ''
		FROM quote_revisions r JOIN quotes t ON t.id = r.quote_id JOIN clients c ON c.id = t.client_id AND c.deleted_at IS NULL
		WHERE r.workspace_id = $1 AND r.pdf_key IS NOT NULL AND r.pdf_key IS DISTINCT FROM t.pdf_key
		LIMIT $2`, workspaceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RecordRef{}
	for rows.Next() {
		var r RecordRef
		if err := rows.Scan(&r.Kind, &r.Type, &r.Number, &r.ClientID, &r.Year, &r.ObjectKey, &r.DocumentID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
