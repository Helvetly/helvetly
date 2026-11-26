package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// PaymentConfirmation is a queued email confirming one payment to the client: the payment's amount and day, and the
// invoice's balance and next instalment as they were right after it.
type PaymentConfirmation struct {
	PaymentID, WorkspaceID, InvoiceID string
	RecordedBy                        *string
	Amount                            Money
	PaidOn                            string
	Open                              Money
	NextAmount                        *Money
	NextDue                           *string
	Attempts                          int
}

// QueuePaymentConfirmation runs in the payment's transaction, so nothing is queued for a payment that never commits;
// a payment is confirmed once, whatever asks again.
func (q Q) QueuePaymentConfirmation(ctx context.Context, c PaymentConfirmation, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO payment_confirmations (payment_id, workspace_id, invoice_id, recorded_by, open, next_amount, next_due, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
		c.PaymentID, c.WorkspaceID, c.InvoiceID, c.RecordedBy, c.Open, c.NextAmount, c.NextDue, now)
	return err
}

// ClaimPaymentConfirmations takes up to limit queued confirmations, oldest first, marking them uncertain: a send
// interrupted after this is never repeated, only a definite refusal puts one back (FinishPaymentConfirmation).
func (q Q) ClaimPaymentConfirmations(ctx context.Context, limit int, now time.Time) ([]PaymentConfirmation, error) {
	rows, err := q.db.Query(ctx, `WITH due AS (
			SELECT payment_id FROM payment_confirmations WHERE state = 'pending' AND (retry_at IS NULL OR retry_at <= $2)
			ORDER BY created_at, payment_id LIMIT $1 FOR UPDATE SKIP LOCKED)
		UPDATE payment_confirmations c SET state = 'uncertain', attempts = c.attempts + 1
		FROM due, invoice_payments p WHERE c.payment_id = due.payment_id AND p.id = c.payment_id
		RETURNING c.payment_id, c.workspace_id, c.invoice_id, c.recorded_by, p.amount, p.paid_on::text, c.open, c.next_amount,
			c.next_due::text, c.attempts`, limit, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[PaymentConfirmation])
}

// FinishPaymentConfirmation records how a claimed send ended: sent, skipped (no address), failed, or pending to try
// again from retryAt.
func (q Q) FinishPaymentConfirmation(ctx context.Context, paymentID, state string, retryAt *time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE payment_confirmations SET state = $2, retry_at = $3 WHERE payment_id = $1 AND state = 'uncertain'`,
		paymentID, state, retryAt)
	return err
}
