package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Transmission is one e-document of an issued invoice sent through a channel (docs/delivery-contract.md).
type Transmission struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"-"`
	InvoiceID   string     `json:"invoice_id"`
	Channel     string     `json:"channel"`
	Format      string     `json:"format"`
	Status      string     `json:"status"`
	ExternalID  *string    `json:"external_id"`
	Attempts    int        `json:"attempts"`
	LastError   *string    `json:"last_error"`
	CreatedBy   *string    `json:"-"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	NextAttempt *time.Time `json:"next_attempt_at"`
}

const transmissionColumns = `id, workspace_id, invoice_id, channel, format, status, external_id, attempts, last_error, created_by,
	created_at, updated_at, next_attempt_at`

func scanTransmissions(rows pgx.Rows, err error) ([]Transmission, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Transmission{}
	for rows.Next() {
		var t Transmission
		if err := rows.Scan(&t.ID, &t.WorkspaceID, &t.InvoiceID, &t.Channel, &t.Format, &t.Status, &t.ExternalID,
			&t.Attempts, &t.LastError, &t.CreatedBy, &t.CreatedAt, &t.UpdatedAt, &t.NextAttempt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// QueueTransmission queues t, or re-queues the invoice's existing one for the same channel and format when it
// failed or was rejected; it reports the row as stored and whether it is (again) queued.
func (q Q) QueueTransmission(ctx context.Context, t Transmission, now time.Time) (Transmission, bool, error) {
	rows, err := q.db.Query(ctx, `INSERT INTO einvoice_transmissions (id, workspace_id, invoice_id, channel, format, created_by,
			created_at, updated_at, next_attempt_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
		ON CONFLICT (invoice_id, channel, format) DO UPDATE SET status = 'queued', attempts = 0, last_error = NULL,
			next_attempt_at = $7, updated_at = $7
			WHERE einvoice_transmissions.status IN ('failed', 'rejected')
		RETURNING `+transmissionColumns, t.ID, t.WorkspaceID, t.InvoiceID, t.Channel, t.Format, t.CreatedBy, now)
	got, err := scanTransmissions(rows, err)
	if err != nil {
		return Transmission{}, false, err
	}
	if len(got) == 1 {
		return got[0], true, nil
	}
	// already queued, sent or accepted: nothing to do, answer with the row as it is
	existing, err := scanTransmissions(q.db.Query(ctx, `SELECT `+transmissionColumns+` FROM einvoice_transmissions
		WHERE invoice_id = $1 AND channel = $2 AND format = $3`, t.InvoiceID, t.Channel, t.Format))
	if err != nil || len(existing) == 0 {
		return Transmission{}, false, errors.Join(err, ErrNotFound)
	}
	return existing[0], false, nil
}

// Transmissions: an invoice's transmissions, newest first.
func (q Q) Transmissions(ctx context.Context, workspaceID, invoiceID string) ([]Transmission, error) {
	return scanTransmissions(q.db.Query(ctx, `SELECT `+transmissionColumns+` FROM einvoice_transmissions
		WHERE workspace_id = $1 AND invoice_id = $2 ORDER BY created_at DESC, id`, workspaceID, invoiceID))
}

// Transmission: one of an invoice's transmissions.
func (q Q) Transmission(ctx context.Context, workspaceID, invoiceID, id string) (Transmission, error) {
	got, err := scanTransmissions(q.db.Query(ctx, `SELECT `+transmissionColumns+` FROM einvoice_transmissions
		WHERE workspace_id = $1 AND invoice_id = $2 AND id = $3`, workspaceID, invoiceID, id))
	if err == nil && len(got) == 0 {
		err = ErrNotFound
	}
	if err != nil {
		return Transmission{}, err
	}
	return got[0], nil
}

// ClaimTransmissions leases up to limit due queued transmissions until now+lease (FOR UPDATE SKIP LOCKED), so
// concurrent jobs never send the same one; Attempts counts this one.
func (q Q) ClaimTransmissions(ctx context.Context, now time.Time, lease time.Duration, limit int) ([]Transmission, error) {
	return scanTransmissions(q.db.Query(ctx, `UPDATE einvoice_transmissions SET next_attempt_at = $2, attempts = attempts + 1
		WHERE id IN (SELECT id FROM einvoice_transmissions WHERE status = 'queued' AND next_attempt_at <= $1
			ORDER BY next_attempt_at LIMIT $3 FOR UPDATE SKIP LOCKED)
		RETURNING `+transmissionColumns, now, now.Add(lease), limit))
}

// ErrStaleClaim: the transmission is no longer held by this claim (its lease ended and another run took it, or it
// was requeued), so this run's outcome is dropped.
var ErrStaleClaim = errors.New("store: transmission claim is stale")

// claimFence matches only the row as claimed: still queued, with the claim's attempt count and lease end.
const claimFence = ` AND status = 'queued' AND attempts = $2 AND next_attempt_at = $3`

// TransmissionDone records a channel's answer to claim t: sent or accepted with its external id, or rejected with the
// channel's reason; ErrStaleClaim when t is no longer the claim.
func (q Q) TransmissionDone(ctx context.Context, t Transmission, status string, externalID, reason *string, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE einvoice_transmissions SET status = $4, external_id = coalesce($5, external_id),
		last_error = $6, next_attempt_at = NULL, updated_at = $7 WHERE id = $1`+claimFence,
		t.ID, t.Attempts, t.NextAttempt, status, externalID, reason, now)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrStaleClaim
	}
	return err
}

// TransmissionInvoiceNumber: the number of the transmitted invoice, for the notification.
func (q Q) TransmissionInvoiceNumber(ctx context.Context, workspaceID, invoiceID string) (string, error) {
	var n string
	err := q.db.QueryRow(ctx, `SELECT COALESCE(number, '') FROM invoices WHERE workspace_id = $1 AND id = $2`,
		workspaceID, invoiceID).Scan(&n)
	return n, notFound(err)
}

// TransmissionFailed keeps claim t queued for another try at retry, or marks it failed when retry is nil;
// ErrStaleClaim when t is no longer the claim.
func (q Q) TransmissionFailed(ctx context.Context, t Transmission, message string, retry *time.Time, now time.Time) error {
	status := "queued"
	if retry == nil {
		status = "failed"
	}
	tag, err := q.db.Exec(ctx, `UPDATE einvoice_transmissions SET status = $4, last_error = $5, next_attempt_at = $6,
		updated_at = $7 WHERE id = $1`+claimFence, t.ID, t.Attempts, t.NextAttempt, status, message, retry, now)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrStaleClaim
	}
	return err
}

// PutTransmissionCredentials stores a workspace's sealed credentials for a channel.
func (q Q) PutTransmissionCredentials(ctx context.Context, workspaceID, channel string, sealed []byte, by string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO transmission_credentials (workspace_id, channel, sealed, updated_by, updated_at)
		VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, channel) DO UPDATE SET sealed = $3, updated_by = $4,
		updated_at = $5`, workspaceID, channel, sealed, by, now)
	return err
}

// TransmissionCredentials: a workspace's sealed credentials for a channel; ErrNotFound when it has none.
func (q Q) TransmissionCredentials(ctx context.Context, workspaceID, channel string) ([]byte, error) {
	var sealed []byte
	err := q.db.QueryRow(ctx, `SELECT sealed FROM transmission_credentials WHERE workspace_id = $1 AND channel = $2`,
		workspaceID, channel).Scan(&sealed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return sealed, err
}

// ConfiguredChannels: the channels a workspace has credentials for.
func (q Q) ConfiguredChannels(ctx context.Context, workspaceID string) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT channel FROM transmission_credentials WHERE workspace_id = $1 ORDER BY channel`,
		workspaceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}
