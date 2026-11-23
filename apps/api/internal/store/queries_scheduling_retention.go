package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// CancelClientSessions cancels the open sessions of deleted clients that have not started (cancelled_on_time, not
// counted, sequence + 1) and expires their open requests. Nobody is emailed: the caller tells no one. It returns the
// cancelled occurrences, whose pushed calendar entries the caller removes. Past sessions stay with the client's
// other records.
func (q Q) CancelClientSessions(ctx context.Context, workspaceID string, clientIDs []string, now time.Time) ([]string, error) {
	rows, err := q.db.Query(ctx, `UPDATE scheduling_occurrences SET status = 'cancelled_on_time', late = false,
		sequence = sequence + 1, status_changed_by = NULL, status_changed_at = $3, updated_at = $3
		WHERE workspace_id = $1 AND client_id = ANY ($2) AND starts_at > $3 AND status IN ('requested', 'scheduled', 'rescheduled')
		RETURNING id`, workspaceID, nonNil(clientIDs), now)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(ids) == 0 {
		return ids, err
	}
	_, err = q.db.Exec(ctx, `UPDATE scheduling_requests SET status = 'expired', decided_at = $3
		WHERE workspace_id = $1 AND occurrence_id = ANY ($2) AND status IN ('pending', 'proposed')`, workspaceID, ids, now)
	return ids, err
}
