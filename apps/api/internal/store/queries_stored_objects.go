package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ReserveObject counts the object about to be written at key against the workspace's storage_bytes, in q's
// transaction (or its own), before the PUT: size is the object's actual byte count. admit checks the plan's cap
// first, for new growth a person asks for (uploads, copies, generated files); without it the bytes are counted but
// never refused, for records the business must keep (an issued invoice's PDF and XML, a sent quote's PDF, a signed
// result). Writing the same key again counts only the difference. Storage releases the row once the object is
// deleted (ObjectDeleted); a PUT that never happened is dropped by the reconciler.
func (q Q) ReserveObject(ctx context.Context, workspaceID, key string, size int64, admit bool, now time.Time) error {
	return q.writeTx(ctx, func(q Q) error {
		var old int64
		err := q.db.QueryRow(ctx, `SELECT size FROM stored_objects WHERE object_key = $1`, key).Scan(&old)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if admit && size > old {
			if err := q.Admit(ctx, workspaceID, "storage_bytes", size-old); err != nil {
				return err
			}
		}
		_, err = q.db.Exec(ctx, `INSERT INTO stored_objects (object_key, workspace_id, size, created_at) VALUES ($1, $2, $3, $4)
			ON CONFLICT (object_key) DO UPDATE SET size = excluded.size,
				verified_at = CASE WHEN stored_objects.size = excluded.size THEN stored_objects.verified_at END`, key, workspaceID, size, now)
		return err
	})
}

// StoredBytes is what the workspace keeps in storage: every object counted for it and not yet deleted.
func (q Q) StoredBytes(ctx context.Context, workspaceID string) (int64, error) {
	var n int64
	err := q.db.QueryRow(ctx, `SELECT coalesce(sum(size), 0) FROM stored_objects WHERE workspace_id = $1`, workspaceID).Scan(&n)
	return n, err
}

// ---- storage.Registry: what storage confirmed ----

// ObjectStored records the size storage reported for a written object; a key no workspace counts is left alone, and
// so is a row the writer's own transaction still holds (it would wait on itself): the reconciler confirms that one.
func (s *Store) ObjectStored(ctx context.Context, key string, size int64, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE stored_objects SET size = $2, verified_at = $3
		WHERE object_key = (SELECT object_key FROM stored_objects WHERE object_key = $1 FOR UPDATE SKIP LOCKED)`, key, size, at)
	return err
}

// ObjectDeleted releases a deleted object's bytes, once storage confirmed the delete.
func (s *Store) ObjectDeleted(ctx context.Context, key string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM stored_objects WHERE object_key = $1`, key)
	return err
}

// UnverifiedObjects are counted objects reserved before before whose PUT storage never confirmed (a crash, a failed
// PUT, a row backfilled from an older record), for the reconciler to look up.
func (s *Store) UnverifiedObjects(ctx context.Context, before time.Time, limit int) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT object_key FROM stored_objects WHERE verified_at IS NULL AND created_at < $1
		ORDER BY created_at LIMIT $2`, before, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
