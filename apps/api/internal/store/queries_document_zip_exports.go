package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ZipExport: a member's ZIP of a Documents view, built in the background (documents/zip_exports.go).
type ZipExport struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"-"`
	UserID      string     `json:"-"`
	Query       string     `json:"-"` // the view's filters, as the list's query string
	Zone        string     `json:"-"`
	Name        string     `json:"name"`
	Status      string     `json:"status"` // pending, ready, failed
	Attempts    int        `json:"-"`
	ObjectKey   string     `json:"-"`
	Files       int        `json:"files"`
	Bytes       int64      `json:"bytes"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   *time.Time `json:"expires_at"`
}

const zipExportCols = `id, workspace_id, user_id, query, zone, name, status, attempts, coalesce(object_key, ''), files, bytes,
	created_at, expires_at`

func scanZipExport(row pgx.Row) (ZipExport, error) {
	var e ZipExport
	err := row.Scan(&e.ID, &e.WorkspaceID, &e.UserID, &e.Query, &e.Zone, &e.Name, &e.Status, &e.Attempts, &e.ObjectKey,
		&e.Files, &e.Bytes, &e.CreatedAt, &e.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return e, ErrNotFound
	}
	return e, err
}

// QueueZipExport adds a pending export, unless the member already has one pending in the workspace (false); the
// unique index document_zip_exports_one_pending decides between two submits at once.
func (q Q) QueueZipExport(ctx context.Context, e ZipExport) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO document_zip_exports (id, workspace_id, user_id, query, zone, name, files, bytes, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (workspace_id, user_id) WHERE status = 'pending' DO NOTHING`,
		e.ID, e.WorkspaceID, e.UserID, e.Query, e.Zone, e.Name, e.Files, e.Bytes, e.CreatedAt)
	return tag.RowsAffected() == 1, err
}

// ZipExports: the member's exports in the workspace still worth showing (pending, ready and not expired, or failed
// within a day), newest first.
func (q Q) ZipExports(ctx context.Context, workspaceID, userID string, now time.Time) ([]ZipExport, error) {
	rows, err := q.db.Query(ctx, `SELECT `+zipExportCols+` FROM document_zip_exports
		WHERE workspace_id = $1 AND user_id = $2 AND (status = 'pending' OR (status = 'ready' AND expires_at > $3)
			OR (status = 'failed' AND finished_at > $3 - interval '1 day'))
		ORDER BY created_at DESC LIMIT 10`, workspaceID, userID, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ZipExport, error) { return scanZipExport(r) })
}

// ZipExport: one of the member's exports in the workspace.
func (q Q) ZipExport(ctx context.Context, workspaceID, userID, id string) (ZipExport, error) {
	return scanZipExport(q.db.QueryRow(ctx, `SELECT `+zipExportCols+` FROM document_zip_exports
		WHERE workspace_id = $1 AND user_id = $2 AND id = $3`, workspaceID, userID, id))
}

// ClaimZipExport takes the oldest due pending export of a live workspace with no other export being built, for
// lease; run it in a transaction. The claims take turns on one advisory lock, so two instances never build two
// exports of one workspace at once; ErrNotFound when nothing is due.
func (q Q) ClaimZipExport(ctx context.Context, now time.Time, lease time.Duration) (ZipExport, error) {
	if _, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('document_zip_exports.claim'))`); err != nil {
		return ZipExport{}, err
	}
	return scanZipExport(q.db.QueryRow(ctx, `UPDATE document_zip_exports SET claimed_until = $2, attempts = attempts + 1
		WHERE id = (SELECT e.id FROM document_zip_exports e JOIN workspaces w ON w.id = e.workspace_id AND w.deleted_at IS NULL
			WHERE e.status = 'pending' AND (e.claimed_until IS NULL OR e.claimed_until <= $1)
				AND NOT EXISTS (SELECT 1 FROM document_zip_exports b WHERE b.workspace_id = e.workspace_id
					AND b.status = 'pending' AND b.claimed_until > $1)
			ORDER BY e.created_at LIMIT 1 FOR UPDATE OF e SKIP LOCKED)
		RETURNING `+zipExportCols, now, now.Add(lease)))
}

// FinishZipExport records a claimed export as ready (key set, until expires) or failed (key ""); false when it is
// no longer pending (its workspace or member went away meanwhile).
func (q Q) FinishZipExport(ctx context.Context, id, key string, files int, bytes int64, now, expires time.Time) (bool, error) {
	status := "ready"
	if key == "" {
		status = "failed"
	}
	tag, err := q.db.Exec(ctx, `UPDATE document_zip_exports SET status = $2, object_key = nullif($3, ''), files = $4, bytes = $5,
			finished_at = $6, expires_at = CASE WHEN $2 = 'ready' THEN $7::timestamptz END, claimed_until = NULL
		WHERE id = $1 AND status = 'pending'`, id, status, key, files, bytes, now, expires)
	return tag.RowsAffected() == 1, err
}

// StaleZipExports: exports to delete with their objects: ready ones past their expiry, failed ones older than a day,
// and every one of a deleted workspace or of someone no longer its member.
func (q Q) StaleZipExports(ctx context.Context, now time.Time) ([]ZipExport, error) {
	rows, err := q.db.Query(ctx, `SELECT `+zipExportCols+` FROM document_zip_exports e
		WHERE (e.status = 'ready' AND e.expires_at <= $1) OR (e.status = 'failed' AND e.finished_at <= $1 - interval '1 day')
			OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = e.workspace_id AND w.deleted_at IS NOT NULL)
			OR NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = e.workspace_id AND m.user_id = e.user_id)
		LIMIT 500`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ZipExport, error) { return scanZipExport(r) })
}

// DeleteZipExport removes an export's row, once its object is gone.
func (q Q) DeleteZipExport(ctx context.Context, id string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM document_zip_exports WHERE id = $1`, id)
	return err
}
