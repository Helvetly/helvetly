package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

// Deleted workspaces: restoring them within the window and their archive backups (internal/workspaces, dataexport).

// WorkspaceDeletion is one deletion of a workspace the person can still restore.
type WorkspaceDeletion struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Name        string    `json:"name"`
	DeletedAt   time.Time `json:"deleted_at"`
}

// liveDeletion: the deletion that left the workspace deleted (not an older one before a restore), by $by, after $since.
const liveDeletion = `FROM workspace_deletions d JOIN workspaces w ON w.id = d.workspace_id
	WHERE d.deleted_by = $1 AND d.restored_at IS NULL AND d.deleted_at > $2 AND w.deleted_at = d.deleted_at`

// DeletedWorkspaces: the workspaces userID deleted after since that are still deleted, newest first.
func (s *Store) DeletedWorkspaces(ctx context.Context, userID string, since time.Time) ([]WorkspaceDeletion, error) {
	rows, err := s.pool.Query(ctx, `SELECT d.id, d.workspace_id, w.name, d.deleted_at `+liveDeletion+`
		ORDER BY d.deleted_at DESC`, userID, since)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[WorkspaceDeletion])
}

// RestoreWorkspace makes the workspace of userID's deletion id (made after since) live again with the members it had
// whose accounts still exist; ErrNotFound when there is no such deletion. It returns the workspace id.
func (q Q) RestoreWorkspace(ctx context.Context, id, userID string, since, now time.Time) (string, error) {
	var workspaceID string
	var members json.RawMessage
	err := q.db.QueryRow(ctx, `SELECT d.workspace_id, d.members `+liveDeletion+` AND d.id = $3 FOR UPDATE OF d, w`,
		userID, since, id).Scan(&workspaceID, &members)
	if err != nil {
		return "", err
	}
	_, err = q.db.Exec(ctx, `WITH
			w AS (UPDATE workspaces SET deleted_at = NULL WHERE id = $1),
			d AS (UPDATE workspace_deletions SET restored_at = $3 WHERE id = $2)
		INSERT INTO workspace_members SELECT m.* FROM jsonb_populate_recordset(NULL::workspace_members, $4) m
			JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
		ON CONFLICT DO NOTHING`, workspaceID, id, now, members)
	return workspaceID, err
}

// PendingBackup is a deletion whose archive is not stored yet.
type PendingBackup struct {
	ID          string
	WorkspaceID string
	Name        string
	Members     json.RawMessage
	DeletedBy   string
	DeletedAt   time.Time
}

// PendingBackups: current deletions without a stored archive that were not tried since retryAfter, oldest first.
func (s *Store) PendingBackups(ctx context.Context, retryAfter time.Time, limit int) ([]PendingBackup, error) {
	rows, err := s.pool.Query(ctx, `SELECT d.id, d.workspace_id, w.name, d.members, d.deleted_by, d.deleted_at
		FROM workspace_deletions d JOIN workspaces w ON w.id = d.workspace_id
		WHERE d.restored_at IS NULL AND w.deleted_at = d.deleted_at AND d.backed_up_at IS NULL
			AND (d.backup_tried_at IS NULL OR d.backup_tried_at < $1) ORDER BY d.deleted_at LIMIT $2`,
		retryAfter, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[PendingBackup])
}

// LockPendingBackup rechecks a deletion before its archive leaves the process, serializing with a restore.
func (q Q) LockPendingBackup(ctx context.Context, d PendingBackup) error {
	var id string
	return q.db.QueryRow(ctx, `SELECT d.id FROM workspace_deletions d JOIN workspaces w ON w.id = d.workspace_id
		WHERE d.id = $1 AND d.workspace_id = $2 AND d.restored_at IS NULL
			AND w.deleted_at = d.deleted_at AND d.backed_up_at IS NULL FOR UPDATE OF d, w`,
		d.ID, d.WorkspaceID).Scan(&id)
}

// BackupStored records the deletion's archive object.
func (q Q) BackupStored(ctx context.Context, id, key string, size int64, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_deletions SET backup_key = $2, backup_size = $3, backed_up_at = $4,
		backup_tried_at = $4, backup_error = NULL WHERE id = $1`, id, key, size, now)
	return err
}

// BackupFailed records why the archive could not be stored; the job tries again later.
func (s *Store) BackupFailed(ctx context.Context, id, reason string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE workspace_deletions SET backup_tried_at = $2, backup_error = $3 WHERE id = $1`,
		id, now, reason)
	return err
}
