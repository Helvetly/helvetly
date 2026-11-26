package store

import (
	"context"
	"fmt"
	"path"
	"strconv"
	"strings"
	"time"

	doctags "helvetly.com/api/internal/tags"
)

// TrashDays: how long trashed folders and files stay restorable before they are purged.
const TrashDays = 30

type Folder struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	ParentID   *string   `json:"parent_id"`
	FileCount  int       `json:"file_count"`
	Size       int64     `json:"size"`
	TotalFiles int       `json:"total_files"`
	TotalSize  int64     `json:"total_size"`
	CreatedBy  *Uploader `json:"created_by"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	Starred    bool      `json:"starred"`     // by the person asking
	SystemKind *string   `json:"system_kind"` // a system folder (queries_system_folders.go): nobody renames, moves or deletes it
}

type FolderRef struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	SystemKind *string `json:"system_kind,omitempty"`
}

type Document struct {
	EmployeeID    *string         `json:"-"` // set only on create: an employee's file, private like HRPrivate
	HRPrivate     bool            `json:"-"` // set only on create: an HR file outside the general document system
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	FolderID      *string         `json:"folder_id"`
	Folder        *FolderRef      `json:"folder"`
	Size          int64           `json:"size"`
	ContentType   string          `json:"content_type"`
	Kind          string          `json:"kind"`        // set by internal/documents
	Previewable   bool            `json:"previewable"` // set by internal/documents
	SHA256        *string         `json:"sha256"`
	Tags          []string        `json:"tags"`
	AutoTags      []string        `json:"auto_tags"`   // those of Tags the app set (tags.Auto)
	LockedTags    []string        `json:"locked_tags"` // those of AutoTags only the record or filing sets (tags.Locked)
	FiledKind     string          `json:"-"`           // the kind AI filing or organizing recorded, or a client document's type
	AIFiling      *Filing         `json:"ai_filing"`
	Links         []DocumentLink  `json:"links"`
	SharedWith    []DocumentShare `json:"shared_with"` // clients that see it in portal, newest first
	RetainedUntil *string         `json:"retained_until"`
	RecordFile    bool            `json:"record_file"`
	UploadedBy    *Uploader       `json:"uploaded_by"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
	DeletedAt     *time.Time      `json:"deleted_at"`
	DeletedBy     *Uploader       `json:"deleted_by"`
	PurgeAt       *time.Time      `json:"purge_at"`
	TrashedWith   *string         `json:"-"`
	ObjectKey     string          `json:"-"`
}

// MoveLocked reports the record padlock for a document already read in its transaction.
func (d Document) MoveLocked(today string) bool {
	return d.RecordFile || d.RetainedUntil != nil && *d.RetainedUntil >= today
}

type DocumentLink struct {
	Type    string `json:"type"`
	ID      string `json:"id"`
	Label   string `json:"label"`
	Retains bool   `json:"retains"`
}

type TrashItem struct {
	Type          string     `json:"type"`
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	ContentType   *string    `json:"content_type"`
	Size          int64      `json:"size"`
	ItemCount     int        `json:"item_count"`
	Location      *FolderRef `json:"location"`
	RetainedUntil *string    `json:"retained_until"`
	DeletedAt     time.Time  `json:"deleted_at"`
	DeletedBy     *Uploader  `json:"deleted_by"`
	PurgeAt       time.Time  `json:"purge_at"`
}

// retentionSQL: the date until which document d is a business record (OR Art. 958f, GeBüV: ten years from the end
// of the year of the issued invoice or booked expense it is linked to), or NULL.
// Timestamps count on their civil date in the workspace's time zone.
// shortcut: the fiscal year is the calendar year; use the workspace's fiscal year once it has one.
const retentionSQL = `(SELECT to_char(make_date(max(extract(year FROM r.day))::int + 10, 12, 31), 'YYYY-MM-DD') FROM (
		SELECT i.issue_date AS day FROM document_links l JOIN invoices i ON i.id = l.target_id
		WHERE l.document_id = d.id AND l.target_type = 'invoice' AND i.status <> 'draft'
		UNION ALL
		SELECT coalesce(e.document_date, (e.booked_at AT TIME ZONE (SELECT w.timezone FROM workspaces w WHERE w.id = d.workspace_id))::date) FROM document_links l JOIN expenses e ON e.id = l.target_id
		WHERE l.document_id = d.id AND l.target_type = 'expense' AND e.status <> 'draft'
		UNION ALL
		SELECT (s.completed_at AT TIME ZONE (SELECT w.timezone FROM workspaces w WHERE w.id = d.workspace_id))::date FROM document_links l JOIN signature_requests s ON s.id = l.target_id
		WHERE l.document_id = d.id AND l.target_type = 'signature' AND s.completed_at IS NOT NULL) r)`

// retainedSQL: document d may not be trashed or deleted on the day in parameter $today; the original of an invoice
// issued elsewhere stays as long as the invoice (invoices.source_document_id) points at it, and the filed PDF of an
// invoice or quote as long as the record (pdf_key) or a sent revision of the quote keeps it: they share one object.
const recordFileSQL = `(EXISTS (SELECT 1 FROM invoices si WHERE si.workspace_id = d.workspace_id AND si.source_document_id = d.id)
		OR EXISTS (SELECT 1 FROM invoices pi WHERE pi.workspace_id = d.workspace_id AND pi.pdf_key = d.object_key)
		OR EXISTS (SELECT 1 FROM quotes pq WHERE pq.workspace_id = d.workspace_id AND pq.pdf_key = d.object_key)
		OR EXISTS (SELECT 1 FROM quote_revisions qr WHERE qr.workspace_id = d.workspace_id AND qr.pdf_key = d.object_key))`

func retainedSQL(today string) string {
	return `(coalesce(` + retentionSQL + ` >= ` + today + `, false) OR ` + recordFileSQL + `)`
}

// LockLiveDocument serializes changes to the source before assigning or checking its record.
func (q Q) LockLiveDocument(ctx context.Context, workspaceID, id string) error {
	var found string
	return q.db.QueryRow(ctx, `SELECT id FROM documents WHERE workspace_id = $1 AND id = $2
		AND deleted_at IS NULL AND NOT hr_private FOR UPDATE`, workspaceID, id).Scan(&found)
}

// DocumentMoveLocked checks the current record after locking the file. Renaming in place is allowed.
func (q Q) DocumentMoveLocked(ctx context.Context, workspaceID, id string, target *string, today string) (bool, error) {
	if err := q.LockLiveDocument(ctx, workspaceID, id); err != nil {
		return false, err
	}
	var locked bool
	err := q.db.QueryRow(ctx, `SELECT d.folder_id IS DISTINCT FROM $3::text AND `+retainedSQL("$4")+
		` FROM documents d WHERE d.workspace_id = $1 AND d.id = $2`, workspaceID, id, target, today).Scan(&locked)
	return locked, err
}

// ---- folders ----

// LockContainer serialises name decisions inside one folder (nil = top level) until the transaction ends.
func (q Q) LockContainer(ctx context.Context, workspaceID string, folderID *string) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1 || '/' || coalesce($2, ''), 0))`, workspaceID, folderID)
	return err
}

// DocumentFolders: every live folder, by name, with the files directly inside and the totals of each subtree.
func (q Q) DocumentFolders(ctx context.Context, workspaceID, userID string) ([]Folder, error) {
	rows, err := q.db.Query(ctx, `SELECT f.id, f.name, f.parent_id, f.created_at, f.updated_at, u.id, u.name, `+avatarColumn+`,
			coalesce(s.n, 0), coalesce(s.size, 0), st.folder_id IS NOT NULL, f.system_kind
		FROM document_folders f LEFT JOIN users u ON u.id = f.created_by
		LEFT JOIN document_folder_stars st ON st.folder_id = f.id AND st.user_id = $2
		LEFT JOIN (SELECT folder_id, count(*) AS n, sum(size) AS size FROM documents
			WHERE workspace_id = $1 AND deleted_at IS NULL AND NOT hr_private GROUP BY folder_id) s ON s.folder_id = f.id
		WHERE f.workspace_id = $1 AND f.deleted_at IS NULL ORDER BY lower(f.name), f.id`, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	folders := []Folder{}
	for rows.Next() {
		var f Folder
		var uid, uname, uavatar *string
		if err := rows.Scan(&f.ID, &f.Name, &f.ParentID, &f.CreatedAt, &f.UpdatedAt, &uid, &uname, &uavatar, &f.FileCount, &f.Size, &f.Starred, &f.SystemKind); err != nil {
			return nil, err
		}
		f.CreatedBy = uploader(uid, uname, uavatar)
		folders = append(folders, f)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	addTotals(folders)
	return folders, nil
}

// addTotals sums each folder's files with those of every folder below it.
func addTotals(folders []Folder) {
	index := make(map[string]int, len(folders))
	for i, f := range folders {
		index[f.ID] = i
	}
	for _, f := range folders {
		// Walk up from each folder, adding its own files to every ancestor; seen guards against a corrupt cycle.
		seen := map[string]bool{}
		for id := &f.ID; id != nil && !seen[*id]; {
			seen[*id] = true
			i, ok := index[*id]
			if !ok {
				break
			}
			folders[i].TotalFiles += f.FileCount
			folders[i].TotalSize += f.Size
			id = folders[i].ParentID
		}
	}
}

// StarFolder stars or unstars a live folder of the workspace for one person; false when there is no such folder.
func (q Q) StarFolder(ctx context.Context, workspaceID, userID, folderID string, on bool, now time.Time) (bool, error) {
	if !on {
		tag, err := q.db.Exec(ctx, `DELETE FROM document_folder_stars WHERE user_id = $2 AND folder_id = (
			SELECT id FROM document_folders WHERE workspace_id = $1 AND id = $3 AND deleted_at IS NULL)`,
			workspaceID, userID, folderID)
		if err != nil || tag.RowsAffected() > 0 {
			return err == nil, err
		}
		// Nothing to remove: still a success when the folder exists.
		var exists bool
		err = q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM document_folders WHERE workspace_id = $1 AND id = $2
			AND deleted_at IS NULL)`, workspaceID, folderID).Scan(&exists)
		return exists, err
	}
	tag, err := q.db.Exec(ctx, `INSERT INTO document_folder_stars (user_id, folder_id, workspace_id, created_at)
		SELECT $2, id, workspace_id, $4 FROM document_folders WHERE workspace_id = $1 AND id = $3 AND deleted_at IS NULL
		ON CONFLICT (user_id, folder_id) DO UPDATE SET created_at = document_folder_stars.created_at`,
		workspaceID, userID, folderID, now)
	return tag.RowsAffected() > 0, err
}

// DocumentFolder: one live folder (without counts).
func (q Q) DocumentFolder(ctx context.Context, workspaceID, id string) (Folder, error) {
	var f Folder
	err := q.db.QueryRow(ctx, `SELECT id, name, parent_id, created_at, updated_at, system_kind FROM document_folders
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`, workspaceID, id).
		Scan(&f.ID, &f.Name, &f.ParentID, &f.CreatedAt, &f.UpdatedAt, &f.SystemKind)
	return f, err
}

func (q Q) CreateFolder(ctx context.Context, workspaceID, id, name string, parentID *string, userID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO document_folders (id, workspace_id, parent_id, name, created_by, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $6)`, id, workspaceID, parentID, name, userID, now)
	return err
}

func (q Q) UpdateFolder(ctx context.Context, workspaceID, id, name string, parentID *string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE document_folders SET name = $3, parent_id = $4, updated_at = $5
		WHERE workspace_id = $1 AND id = $2`, workspaceID, id, name, parentID, now)
	return err
}

// FolderWithin: folder target is folder id or below it (moving id there would make a cycle).
func (q Q) FolderWithin(ctx context.Context, target, id string) (bool, error) {
	var within bool
	err := q.db.QueryRow(ctx, `WITH RECURSIVE up AS (
			SELECT id, parent_id FROM document_folders WHERE id = $1
			UNION ALL SELECT p.id, p.parent_id FROM document_folders p JOIN up ON p.id = up.parent_id)
		SELECT EXISTS (SELECT 1 FROM up WHERE id = $2)`, target, id).Scan(&within)
	return within, err
}

// FolderNameTaken: the id of the live folder with this name (case-insensitive) in the parent, or "".
func (q Q) FolderNameTaken(ctx context.Context, workspaceID string, parentID *string, name, exceptID string) (string, error) {
	return q.taken(ctx, `SELECT id FROM document_folders WHERE workspace_id = $1 AND parent_id IS NOT DISTINCT FROM $2
		AND lower(name) = lower($3) AND id <> $4 AND deleted_at IS NULL LIMIT 1`, workspaceID, parentID, name, exceptID)
}

// FileNameTaken: the id of the live file with this name (case-insensitive) in the folder, or "".
func (q Q) FileNameTaken(ctx context.Context, workspaceID string, folderID *string, name, exceptID string) (string, error) {
	return q.taken(ctx, `SELECT id FROM documents WHERE workspace_id = $1 AND folder_id IS NOT DISTINCT FROM $2
		AND lower(name) = lower($3) AND id <> $4 AND deleted_at IS NULL AND NOT hr_private LIMIT 1`, workspaceID, folderID, name, exceptID)
}

func (q Q) taken(ctx context.Context, sql string, args ...any) (string, error) {
	var id string
	err := q.db.QueryRow(ctx, sql, args...).Scan(&id)
	if err == ErrNotFound {
		return "", nil
	}
	return id, err
}

// FreeFileName: name, or "name (2).ext", "name (3).ext"… whichever no live file in the folder has.
func (q Q) FreeFileName(ctx context.Context, workspaceID string, folderID *string, name string) (string, error) {
	return q.free(ctx, `SELECT lower(name) FROM documents WHERE workspace_id = $1 AND folder_id IS NOT DISTINCT FROM $2
		AND deleted_at IS NULL AND NOT hr_private`, workspaceID, folderID, name, true)
}

// FreeFolderName: as FreeFileName for a folder among its siblings ("Offers (2)").
func (q Q) FreeFolderName(ctx context.Context, workspaceID string, parentID *string, name string) (string, error) {
	return q.free(ctx, `SELECT lower(name) FROM document_folders WHERE workspace_id = $1 AND parent_id IS NOT DISTINCT FROM $2
		AND deleted_at IS NULL`, workspaceID, parentID, name, false)
}

func (q Q) free(ctx context.Context, sql, workspaceID string, container *string, name string, keepExt bool) (string, error) {
	rows, err := q.db.Query(ctx, sql, workspaceID, container)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	taken := map[string]bool{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return "", err
		}
		taken[n] = true
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return FreeName(name, keepExt, func(n string) bool { return taken[strings.ToLower(n)] }), nil
}

// FreeName: name, or the first of "name (2)", "name (3)"… (before the extension when keepExt) that is not taken.
func FreeName(name string, keepExt bool, taken func(string) bool) string {
	if !taken(name) {
		return name
	}
	base, ext := name, ""
	if keepExt {
		ext = path.Ext(name)
		if ext == name { // ".env": all extension, no base
			ext = ""
		}
		base = strings.TrimSuffix(name, ext)
	}
	// "Offer (2).pdf" counts on from "Offer", not to "Offer (2) (2).pdf".
	if open := strings.LastIndex(base, " ("); open > 0 && strings.HasSuffix(base, ")") {
		if _, err := strconv.Atoi(base[open+2 : len(base)-1]); err == nil {
			base = base[:open]
		}
	}
	for n := 2; ; n++ {
		if candidate := base + " (" + strconv.Itoa(n) + ")" + ext; !taken(candidate) {
			return candidate
		}
	}
}

// subtreeSQL: the live folder $2 of workspace $1 and every live folder below it, as CTE "t".
const subtreeSQL = `WITH RECURSIVE t AS (
		SELECT id FROM document_folders WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL
		UNION ALL SELECT c.id FROM document_folders c JOIN t ON c.parent_id = t.id WHERE c.deleted_at IS NULL) `

// FolderRetained: a live file in the folder or below it is a business record on today.
func (q Q) FolderRetained(ctx context.Context, workspaceID, id, today string) (bool, error) {
	var retained bool
	err := q.db.QueryRow(ctx, subtreeSQL+`SELECT EXISTS (SELECT 1 FROM documents d WHERE d.folder_id IN (SELECT id FROM t)
		AND d.deleted_at IS NULL AND `+retainedSQL("$3")+`)`, workspaceID, id, today).Scan(&retained)
	return retained, err
}

// TrashFolder moves the folder to the Trash with everything live inside it, which comes back with it.
func (q Q) TrashFolder(ctx context.Context, workspaceID, id, userID string, now time.Time) error {
	if _, err := q.db.Exec(ctx, subtreeSQL+`UPDATE documents SET deleted_at = $3, deleted_by = $4, trashed_with = $2
		WHERE folder_id IN (SELECT id FROM t) AND deleted_at IS NULL`, workspaceID, id, now, userID); err != nil {
		return err
	}
	_, err := q.db.Exec(ctx, subtreeSQL+`UPDATE document_folders SET deleted_at = $3, deleted_by = $4,
		trashed_with = CASE WHEN id = $2 THEN NULL ELSE $2 END WHERE id IN (SELECT id FROM t)`, workspaceID, id, now, userID)
	return err
}

// TrashedFolder: a folder shown in the Trash (trashed on its own), with its parent if that is still live.
func (q Q) TrashedFolder(ctx context.Context, workspaceID, id string) (name string, liveParent *string, err error) {
	err = q.db.QueryRow(ctx, `SELECT f.name, p.id FROM document_folders f
		LEFT JOIN document_folders p ON p.id = f.parent_id AND p.deleted_at IS NULL
		WHERE f.workspace_id = $1 AND f.id = $2 AND f.deleted_at IS NOT NULL AND f.trashed_with IS NULL`, workspaceID, id).
		Scan(&name, &liveParent)
	return name, liveParent, err
}

// RestoreFolder brings the folder back under parentID with name, and everything trashed with it.
func (q Q) RestoreFolder(ctx context.Context, workspaceID, id, name string, parentID *string, now time.Time) error {
	for _, sql := range []string{
		`UPDATE document_folders SET deleted_at = NULL, deleted_by = NULL, trashed_with = NULL WHERE workspace_id = $1 AND trashed_with = $2`,
		`UPDATE documents SET deleted_at = NULL, deleted_by = NULL, trashed_with = NULL WHERE workspace_id = $1 AND trashed_with = $2`,
	} {
		if _, err := q.db.Exec(ctx, sql, workspaceID, id); err != nil {
			return err
		}
	}
	_, err := q.db.Exec(ctx, `UPDATE document_folders SET deleted_at = NULL, deleted_by = NULL, name = $3, parent_id = $4,
		updated_at = $5 WHERE workspace_id = $1 AND id = $2`, workspaceID, id, name, parentID, now)
	return err
}

// PurgeFolder deletes a trashed folder and what was trashed with it, unless a business record is among it, and
// returns the object keys to remove. Files trashed on their own earlier keep their Trash entry.
func (q Q) PurgeFolder(ctx context.Context, workspaceID, id, today string) (keys []string, purged bool, err error) {
	var retained bool
	if err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM documents d WHERE d.workspace_id = $1 AND d.trashed_with = $2
		AND `+retainedSQL("$3")+`)`, workspaceID, id, today).Scan(&retained); err != nil || retained {
		return nil, false, err
	}
	rows, err := q.db.Query(ctx, `DELETE FROM documents WHERE workspace_id = $1 AND trashed_with = $2 RETURNING object_key`,
		workspaceID, id)
	if err != nil {
		return nil, false, err
	}
	keys, err = collect(rows)
	if err != nil {
		return nil, false, err
	}
	tag, err := q.db.Exec(ctx, `DELETE FROM document_folders WHERE workspace_id = $1 AND (trashed_with = $2
		OR (id = $2 AND deleted_at IS NOT NULL AND trashed_with IS NULL))`, workspaceID, id)
	return keys, tag.RowsAffected() > 0, err
}

func collect(rows interface {
	Next() bool
	Scan(...any) error
	Err() error
	Close()
}) ([]string, error) {
	defer rows.Close()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ---- documents ----

var documentSelect = `SELECT d.id, d.name, d.folder_id, f.name, d.size, d.content_type, d.sha256, d.object_key,
		d.created_at, d.updated_at, d.deleted_at, d.trashed_with, u.id, u.name, ` + avatarColumn + `, x.id, x.name, ` + avatarOf("x") + `, ` + retentionSQL + `,
		d.tags, ff.status, ff.folder_id, fl.name, coalesce(ff.created_folder, false), coalesce(ff.tags, '{}'),
		f.system_kind, fl.system_kind, d.auto_tags, d.locked_tags, coalesce(d.filed_kind, ''), ` + recordFileSQL + `
	FROM documents d LEFT JOIN document_folders f ON f.id = d.folder_id AND f.deleted_at IS NULL
	LEFT JOIN users u ON u.id = d.uploaded_by LEFT JOIN users x ON x.id = d.deleted_by
	LEFT JOIN document_filings ff ON ff.document_id = d.id
	LEFT JOIN document_folders fl ON fl.id = ff.folder_id AND fl.deleted_at IS NULL `

func scanDocument(row interface{ Scan(...any) error }, extra ...any) (Document, error) {
	var d Document
	var folderName, uid, uname, uavatar, xid, xname, xavatar, filing, filedID, filedName, folderKind, filedKind *string
	var filed Filing
	err := row.Scan(append([]any{&d.ID, &d.Name, &d.FolderID, &folderName, &d.Size, &d.ContentType, &d.SHA256, &d.ObjectKey,
		&d.CreatedAt, &d.UpdatedAt, &d.DeletedAt, &d.TrashedWith, &uid, &uname, &uavatar, &xid, &xname, &xavatar, &d.RetainedUntil,
		&d.Tags, &filing, &filedID, &filedName, &filed.CreatedFolder, &filed.Tags, &folderKind, &filedKind, &d.AutoTags, &d.LockedTags, &d.FiledKind, &d.RecordFile}, extra...)...)
	if filing != nil {
		filed.Status = *filing
		if filedID != nil && filedName != nil {
			filed.Folder = &FolderRef{ID: *filedID, Name: *filedName, SystemKind: filedKind}
		}
		d.AIFiling = &filed
	}
	if d.FolderID != nil && folderName != nil {
		d.Folder = &FolderRef{ID: *d.FolderID, Name: *folderName, SystemKind: folderKind}
	}
	d.UploadedBy, d.DeletedBy = uploader(uid, uname, uavatar), uploader(xid, xname, xavatar)
	if d.DeletedAt != nil {
		purge := d.DeletedAt.AddDate(0, 0, TrashDays)
		d.PurgeAt = &purge
	}
	d.Links, d.SharedWith = []DocumentLink{}, []DocumentShare{}
	if d.Tags == nil {
		d.Tags = []string{}
	}
	if d.AutoTags == nil {
		d.AutoTags = []string{}
	}
	if d.LockedTags == nil {
		d.LockedTags = []string{}
	}
	return d, err
}

// Document: one file of the workspace, live or in the Trash, with its links. HR files (employee documents, payroll
// import sources) are not documents here: every general reader, share, signature and link goes through this.
func (q Q) Document(ctx context.Context, workspaceID, id string) (Document, error) {
	d, err := scanDocument(q.db.QueryRow(ctx, documentSelect+`WHERE d.workspace_id = $1 AND d.id = $2 AND NOT d.hr_private`, workspaceID, id))
	if err != nil {
		return d, err
	}
	docs := []Document{d}
	err = q.addLinks(ctx, docs)
	return docs[0], err
}

func (q Q) addLinks(ctx context.Context, docs []Document) error {
	if len(docs) == 0 {
		return nil
	}
	ids := make([]string, len(docs))
	at := make(map[string]int, len(docs))
	for i, d := range docs {
		ids[i], at[d.ID] = d.ID, i
	}
	rows, err := q.db.Query(ctx, `SELECT document_id, target_type, target_id, label, retains FROM (SELECT l.document_id, l.target_type, l.target_id,
			coalesce(CASE l.target_type
				WHEN 'client' THEN c.name
				WHEN 'invoice' THEN CASE WHEN i.number IS NULL
					THEN 'Draft ' || CASE WHEN i.kind = 'credit_note' THEN 'credit note' ELSE 'invoice' END
					ELSE CASE WHEN i.kind = 'credit_note' THEN 'Credit note ' ELSE 'Invoice ' END || i.number END
				WHEN 'expense' THEN 'Expense #' || e.number || coalesce(' · ' || e.supplier_name, '')
				WHEN 'signature' THEN 'Signed · ' || sr.title
			END, 'Deleted record'),
			coalesce((l.target_type = 'invoice' AND i.status <> 'draft') OR (l.target_type = 'expense' AND e.status <> 'draft')
				OR (l.target_type = 'signature' AND sr.completed_at IS NOT NULL), false), l.created_at
		FROM document_links l
		LEFT JOIN clients c ON l.target_type = 'client' AND c.id = l.target_id
		LEFT JOIN invoices i ON l.target_type = 'invoice' AND i.id = l.target_id
		LEFT JOIN expenses e ON l.target_type = 'expense' AND e.id = l.target_id
		LEFT JOIN signature_requests sr ON l.target_type = 'signature' AND sr.id = l.target_id
		WHERE l.document_id = ANY($1)
		UNION ALL -- the quote a contract was made from (quote_contracts), labelled by its number alone
		SELECT qc.document_id, 'quote', qc.quote_id, coalesce(t.number, ''), false, qc.created_at
		FROM quote_contracts qc JOIN quotes t ON t.id = qc.quote_id WHERE qc.document_id = ANY($1)
	) links (document_id, target_type, target_id, label, retains, created_at)
	ORDER BY created_at, target_type, target_id`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var docID string
		var l DocumentLink
		if err := rows.Scan(&docID, &l.Type, &l.ID, &l.Label, &l.Retains); err != nil {
			return err
		}
		docs[at[docID]].Links = append(docs[at[docID]].Links, l)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()
	shares, err := q.db.Query(ctx, `SELECT s.document_id, c.id, c.name, s.created_at, s.expires_at FROM document_shares s JOIN clients c ON c.id = s.client_id
		WHERE s.document_id = ANY($1) AND c.deleted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()) ORDER BY s.created_at DESC, c.id`, ids)
	if err != nil {
		return err
	}
	defer shares.Close()
	for shares.Next() {
		var docID string
		var sh DocumentShare
		if err := shares.Scan(&docID, &sh.ClientID, &sh.ClientName, &sh.SharedAt, &sh.ExpiresAt); err != nil {
			return err
		}
		docs[at[docID]].SharedWith = append(docs[at[docID]].SharedWith, sh)
	}
	return shares.Err()
}

func (q Q) createDocument(ctx context.Context, workspaceID, userID string, d Document) error {
	_, err := q.db.Exec(ctx, `INSERT INTO documents (id, workspace_id, folder_id, name, size, content_type, sha256, object_key,
			uploaded_by, created_at, updated_at, employee_id, hr_private)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, nullif($9, ''), $10, $10, $11, $12)`, d.ID, workspaceID, d.FolderID, d.Name, d.Size,
		d.ContentType, d.SHA256, d.ObjectKey, userID, d.CreatedAt, d.EmployeeID, d.HRPrivate || d.EmployeeID != nil)
	return err
}

// UpdateDocument renames and/or moves a live file.
func (q Q) UpdateDocument(ctx context.Context, workspaceID, id, name string, folderID *string, now time.Time) error {
	if _, err := q.db.Exec(ctx, `UPDATE documents SET name = $3, folder_id = $4, updated_at = $5
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`, workspaceID, id, name, folderID, now); err != nil {
		return err
	}
	return q.AutoTag(ctx, workspaceID, id, now)
}

// SetDocumentTags replaces a live file's tags for the app (AI filing, organizing, undo); its automatic tags stay, and a
// kind, signed or date tag it does not already have is left out (those come only from the record or filing).
func (q Q) SetDocumentTags(ctx context.Context, workspaceID, id string, tags []string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE documents SET updated_at = $4,
			tags = ARRAY(SELECT t FROM unnest($3::text[]) WITH ORDINALITY a(t, i) WHERE t !~ $5 OR t = ANY(documents.tags) OR t = ANY(auto_tags) ORDER BY i)
			|| ARRAY(SELECT t FROM unnest(auto_tags) WITH ORDINALITY a(t, i) WHERE NOT t = ANY($3::text[]) ORDER BY i)
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL AND NOT hr_private`, workspaceID, id, tags, now, doctags.ProtectedPattern)
	return err
}

// SetDocumentKind records the kind AI filing or organizing found, or a client document's type, ("" for none) and retags the file.
func (q Q) SetDocumentKind(ctx context.Context, workspaceID, id, kind string, now time.Time) error {
	if _, err := q.db.Exec(ctx, `UPDATE documents SET filed_kind = nullif($3, '') WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL`,
		workspaceID, id, kind); err != nil {
		return err
	}
	return q.AutoTag(ctx, workspaceID, id, now)
}

// SetOwnDocumentTags replaces a person's editable tags. The locked automatic tags (locked_tags) always stay, even for
// older clients; another automatic tag the person leaves out goes to removed_auto_tags and never comes back.
func (q Q) SetOwnDocumentTags(ctx context.Context, workspaceID, id string, tags []string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE documents SET
			tags = $3::text[] || ARRAY(SELECT t FROM unnest(auto_tags) WITH ORDINALITY a(t, i) WHERE t = ANY(locked_tags) AND NOT t = ANY($3::text[]) ORDER BY i),
			updated_at = $4,
			auto_tags = ARRAY(SELECT t FROM unnest(auto_tags) WITH ORDINALITY a(t, i) WHERE t = ANY(locked_tags) OR t = ANY($3::text[]) ORDER BY i),
			removed_auto_tags = ARRAY(SELECT unnest(removed_auto_tags) UNION
				SELECT t FROM unnest(auto_tags) a(t) WHERE NOT t = ANY(locked_tags) AND NOT t = ANY($3::text[]))
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL AND NOT hr_private`, workspaceID, id, tags, now)
	return err
}

// TrashDocument moves a live file to the Trash unless it is a business record; false when it is.
func (q Q) TrashDocument(ctx context.Context, workspaceID, id, userID, today string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE documents d SET deleted_at = $3, deleted_by = $4, trashed_with = NULL
		WHERE d.workspace_id = $1 AND d.id = $2 AND d.deleted_at IS NULL AND NOT d.hr_private AND NOT `+retainedSQL("$5"), workspaceID, id, now, userID, today)
	return tag.RowsAffected() > 0, err
}

// RestoreDocument brings a file trashed on its own back into folderID under name.
func (q Q) RestoreDocument(ctx context.Context, workspaceID, id, name string, folderID *string) error {
	_, err := q.db.Exec(ctx, `UPDATE documents SET deleted_at = NULL, deleted_by = NULL, name = $3, folder_id = $4
		WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NOT NULL AND trashed_with IS NULL`, workspaceID, id, name, folderID)
	return err
}

// PurgeDocument deletes a file trashed on its own, unless it is a business record, and returns its object key ("" when
// nothing was deleted).
func (q Q) PurgeDocument(ctx context.Context, workspaceID, id, today string) (string, error) {
	key, err := q.taken(ctx, `DELETE FROM documents d WHERE d.workspace_id = $1 AND d.id = $2 AND d.deleted_at IS NOT NULL
		AND d.trashed_with IS NULL AND NOT `+retainedSQL("$3")+` RETURNING d.object_key`, workspaceID, id, today)
	return key, err
}

type DocumentFilter struct {
	Folder       string // "" = every folder, "root" = top level, otherwise a folder id
	Search       string
	ContentTypes []string
	UploadedBy   string
	From, To     string // YYYY-MM-DD, inclusive, days in Zone
	Zone         string // IANA name the days are read in; "" is UTC
	ClientID     string
	Tag          string
	// The virtual groups' keys (queries_document_groups.go): a DocumentTypes key, a year, a client id or NoClient.
	Types   []string
	Year    int
	Clients []string
	Sort    string // a key of DocumentSorts
	Desc    bool
}

var DocumentSorts = map[string]string{"name": "lower(d.name)", "size": "d.size", "created_at": "d.created_at",
	"updated_at": "d.updated_at", "kind": "d.content_type"}

// ListDocuments: a page of live files and the total matching.
func (q Q) ListDocuments(ctx context.Context, workspaceID string, f DocumentFilter, limit, offset int) ([]Document, int, error) {
	args := []any{workspaceID}
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	where := documentWhere(f, arg)
	order, ok := DocumentSorts[f.Sort]
	if !ok {
		order = DocumentSorts["name"]
	}
	if f.Desc {
		order += " DESC"
	}
	sel := strings.Replace(documentSelect, "SELECT ", "SELECT count(*) OVER (), ", 1)
	if f.grouped() {
		sel = classCTE + sel + classJoins(arg(zoneOr(f.Zone)))
	}
	sql := fmt.Sprintf(`%s WHERE %s ORDER BY %s, d.id LIMIT %s OFFSET %s`, sel, strings.Join(where, " AND "), order, arg(limit), arg(offset))
	rows, err := q.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	docs, total := []Document{}, 0
	for rows.Next() {
		var n int
		d, err := scanDocument(scanFirst{rows, &n})
		if err != nil {
			return nil, 0, err
		}
		total = n
		docs = append(docs, d)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if err := q.addLinks(ctx, docs); err != nil {
		return nil, 0, err
	}
	return docs, total, nil
}

// scanFirst scans a leading column (the window count) before the row's own.
type scanFirst struct {
	row   interface{ Scan(...any) error }
	first any
}

func (s scanFirst) Scan(dest ...any) error { return s.row.Scan(append([]any{s.first}, dest...)...) }

// Trash: what the Trash shows (files and folders trashed on their own), newest first.
// shortcut: no paging, capped at 1000 rows; page it if a workspace ever trashes more within 30 days.
func (q Q) Trash(ctx context.Context, workspaceID string) ([]TrashItem, error) {
	rows, err := q.db.Query(ctx, `SELECT 'file', d.id, d.name, d.content_type, d.size, 0, f.id, f.name, `+retentionSQL+`,
			d.deleted_at, u.id, u.name, `+avatarColumn+`, f.system_kind
		FROM documents d LEFT JOIN document_folders f ON f.id = d.folder_id AND f.deleted_at IS NULL
		LEFT JOIN users u ON u.id = d.deleted_by
		WHERE d.workspace_id = $1 AND d.deleted_at IS NOT NULL AND d.trashed_with IS NULL AND NOT d.hr_private
		UNION ALL
		SELECT 'folder', g.id, g.name, NULL, coalesce((SELECT sum(size) FROM documents WHERE trashed_with = g.id), 0),
			(SELECT count(*) FROM documents WHERE trashed_with = g.id) + (SELECT count(*) FROM document_folders WHERE trashed_with = g.id),
			p.id, p.name, NULL, g.deleted_at, u.id, u.name, `+avatarColumn+`, p.system_kind
		FROM document_folders g LEFT JOIN document_folders p ON p.id = g.parent_id AND p.deleted_at IS NULL
		LEFT JOIN users u ON u.id = g.deleted_by
		WHERE g.workspace_id = $1 AND g.deleted_at IS NOT NULL AND g.trashed_with IS NULL
		ORDER BY 10 DESC, 2 LIMIT 1000`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []TrashItem{}
	for rows.Next() {
		var t TrashItem
		var lid, lname, uid, uname, uavatar, lkind *string
		if err := rows.Scan(&t.Type, &t.ID, &t.Name, &t.ContentType, &t.Size, &t.ItemCount, &lid, &lname, &t.RetainedUntil,
			&t.DeletedAt, &uid, &uname, &uavatar, &lkind); err != nil {
			return nil, err
		}
		if lid != nil {
			t.Location = &FolderRef{ID: *lid, Name: *lname, SystemKind: lkind}
		}
		t.DeletedBy = uploader(uid, uname, uavatar)
		t.PurgeAt = t.DeletedAt.AddDate(0, 0, TrashDays)
		items = append(items, t)
	}
	return items, rows.Err()
}

// ExpiredTrash: the Trash entries of every workspace trashed before cutoff, as (workspace, type, id).
func (q Q) ExpiredTrash(ctx context.Context, cutoff time.Time) ([][3]string, error) {
	rows, err := q.db.Query(ctx, `SELECT workspace_id, 'file', id FROM documents WHERE deleted_at < $1 AND trashed_with IS NULL
		UNION ALL SELECT workspace_id, 'folder', id FROM document_folders WHERE deleted_at < $1 AND trashed_with IS NULL
		LIMIT 1000`, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][3]string
	for rows.Next() {
		var v [3]string
		if err := rows.Scan(&v[0], &v[1], &v[2]); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ---- links ----

// LinkTargetExists: the record a file is to be linked to is in the workspace (and not deleted).
func (q Q) LinkTargetExists(ctx context.Context, workspaceID, targetType, id string) (bool, error) {
	tables := map[string]string{
		"client":  `SELECT EXISTS (SELECT 1 FROM clients WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL)`,
		"invoice": `SELECT EXISTS (SELECT 1 FROM invoices WHERE workspace_id = $1 AND id = $2)`,
		"expense": `SELECT EXISTS (SELECT 1 FROM expenses WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL)`,
	}
	var ok bool
	err := q.db.QueryRow(ctx, tables[targetType], workspaceID, id).Scan(&ok)
	return ok, err
}

func (q Q) AddDocumentLink(ctx context.Context, workspaceID, documentID, targetType, targetID, userID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO document_links (document_id, workspace_id, target_type, target_id, created_by, created_at)
		VALUES ($1, $2, $3, $4, nullif($5, ''), $6) ON CONFLICT DO NOTHING`, documentID, workspaceID, targetType, targetID, userID, now)
	if err != nil {
		return err
	}
	return q.AutoTag(ctx, workspaceID, documentID, now)
}

func (q Q) RemoveDocumentLink(ctx context.Context, workspaceID, documentID, targetType, targetID string, now time.Time) error {
	return q.writeTx(ctx, func(q Q) error {
		if _, err := q.db.Exec(ctx, `DELETE FROM document_links WHERE workspace_id = $1 AND document_id = $2 AND target_type = $3 AND target_id = $4`,
			workspaceID, documentID, targetType, targetID); err != nil {
			return err
		}
		return q.AutoTag(ctx, workspaceID, documentID, now)
	})
}

// UsageRow: the files of one content type, live or in the Trash, and their bytes.
type UsageRow struct {
	ContentType string
	Trashed     bool
	Files       int
	Size        int64
}

// DocumentUsage: the workspace's files grouped by content type and whether they are in the Trash.
func (q Q) DocumentUsage(ctx context.Context, workspaceID string) ([]UsageRow, error) {
	rows, err := q.db.Query(ctx, `SELECT content_type, deleted_at IS NOT NULL, count(*), coalesce(sum(size), 0)
		FROM documents WHERE workspace_id = $1 AND NOT hr_private GROUP BY 1, 2`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UsageRow
	for rows.Next() {
		var u UsageRow
		if err := rows.Scan(&u.ContentType, &u.Trashed, &u.Files, &u.Size); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// ---- HR files ----

// DuplicateEmployeeFile: the employee's live file with these bytes.
func (q Q) DuplicateEmployeeFile(ctx context.Context, workspaceID, employeeID, sum string) (DuplicateUpload, error) {
	d := DuplicateUpload{Resource: "employee_document"}
	err := q.db.QueryRow(ctx, `SELECT id, name FROM documents WHERE workspace_id = $1 AND employee_id = $2 AND sha256 = $3
		AND deleted_at IS NULL LIMIT 1`, workspaceID, employeeID, sum).Scan(&d.ID, &d.Name)
	return d, err
}

// HRFile: one HR file of the workspace (never a general document).
func (q Q) HRFile(ctx context.Context, workspaceID, id string) (Document, error) {
	return scanDocument(q.db.QueryRow(ctx, documentSelect+`WHERE d.workspace_id = $1 AND d.id = $2 AND d.hr_private
		AND d.deleted_at IS NULL`, workspaceID, id))
}

// DeleteHRFile removes an HR file's row and returns its object key.
func (q Q) DeleteHRFile(ctx context.Context, workspaceID, id string) (string, error) {
	return q.taken(ctx, `DELETE FROM documents WHERE workspace_id = $1 AND id = $2 AND hr_private RETURNING object_key`,
		workspaceID, id)
}
