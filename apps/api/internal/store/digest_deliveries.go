package store

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type DigestBody struct{ Subject, Text, HTML string }

// QueueDigest snapshots one batch for the managers eligible when its notices or day were claimed.
func (q Q) QueueDigest(ctx context.Context, workspaceID, occurrence string, users []UserRef, message DigestBody) error {
	for _, user := range users {
		if _, err := q.db.Exec(ctx, `INSERT INTO digest_deliveries(workspace_id, occurrence, user_id, message)
            VALUES ($1, $2, $3, $4)`, workspaceID, occurrence, user.ID, message); err != nil {
			return err
		}
	}
	return nil
}

type DigestDelivery struct{ Occurrence, UserID string }

func (q Q) PendingDigestDeliveries(ctx context.Context, workspaceID string) ([]DigestDelivery, error) {
	rows, err := q.db.Query(ctx, `SELECT d.occurrence, d.user_id FROM digest_deliveries d
        JOIN workspace_members m USING (workspace_id, user_id)
        WHERE d.workspace_id = $1 AND d.state = 'pending' AND m.role IN ('owner', 'admin')
        ORDER BY d.occurrence, d.user_id`, workspaceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[DigestDelivery])
}

// An interrupted send stays uncertain. Only a definite refusal can put it back in the queue.
func (q Q) ClaimDigestDelivery(ctx context.Context, workspaceID string, d DigestDelivery) (email string, message DigestBody, err error) {
	err = q.db.QueryRow(ctx, `UPDATE digest_deliveries d SET state = 'uncertain'
        FROM workspace_members m JOIN users u ON u.id = m.user_id JOIN workspaces w ON w.id = m.workspace_id
        WHERE d.workspace_id = $1 AND d.occurrence = $2 AND d.user_id = $3 AND d.state = 'pending'
          AND m.workspace_id = d.workspace_id AND m.user_id = d.user_id AND m.role IN ('owner', 'admin')
          AND w.deleted_at IS NULL AND coalesce((SELECT digest FROM engagement_settings WHERE workspace_id = w.id), true)
        RETURNING u.email, d.message`, workspaceID, d.Occurrence, d.UserID).Scan(&email, &message)
	return
}

func (q Q) FinishDigestDelivery(ctx context.Context, workspaceID string, d DigestDelivery, state string) error {
	_, err := q.db.Exec(ctx, `UPDATE digest_deliveries SET state = $4, message = CASE WHEN $4 = 'pending' THEN message END
        WHERE workspace_id = $1 AND occurrence = $2 AND user_id = $3 AND state = 'uncertain'`, workspaceID, d.Occurrence, d.UserID, state)
	return err
}
