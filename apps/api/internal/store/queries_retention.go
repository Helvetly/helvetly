package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// RetentionGrace: how long the request that committed a record has to lock its object before the job may take over.
const RetentionGrace = 5 * time.Minute

// Retention statuses (object_retention.status).
const (
	RetentionNotRequested = "not_requested"
	RetentionPending      = "pending"
	RetentionFailed       = "failed"
	RetentionConfirmed    = "confirmed"
)

// RetentionRequest is what a business record asks of its object: Mode "" means protection is off (not_requested).
// Until is the business deadline, nil when unknown.
type RetentionRequest struct {
	WorkspaceID, Key, Mode string
	Until                  *time.Time
}

// RequestRetention records, in the caller's transaction, the protection key needs once that transaction commits. A
// row made while protection was off is upgraded to pending when it is requested again with a mode (the backfill); a
// later deadline (a signature's original once it is signed) extends the request, and the job then extends the lock.
// A deadline is never shortened.
func (q Q) RequestRetention(ctx context.Context, r RetentionRequest, now time.Time) error {
	status, mode, next := RetentionNotRequested, (*string)(nil), (*time.Time)(nil)
	if r.Mode != "" {
		at := now.Add(RetentionGrace)
		status, mode, next = RetentionPending, &r.Mode, &at
	}
	_, err := q.db.Exec(ctx, `INSERT INTO object_retention (object_key, workspace_id, status, requested_at, requested_until,
			requested_mode, next_attempt_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (object_key) DO UPDATE SET
			status = CASE WHEN object_retention.status = 'not_requested' THEN excluded.status ELSE object_retention.status END,
			requested_mode = coalesce(object_retention.requested_mode, excluded.requested_mode),
			requested_until = greatest(object_retention.requested_until, excluded.requested_until),
			next_attempt_at = coalesce(excluded.next_attempt_at, object_retention.next_attempt_at)
		WHERE object_retention.workspace_id = excluded.workspace_id
			AND ((object_retention.status = 'not_requested' AND excluded.status = 'pending')
				OR excluded.requested_until > coalesce(object_retention.requested_until, '-infinity'))`,
		r.Key, r.WorkspaceID, status, now, r.Until, mode, next)
	return err
}

// ObjectRetention is one object's protection row.
type ObjectRetention struct {
	Key, WorkspaceID, Status string
	RequestedAt              time.Time
	RequestedUntil           *time.Time
	RequestedMode            *string
	VersionID                *string
	LockedMode               *string
	LockedUntil              *time.Time
	ConfirmedAt              *time.Time
	Attempts                 int
	LastError                *string
}

const retentionColumns = `object_key, workspace_id, status, requested_at, requested_until, requested_mode, version_id,
	locked_mode, locked_until, confirmed_at, attempts, last_error`

func scanRetention(row pgx.Row) (ObjectRetention, error) {
	var r ObjectRetention
	err := row.Scan(&r.Key, &r.WorkspaceID, &r.Status, &r.RequestedAt, &r.RequestedUntil, &r.RequestedMode, &r.VersionID,
		&r.LockedMode, &r.LockedUntil, &r.ConfirmedAt, &r.Attempts, &r.LastError)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	return r, err
}

// Retention reads key's protection row; ErrNotFound when none was ever requested.
func (q Q) Retention(ctx context.Context, key string) (ObjectRetention, error) {
	return scanRetention(q.db.QueryRow(ctx, `SELECT `+retentionColumns+` FROM object_retention WHERE object_key = $1`, key))
}

// RetentionConfirmed records the lock storage reported back for the version it applies to; it stays after the job.
func (q Q) RetentionConfirmed(ctx context.Context, key string, versionID, mode string, until, now time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE object_retention SET status = 'confirmed', version_id = $2, locked_mode = $3,
			locked_until = $4, confirmed_at = $5, next_attempt_at = NULL, last_error = NULL
		WHERE object_key = $1 AND status IN ('pending', 'failed', 'confirmed')`, key, versionID, mode, until, now)
	return err
}

// RetentionFailed records a failed lock and when to try again. A confirmed lock is never set back: a failed extension
// keeps it confirmed (to its locked_until) with the error.
func (q Q) RetentionFailed(ctx context.Context, key, reason string, next time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE object_retention SET last_error = $2, next_attempt_at = $3,
			status = CASE WHEN status = 'confirmed' THEN status ELSE 'failed' END
		WHERE object_key = $1 AND status <> 'not_requested'`, key, reason, next)
	return err
}

// NeedsLock: the row asks for a lock storage has not confirmed yet, or a confirmed one shorter than the request.
func (r ObjectRetention) NeedsLock() bool {
	switch r.Status {
	case RetentionPending, RetentionFailed:
		return true
	case RetentionConfirmed:
		return r.LockedUntil != nil && r.RequestedUntil != nil && r.LockedUntil.Before(*r.RequestedUntil)
	}
	return false
}

// ClaimRetentions leases up to limit due objects until now+lease, so concurrent jobs never take the same one.
func (q Q) ClaimRetentions(ctx context.Context, now time.Time, lease time.Duration, limit int) ([]ObjectRetention, error) {
	rows, err := q.db.Query(ctx, `UPDATE object_retention SET next_attempt_at = $2, attempts = attempts + 1
		WHERE object_key IN (SELECT object_key FROM object_retention WHERE (status IN ('pending', 'failed')
				OR (status = 'confirmed' AND locked_until < requested_until))
			AND next_attempt_at <= $1 ORDER BY next_attempt_at LIMIT $3 FOR UPDATE SKIP LOCKED)
		RETURNING `+retentionColumns, now, now.Add(lease), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ObjectRetention
	for rows.Next() {
		r, err := scanRetention(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RetentionCounts: objects per protection status, for `helvetly retention status`.
func (q Q) RetentionCounts(ctx context.Context) (map[string]int, error) {
	rows, err := q.db.Query(ctx, `SELECT status, count(*) FROM object_retention GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var s string
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			return nil, err
		}
		out[s] = n
	}
	return out, rows.Err()
}

// BusinessObject is the object of a committed business record and the civil day its retention counts from.
type BusinessObject struct {
	WorkspaceID, Key string
	Day              time.Time
}

// businessObjectsSQL: every object a committed business record keeps (issued invoice PDFs and archived XML, receipts of
// booked expenses, signature originals and signed PDFs, originals of invoices issued elsewhere), with its record day.
const businessObjectsSQL = `
	SELECT i.workspace_id, i.pdf_key, i.issue_date FROM invoices i WHERE i.status <> 'draft' AND i.pdf_key IS NOT NULL
	UNION ALL
	SELECT i.workspace_id, x.object_key, i.issue_date FROM invoice_xml_exports x JOIN invoices i ON i.id = x.invoice_id
	UNION ALL
	SELECT i.workspace_id, d.object_key, i.issue_date FROM invoices i JOIN documents d ON d.id = i.source_document_id
	UNION ALL
	SELECT e.workspace_id, f.object_key, coalesce(e.document_date, (e.booked_at AT TIME ZONE w.timezone)::date)
		FROM expense_receipts f JOIN expenses e ON e.id = f.expense_id JOIN workspaces w ON w.id = e.workspace_id
		WHERE e.status IN ('booked', 'void') AND e.booked_at IS NOT NULL
	UNION ALL
	SELECT s.workspace_id, s.original_key, (coalesce(s.completed_at, s.created_at) AT TIME ZONE w.timezone)::date
		FROM signature_requests s JOIN workspaces w ON w.id = s.workspace_id
	UNION ALL
	SELECT s.workspace_id, d.object_key, (s.completed_at AT TIME ZONE w.timezone)::date
		FROM signature_requests s JOIN documents d ON d.id = s.signed_document_id JOIN workspaces w ON w.id = s.workspace_id`

// UnprotectedBusinessObjects lists up to limit business-record objects with no row yet, and with protecting also those
// recorded while protection was off (not_requested), for the backfill.
func (q Q) UnprotectedBusinessObjects(ctx context.Context, protecting bool, limit int) ([]BusinessObject, error) {
	rows, err := q.db.Query(ctx, `SELECT b.workspace_id, b.key, max(b.day) FROM (`+businessObjectsSQL+`) AS b(workspace_id, key, day)
		LEFT JOIN object_retention r ON r.object_key = b.key
		WHERE r.object_key IS NULL OR (r.status = 'not_requested' AND $2)
		GROUP BY b.workspace_id, b.key ORDER BY b.key LIMIT $1`, limit, protecting)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BusinessObject
	for rows.Next() {
		var b BusinessObject
		if err := rows.Scan(&b.WorkspaceID, &b.Key, &b.Day); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ---- object versions (storage.Registry) ----

// ObjectVersion: the version the API wrote at key, "" when storage gave none.
func (s *Store) ObjectVersion(ctx context.Context, key string) (string, error) {
	var v string
	err := s.pool.QueryRow(ctx, `SELECT version_id FROM object_versions WHERE object_key = $1`, key).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// SetObjectVersion records the version a PUT or COPY to key answered; a later write of the key by the API replaces it.
func (s *Store) SetObjectVersion(ctx context.Context, key, version string, at time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO object_versions (object_key, version_id, recorded_at) VALUES ($1, $2, $3)
		ON CONFLICT (object_key) DO UPDATE SET version_id = excluded.version_id, recorded_at = excluded.recorded_at`,
		key, version, at)
	return err
}

// ForgetObjectVersion drops key's version once that version is deleted (only that one: a newer write stays).
func (s *Store) ForgetObjectVersion(ctx context.Context, key, version string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM object_versions WHERE object_key = $1 AND version_id = $2`, key, version)
	return err
}

// DeleteBlocked: key belongs to a business record whose protection was requested and whose deadline (requested or
// confirmed) has not passed, or is unknown. The API never deletes such an object, whatever the bucket would allow.
func (s *Store) DeleteBlocked(ctx context.Context, key string, now time.Time) (bool, error) {
	var blocked bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM object_retention WHERE object_key = $1
		AND (greatest(requested_until, locked_until) IS NULL OR greatest(requested_until, locked_until) > $2))`, key, now).Scan(&blocked)
	return blocked, err
}
