package store

import (
	"context"
	"time"
)

// Filing is what AI filing did with a file, as the file shows it: queued, filed (Folder is where it went, nil when it
// stayed or that folder is gone), skipped (nothing changed) or undone.
type Filing struct {
	Status        string     `json:"status"`
	Folder        *FolderRef `json:"folder"`
	CreatedFolder bool       `json:"created_folder"`
	Tags          []string   `json:"tags"`
}

// FilingJob is a claimed filing: the file, whose AI approval gates it, and whether it may be moved.
type FilingJob struct {
	DocumentID, WorkspaceID, UserID string
	MayMove                         bool
	Attempts                        int
}

// FilingRecord is a finished filing's undo record.
type FilingRecord struct {
	Status, UserID         string
	FromFolderID, FolderID *string
	CreatedFolder          bool
	Tags                   []string
}

// QueueFiling queues AI filing of a new file (once).
func (q Q) QueueFiling(ctx context.Context, workspaceID, documentID, userID string, mayMove bool, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO document_filings (document_id, workspace_id, user_id, may_move, status, due_at, created_at)
		VALUES ($1, $2, $3, $4, 'queued', $5, $5) ON CONFLICT DO NOTHING`, documentID, workspaceID, userID, mayMove, now)
	return err
}

// ClaimFilings takes up to n due filings, pushing each ahead by lease so concurrent instances skip it and a claim
// whose instance died comes due again. A workspace whose import is still reading files waits: filing and the import
// share one AI pool with one call in flight per workspace, and the person is watching the import.
func (q Q) ClaimFilings(ctx context.Context, now time.Time, lease time.Duration, n int) ([]FilingJob, error) {
	rows, err := q.db.Query(ctx, `UPDATE document_filings SET attempts = attempts + 1, due_at = $2
		WHERE document_id IN (SELECT d.document_id FROM document_filings d WHERE d.status = 'queued' AND d.due_at <= $1
			AND NOT EXISTS (SELECT 1 FROM import_files f WHERE f.workspace_id = d.workspace_id
				AND f.status IN ('queued', 'extracting'))
			ORDER BY d.due_at LIMIT $3 FOR UPDATE OF d SKIP LOCKED)
		RETURNING document_id, workspace_id, user_id, may_move, attempts`, now, now.Add(lease), n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FilingJob
	for rows.Next() {
		var j FilingJob
		if err := rows.Scan(&j.DocumentID, &j.WorkspaceID, &j.UserID, &j.MayMove, &j.Attempts); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// DeferFiling makes a queued filing due again at next without counting its claim as a try: it waited for its
// workspace's model pool and never ran.
func (q Q) DeferFiling(ctx context.Context, documentID string, next time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE document_filings SET due_at = $2, attempts = greatest(attempts - 1, 0)
		WHERE document_id = $1 AND status = 'queued'`, documentID, next)
	return err
}

// RetryFiling makes a queued filing due again at next.
func (q Q) RetryFiling(ctx context.Context, documentID string, next time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE document_filings SET due_at = $2 WHERE document_id = $1 AND status = 'queued'`, documentID, next)
	return err
}

// FinishFiling records a queued filing's outcome: skipped, or filed with what it changed.
func (q Q) FinishFiling(ctx context.Context, documentID string, r FilingRecord, now time.Time) error {
	if r.Tags == nil {
		r.Tags = []string{}
	}
	_, err := q.db.Exec(ctx, `UPDATE document_filings SET status = $2, from_folder_id = $3, folder_id = $4, created_folder = $5,
		tags = $6, finished_at = $7 WHERE document_id = $1 AND status = 'queued'`,
		documentID, r.Status, r.FromFolderID, r.FolderID, r.CreatedFolder, r.Tags, now)
	return err
}

// LockFiling: the file's filing record, locked until the transaction ends.
func (q Q) LockFiling(ctx context.Context, workspaceID, documentID string) (FilingRecord, error) {
	var r FilingRecord
	err := q.db.QueryRow(ctx, `SELECT status, user_id, from_folder_id, folder_id, created_folder, tags FROM document_filings
		WHERE workspace_id = $1 AND document_id = $2 FOR UPDATE`, workspaceID, documentID).
		Scan(&r.Status, &r.UserID, &r.FromFolderID, &r.FolderID, &r.CreatedFolder, &r.Tags)
	return r, err
}

// UndoFiling marks a filed file as undone.
func (q Q) UndoFiling(ctx context.Context, documentID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE document_filings SET status = 'undone', finished_at = $2 WHERE document_id = $1`, documentID, now)
	return err
}

// DocumentTags: the workspace's tags in use on live files, most used first, at most limit.
func (q Q) DocumentTags(ctx context.Context, workspaceID string, limit int) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT t FROM documents, unnest(tags) t WHERE workspace_id = $1 AND deleted_at IS NULL
		AND NOT hr_private GROUP BY t ORDER BY count(*) DESC, t LIMIT $2`, workspaceID, limit)
	if err != nil {
		return nil, err
	}
	return collect(rows)
}

// DeleteEmptyFiledFolder deletes a folder AI filing made once nothing is in it, not even in the Trash; false when
// something is.
func (q Q) DeleteEmptyFiledFolder(ctx context.Context, workspaceID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM document_folders f WHERE f.workspace_id = $1 AND f.id = $2 AND f.deleted_at IS NULL AND f.system_kind IS NULL
		AND NOT EXISTS (SELECT 1 FROM documents WHERE folder_id = f.id)
		AND NOT EXISTS (SELECT 1 FROM document_folders c WHERE c.parent_id = f.id)
		AND EXISTS (SELECT 1 FROM document_filings ff WHERE ff.folder_id = f.id AND ff.created_folder)`, workspaceID, id)
	return tag.RowsAffected() > 0, err
}

// OrganizeDocuments: up to limit live files for AI organizing, within folderIDs when not nil; files without a folder or
// tags first, oldest first.
func (q Q) OrganizeDocuments(ctx context.Context, workspaceID string, folderIDs []string, limit int) ([]Document, error) {
	rows, err := q.db.Query(ctx, documentSelect+`WHERE d.workspace_id = $1 AND d.deleted_at IS NULL AND NOT d.hr_private
		AND ($2::text[] IS NULL OR d.folder_id = ANY($2))
		ORDER BY (d.folder_id IS NULL OR cardinality(d.tags) = 0) DESC, d.created_at, d.id LIMIT $3`, workspaceID, folderIDs, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	docs := []Document{}
	for rows.Next() {
		d, err := scanDocument(rows)
		if err != nil {
			return nil, err
		}
		docs = append(docs, d)
	}
	return docs, rows.Err()
}

// DeleteEmptyFolder deletes a live folder once nothing is in it, not even in the Trash; false when something is.
func (q Q) DeleteEmptyFolder(ctx context.Context, workspaceID, id string) (bool, error) {
	tag, err := q.db.Exec(ctx, `DELETE FROM document_folders f WHERE f.workspace_id = $1 AND f.id = $2 AND f.deleted_at IS NULL AND f.system_kind IS NULL
		AND NOT EXISTS (SELECT 1 FROM documents WHERE folder_id = f.id)
		AND NOT EXISTS (SELECT 1 FROM document_folders c WHERE c.parent_id = f.id)`, workspaceID, id)
	return tag.RowsAffected() > 0, err
}
