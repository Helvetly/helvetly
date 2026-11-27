package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

// StagedUpload is a file uploaded but not yet placed (migration 00087): never a Document until it is confirmed.
type StagedUpload struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"-"`
	UserID      string    `json:"-"`
	Purpose     string    `json:"-"` // documents | import
	BatchID     string    `json:"batch_id"`
	Name        string    `json:"name"`
	Size        int64     `json:"size"`
	ContentType string    `json:"content_type"`
	SHA256      string    `json:"-"`
	ObjectKey   string    `json:"-"`
	CreatedAt   time.Time `json:"created_at"`
}

// StagedExpiry: a staged file nobody confirmed is deleted this long after its upload.
const StagedExpiry = 24 * time.Hour

const stagedColumns = `id, workspace_id, user_id, purpose, batch_id, name, size, content_type, sha256, object_key, created_at`

// stagedInOpenImport: staged row s is the source of an import still being read or reviewed (a file queued or being
// read, a record neither created nor skipped); the import's own expiry discards it.
const stagedInOpenImport = `EXISTS (SELECT 1 FROM import_files f WHERE f.workspace_id = s.workspace_id AND f.object_key = s.object_key
	AND (EXISTS (SELECT 1 FROM import_records r WHERE r.batch_id = f.batch_id AND r.status NOT IN ('created', 'skipped'))
		OR EXISTS (SELECT 1 FROM import_files g WHERE g.batch_id = f.batch_id AND g.status IN ('queued', 'extracting'))))`

// CreateStagedUpload records a staged file whose object is already counted (ReserveObject) and stored.
func (q Q) CreateStagedUpload(ctx context.Context, u StagedUpload) error {
	_, err := q.db.Exec(ctx, `INSERT INTO staged_uploads (`+stagedColumns+`) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		u.ID, u.WorkspaceID, u.UserID, u.Purpose, u.BatchID, u.Name, u.Size, u.ContentType, u.SHA256, u.ObjectKey, u.CreatedAt)
	return err
}

func collectStaged(rows pgx.Rows, err error) ([]StagedUpload, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (StagedUpload, error) {
		var u StagedUpload
		err := row.Scan(&u.ID, &u.WorkspaceID, &u.UserID, &u.Purpose, &u.BatchID, &u.Name, &u.Size, &u.ContentType,
			&u.SHA256, &u.ObjectKey, &u.CreatedAt)
		return u, err
	})
}

// StagedBatch is the member's own staged Documents files of batch, oldest first; lock takes their rows for update
// (in a transaction).
func (q Q) StagedBatch(ctx context.Context, workspaceID, userID, batchID string, lock bool) ([]StagedUpload, error) {
	sql := `SELECT ` + stagedColumns + ` FROM staged_uploads WHERE workspace_id = $1 AND user_id = $2 AND batch_id = $3
		AND purpose = 'documents' ORDER BY created_at, id`
	if lock {
		sql += ` FOR UPDATE`
	}
	return collectStaged(q.db.Query(ctx, sql, workspaceID, userID, batchID))
}

// StagedInBatch: the name of the member's staged file of batch with these bytes, "" when none.
func (q Q) StagedInBatch(ctx context.Context, workspaceID, userID, batchID, sum string) (string, error) {
	var name string
	err := q.db.QueryRow(ctx, `SELECT name FROM staged_uploads WHERE workspace_id = $1 AND user_id = $2 AND batch_id = $3
		AND purpose = 'documents' AND sha256 = $4 ORDER BY created_at LIMIT 1`, workspaceID, userID, batchID, sum).Scan(&name)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return name, err
}

// DeleteStaged removes staged rows by id (the workspace's only) and returns their object keys, for the caller to
// delete once q commits; a row confirmed into a Document keeps its object.
func (q Q) DeleteStaged(ctx context.Context, workspaceID string, ids []string) ([]string, error) {
	rows, err := q.db.Query(ctx, `DELETE FROM staged_uploads WHERE workspace_id = $1 AND id = ANY($2) RETURNING object_key`, workspaceID, ids)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// ForgetStaged drops staged rows whose files became Documents (same object), keeping the objects.
func (q Q) ForgetStaged(ctx context.Context, workspaceID string, ids []string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM staged_uploads WHERE workspace_id = $1 AND id = ANY($2)`, workspaceID, ids)
	return err
}

// DropImportSources deletes the staged sources of an import batch that no open import still reads, returning their
// object keys to delete after the commit.
func (q Q) DropImportSources(ctx context.Context, workspaceID, batchID string) ([]string, error) {
	rows, err := q.db.Query(ctx, `DELETE FROM staged_uploads s WHERE s.workspace_id = $1 AND s.batch_id = $2
		AND s.purpose = 'import' AND NOT `+stagedInOpenImport+` RETURNING s.object_key`, workspaceID, batchID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// TakeImportSource turns the staged source at key into the Document it becomes, returning it with the row gone: its
// object is kept (and stays counted). ErrNotFound when the key is no staged file of the workspace.
func (q Q) TakeImportSource(ctx context.Context, workspaceID, key string) (StagedUpload, error) {
	list, err := collectStaged(q.db.Query(ctx, `DELETE FROM staged_uploads WHERE workspace_id = $1 AND object_key = $2
		AND purpose = 'import' RETURNING `+stagedColumns, workspaceID, key))
	if err != nil {
		return StagedUpload{}, err
	}
	if len(list) == 0 {
		return StagedUpload{}, ErrNotFound
	}
	return list[0], nil
}

// DocumentAt: the live Document stored at key, for an import source another record of the same file already made one.
func (q Q) DocumentAt(ctx context.Context, workspaceID, key string) (string, error) {
	var id string
	err := q.db.QueryRow(ctx, `SELECT id FROM documents WHERE workspace_id = $1 AND object_key = $2 AND deleted_at IS NULL
		AND NOT hr_private ORDER BY created_at LIMIT 1`, workspaceID, key).Scan(&id)
	return id, err
}

// ClaimExpiredStaged deletes up to limit staged rows uploaded before before (skipping open imports' sources and rows
// another instance holds), returning their object keys for the caller to delete.
func (s *Store) ClaimExpiredStaged(ctx context.Context, before time.Time, limit int) ([]string, error) {
	rows, err := s.pool.Query(ctx, `DELETE FROM staged_uploads WHERE id IN (SELECT s.id FROM staged_uploads s
		WHERE s.created_at < $1 AND NOT `+stagedInOpenImport+` ORDER BY s.created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
		RETURNING object_key`, before, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// legacySource: a Document an earlier import stored as its source (a ZIP or CSV file, not an entry) that is nobody's
// record and that nobody placed, tagged, linked, shared or reused since: the import kept it only to read it.
const legacySource = `d.deleted_at IS NULL AND NOT d.hr_private AND d.employee_id IS NULL AND d.folder_id IS NULL
	AND d.content_type IN ('application/zip', 'text/csv') AND d.filed_kind IS NULL AND d.tags <@ d.auto_tags
	AND EXISTS (SELECT 1 FROM import_files f WHERE f.workspace_id = d.workspace_id AND f.document_id = d.id AND f.entry_index IS NULL)
	AND NOT EXISTS (SELECT 1 FROM import_files f WHERE f.workspace_id = d.workspace_id AND f.object_key = d.object_key
		AND (EXISTS (SELECT 1 FROM import_records r WHERE r.batch_id = f.batch_id AND r.status NOT IN ('created', 'skipped'))
			OR EXISTS (SELECT 1 FROM import_files g WHERE g.batch_id = f.batch_id AND g.status IN ('queued', 'extracting'))))
	AND NOT EXISTS (SELECT 1 FROM documents x WHERE x.object_key = d.object_key AND x.id <> d.id)
	AND NOT EXISTS (SELECT 1 FROM document_links x WHERE x.document_id = d.id)
	AND NOT EXISTS (SELECT 1 FROM document_shares x WHERE x.document_id = d.id)
	AND NOT EXISTS (SELECT 1 FROM document_participant_shares x WHERE x.document_id = d.id)
	AND NOT EXISTS (SELECT 1 FROM document_share_links x WHERE x.document_id = d.id)
	AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.workspace_id = d.workspace_id AND (x.source_document_id = d.id OR x.pdf_key = d.object_key))
	AND NOT EXISTS (SELECT 1 FROM quotes x WHERE x.workspace_id = d.workspace_id AND x.pdf_key = d.object_key)
	AND NOT EXISTS (SELECT 1 FROM quote_contracts x WHERE x.workspace_id = d.workspace_id AND x.document_id = d.id)
	AND NOT EXISTS (SELECT 1 FROM signature_requests x WHERE x.workspace_id = d.workspace_id AND (x.document_id = d.id OR x.signed_document_id = d.id OR x.original_key = d.object_key))
	AND NOT EXISTS (SELECT 1 FROM engagements x WHERE x.workspace_id = d.workspace_id AND x.document_id = d.id)
	AND NOT EXISTS (SELECT 1 FROM templates x WHERE x.workspace_id = d.workspace_id AND x.document_id = d.id)
	AND NOT EXISTS (SELECT 1 FROM expense_receipts x WHERE x.workspace_id = d.workspace_id AND x.object_key = d.object_key)`

// LegacySourceWorkspaces: the workspaces with Documents earlier imports kept only as their source (legacySource).
func (q Q) LegacySourceWorkspaces(ctx context.Context) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT DISTINCT d.workspace_id FROM documents d
		JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL WHERE `+legacySource+` ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// StageLegacySources takes a workspace's Documents earlier imports kept only as their source out of Documents into
// the staging area (dated now, so the staged expiry deletes their objects a day later), with a
// documents.import_sources_removed audit entry naming them. Run it in a transaction; idempotent.
func (q Q) StageLegacySources(ctx context.Context, workspaceID string, now time.Time) (int, error) {
	rows, err := q.db.Query(ctx, `WITH moved AS (
			DELETE FROM documents d WHERE d.workspace_id = $1 AND `+legacySource+`
			RETURNING d.id, d.workspace_id, coalesce(d.uploaded_by, '') AS uploaded_by, d.name, d.size, d.content_type,
				coalesce(d.sha256, '') AS sha256, d.object_key)
		INSERT INTO staged_uploads (`+stagedColumns+`)
		SELECT id, workspace_id, uploaded_by, 'import', 'legacy', name, size, content_type, sha256, object_key, $2 FROM moved
		RETURNING id, name`, workspaceID, now)
	if err != nil {
		return 0, err
	}
	type file struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	files, err := pgx.CollectRows(rows, pgx.RowToStructByPos[file])
	if err != nil || len(files) == 0 {
		return 0, err
	}
	payload, err := json.Marshal(map[string]any{"count": len(files), "files": files})
	if err != nil {
		return 0, err
	}
	return len(files), q.LogEvent(ctx, FinancialEvent{WorkspaceID: workspaceID, Kind: "documents.import_sources_removed",
		SubjectType: "workspace", SubjectID: workspaceID, At: now, Payload: payload})
}
