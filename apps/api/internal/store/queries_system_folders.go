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

// System folders (migration 00040): Clients/<client>/<record type>/<year> and Expenses/<year>. The app makes them on
// demand and nobody renames, moves or deletes them; the stored name of a typed one is English, shown translated.

// RecordFolders: the record types that belong to a client, by system_kind, with their stored (English) names.
var RecordFolders = map[string]string{"invoices": "Invoices", "quotes": "Quotes", "engagements": "Engagements",
	"signatures": "Signatures", "documents": "Documents"}

// SystemRoots: the top-level system folders, by system_kind.
var SystemRoots = map[string]string{"clients": "Clients", "expenses": "Expenses"}

const maxSystemFolderRunes = 60

// systemFolder: the live system folder of kind (and ref, the client of a client folder; the name of a year) in parent,
// made when missing. A plain folder already there by that name becomes it; a name another system folder holds gets a
// free one ("Acme (2)" for a second client called Acme). Run it in a transaction.
func (q Q) systemFolder(ctx context.Context, workspaceID string, parent *string, kind, ref, name, userID string, now time.Time) (string, error) {
	if err := q.LockContainer(ctx, workspaceID, parent); err != nil {
		return "", err
	}
	var id string
	err := q.db.QueryRow(ctx, `SELECT id FROM document_folders WHERE workspace_id = $1 AND parent_id IS NOT DISTINCT FROM $2
		AND system_kind = $3 AND deleted_at IS NULL AND CASE $3 WHEN 'client' THEN system_ref = $4 WHEN 'year' THEN name = $5 ELSE true END
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
	for _, kind := range []string{"clients", "expenses"} {
		if _, err := q.systemFolder(ctx, workspaceID, nil, kind, "", SystemRoots[kind], "", now); err != nil {
			return err
		}
	}
	return nil
}

// clientFolderName: the client's name as a folder name (no slashes, at most 60 characters).
func clientFolderName(name string) string {
	name = strings.Join(strings.Fields(strings.NewReplacer("/", "-", `\`, "-").Replace(name)), " ")
	if name == "" || name == "." || name == ".." {
		return "Client"
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
	var id string
	var parent *string
	err := q.db.QueryRow(ctx, `SELECT id, parent_id FROM document_folders WHERE workspace_id = $1 AND system_kind = 'client'
		AND system_ref = $2 AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`, workspaceID, clientID).Scan(&id, &parent)
	if errors.Is(err, ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
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
	name = FreeName(clientFolderName(name), false, func(n string) bool {
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

// systemLevel: the system kind of level i of a name path made by FolderPath (Expenses/<year>/…), or "".
func systemLevel(names []string, i int) string {
	switch {
	case len(names) == 0 || names[0] != SystemRoots["expenses"]:
		return ""
	case i == 0:
		return "expenses"
	case i == 1 && len(names[1]) == 4 && strings.Trim(names[1], "0123456789") == "":
		return "year"
	}
	return ""
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
		JOIN document_links l ON l.document_id = d.id AND l.target_type = 'client'
		WHERE d.deleted_at IS NULL AND NOT d.hr_private
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
		WHERE f.workspace_id = w.id AND f.parent_id IS NULL AND f.deleted_at IS NULL AND f.system_kind IN ('clients', 'expenses')) < 2
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

// ClientName: a client as AI filing names it.
type ClientName struct {
	ID, Name string
}

// ClientNames: up to limit live clients of the workspace, most recently changed first.
func (q Q) ClientNames(ctx context.Context, workspaceID string, limit int) ([]ClientName, error) {
	rows, err := q.db.Query(ctx, `SELECT id, name FROM clients WHERE workspace_id = $1 AND deleted_at IS NULL
		ORDER BY updated_at DESC, id LIMIT $2`, workspaceID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ClientName{}
	for rows.Next() {
		var c ClientName
		if err := rows.Scan(&c.ID, &c.Name); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
