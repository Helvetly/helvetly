package store

import (
	"context"
	"time"
)

// EnableAdminAlerts must be called at startup before running queries.
func (s *Store) EnableAdminAlerts() { s.adminAlerts = true }

func (q Q) QueueAdminAlert(ctx context.Context, message string) error {
	if !q.adminAlerts {
		return nil
	}
	_, err := q.db.Exec(ctx, `INSERT INTO admin_alerts (message) VALUES ($1)`, message)
	return err
}

// ClaimAdminAlert leases a due message without holding a transaction open during delivery.
func (q Q) ClaimAdminAlert(ctx context.Context) (id int64, message string, err error) {
	err = q.db.QueryRow(ctx, `WITH expired AS (
		DELETE FROM admin_alerts WHERE created_at <= now() - interval '7 days'
	)
	UPDATE admin_alerts SET ready_at = now() + interval '1 minute' WHERE id = (
		SELECT id FROM admin_alerts WHERE ready_at <= now() AND created_at > now() - interval '7 days'
		ORDER BY ready_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
	) RETURNING id, message`).Scan(&id, &message)
	return
}

func (q Q) RetryAdminAlert(ctx context.Context, id int64, delay time.Duration) error {
	_, err := q.db.Exec(ctx, `UPDATE admin_alerts SET ready_at = now() + $2 * interval '1 second' WHERE id = $1`, id, delay.Seconds())
	return err
}

func (q Q) CompleteAdminAlert(ctx context.Context, id int64) error {
	_, err := q.db.Exec(ctx, `DELETE FROM admin_alerts WHERE id = $1`, id)
	return err
}
