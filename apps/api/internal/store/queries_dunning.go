package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Dunning (docs/invoices-contract.md "Dunning"): the notices sent and the invoices they may concern.

// DunningNotice is one notice sent for an invoice.
type DunningNotice struct {
	InvoiceID    string    `json:"-"`
	Level        int       `json:"level"`
	Levels       int       `json:"levels"`
	SentAt       time.Time `json:"sent_at"`
	SentOn       string    `json:"sent_on"`
	Open         Money     `json:"open_amount"`
	Fee          Money     `json:"fee"`
	Interest     Money     `json:"interest"`
	InterestRate Percent   `json:"interest_rate"`
	InterestFrom *string   `json:"interest_from"`
	Total        Money     `json:"total"`
	Email        string    `json:"email"`
	SentBy       *string   `json:"sent_by"` // the person's name for a notice sent by hand, null for the hourly job
	StoredTitle  *string   `json:"-"`       // the title sent; nil for a notice sent before titles were stored
	QRBill       bool      `json:"qr_bill"`
	// Confirmed: the mail server took the email; false while it is being sent, or when it may have gone (never sent
	// again by itself).
	Confirmed bool `json:"confirmed"`
}

// dunningTarget: the invoices dunning applies to: issued, open, receivable, without instalments of either kind.
const dunningTarget = `i.status = 'open' AND i.kind IN ('invoice', 'partial', 'prepayment', 'debit_note', 'corrected')
	AND i.instalment_interval IS NULL AND i.plan_id IS NULL`

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// DunningCandidate is an open invoice of a workspace with dunning on, its client not opted out, not paused.
type DunningCandidate struct {
	Workspace   Workspace
	InvoiceID   string
	IssueDate   string
	DueDate     string
	ClientEmail string // "" when the client has none
	LastLevel   int    // the last step sent, 0 before the first notice
	LastSentOn  string
}

// DunningCandidates lists, at now, the open invoices that dunning may concern: past due or due within the days
// before (the workspace's civil date), for notes before the due date.
func (q Q) DunningCandidates(ctx context.Context, now time.Time, daysBefore int) ([]DunningCandidate, error) {
	rows, err := q.db.Query(ctx, `SELECT w.id, w.name, w.timezone, i.id, i.issue_date::text, i.due_date::text, `+clientEmail+`,
			COALESCE(max(n.level), 0), COALESCE(max(n.sent_on)::text, '')
		FROM invoices i JOIN workspaces w ON w.id = i.workspace_id JOIN clients c ON c.id = i.client_id
		JOIN invoice_settings s ON s.workspace_id = w.id
		LEFT JOIN dunning_notices n ON n.invoice_id = i.id
		WHERE w.deleted_at IS NULL AND (s.settings->'dunning'->>'enabled')::boolean AND `+dunningTarget+`
			AND NOT i.dunning_paused AND c.dunning_enabled AND i.total + i.rounding_amount - i.amount_paid - i.amount_credited > 0
			AND i.due_date <= ($1::timestamptz AT TIME ZONE w.timezone)::date + $2::int
		GROUP BY w.id, i.id, c.id
		ORDER BY w.id, i.due_date, i.id`, now, daysBefore)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DunningCandidate, error) {
		var d DunningCandidate
		err := r.Scan(&d.Workspace.ID, &d.Workspace.Name, &d.Workspace.Timezone, &d.InvoiceID, &d.IssueDate, &d.DueDate,
			&d.ClientEmail, &d.LastLevel, &d.LastSentOn)
		return d, err
	})
}

// clientEmail: where a client's invoices and reminders go (the primary contact, else the billing email, else the
// client's email), "" for none; the query joins the client as c.
const clientEmail = `COALESCE((SELECT cc.email FROM client_contacts cc WHERE cc.client_id = c.id AND cc.is_primary),
	c.billing_email, c.email, '')`

// DunningRecipient: the client email of the invoice's client, "" for none.
func (q Q) DunningRecipient(ctx context.Context, workspaceID, invoiceID string) (string, error) {
	var email string
	err := q.db.QueryRow(ctx, `SELECT `+clientEmail+` FROM invoices i JOIN clients c ON c.id = i.client_id
		WHERE i.workspace_id = $1 AND i.id = $2`, workspaceID, invoiceID).Scan(&email)
	return email, notFound(err)
}

// DunningFlags: whether dunning applies to the invoice at all (issued, open, receivable, no instalments), whether
// it is paused, and whether its client takes dunning.
func (q Q) DunningFlags(ctx context.Context, workspaceID, invoiceID string) (applies, paused, clientEnabled bool, err error) {
	err = q.db.QueryRow(ctx, `SELECT `+dunningTarget+`, i.dunning_paused, c.dunning_enabled
		FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.workspace_id = $1 AND i.id = $2`,
		workspaceID, invoiceID).Scan(&applies, &paused, &clientEnabled)
	return applies, paused, clientEnabled, notFound(err)
}

// DunningNotices: the invoice's notices, oldest first.
func (q Q) DunningNotices(ctx context.Context, workspaceID, invoiceID string) ([]DunningNotice, error) {
	rows, err := q.db.Query(ctx, `SELECT n.invoice_id, n.level, n.levels, n.sent_at, n.sent_on::text, n.open_amount, n.fee, n.interest,
			n.interest_rate, n.interest_from::text, n.total, n.email, NULLIF(COALESCE(NULLIF(u.name, ''), u.email), ''),
			n.title, n.qr_bill, n.confirmed
		FROM dunning_notices n LEFT JOIN users u ON u.id = n.sent_by
		WHERE n.workspace_id = $1 AND n.invoice_id = $2 ORDER BY n.level`, workspaceID, invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DunningNotice, error) {
		var n DunningNotice
		err := r.Scan(&n.InvoiceID, &n.Level, &n.Levels, &n.SentAt, &n.SentOn, &n.Open, &n.Fee, &n.Interest, &n.InterestRate,
			&n.InterestFrom, &n.Total, &n.Email, &n.SentBy, &n.StoredTitle, &n.QRBill, &n.Confirmed)
		return n, err
	})
}

// LogDunningNotice records a notice in the caller's transaction, before it is sent; false when that step of the
// invoice was recorded before (it went out, or another run is sending it and this insert waited for it).
func (q Q) LogDunningNotice(ctx context.Context, workspaceID string, n DunningNotice, sentBy *string) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO dunning_notices (workspace_id, invoice_id, level, levels, sent_at, sent_on, open_amount,
			fee, interest, interest_rate, interest_from, total, email, sent_by, title, qr_bill, confirmed)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, false) ON CONFLICT DO NOTHING`,
		workspaceID, n.InvoiceID, n.Level, n.Levels, n.SentAt, n.SentOn, n.Open, n.Fee, n.Interest, n.InterestRate, n.InterestFrom,
		n.Total, n.Email, sentBy, n.StoredTitle, n.QRBill)
	return tag.RowsAffected() == 1, err
}

// ConfirmDunningNotice records that the mail server took the notice's email.
func (q Q) ConfirmDunningNotice(ctx context.Context, workspaceID, invoiceID string, level int) error {
	_, err := q.db.Exec(ctx, `UPDATE dunning_notices SET confirmed = true WHERE workspace_id = $1 AND invoice_id = $2 AND level = $3`,
		workspaceID, invoiceID, level)
	return err
}

// DropUnsentDunningNotice removes a notice whose email was refused, so the next run sends it again.
func (q Q) DropUnsentDunningNotice(ctx context.Context, workspaceID, invoiceID string, level int) error {
	_, err := q.db.Exec(ctx, `DELETE FROM dunning_notices WHERE workspace_id = $1 AND invoice_id = $2 AND level = $3 AND NOT confirmed`,
		workspaceID, invoiceID, level)
	return err
}

// SetDunningPaused pauses or resumes the dunning of an invoice.
func (q Q) SetDunningPaused(ctx context.Context, workspaceID, invoiceID string, paused bool) error {
	tag, err := q.db.Exec(ctx, `UPDATE invoices SET dunning_paused = $3 WHERE workspace_id = $1 AND id = $2 AND status <> 'draft'`,
		workspaceID, invoiceID, paused)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// DunningDigestRow is a notice sent in the 24 hours before the digest.
type DunningDigestRow struct {
	InvoiceID, Number, ClientName, Currency string
	Level, Levels                           int
	Title                                   *string // nil for a notice sent before titles were stored
	Total                                   Money
}

// DunningDigestWorkspaces: the live workspaces with a notice sent in the 24 hours before now.
func (q Q) DunningDigestWorkspaces(ctx context.Context, now time.Time) ([]Workspace, error) {
	rows, err := q.db.Query(ctx, `SELECT DISTINCT w.id, w.name, w.timezone FROM dunning_notices n JOIN workspaces w ON w.id = n.workspace_id
		WHERE w.deleted_at IS NULL AND n.sent_at > $1::timestamptz - interval '24 hours' AND n.sent_at <= $1 ORDER BY w.id`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Workspace, error) {
		var w Workspace
		err := r.Scan(&w.ID, &w.Name, &w.Timezone)
		return w, err
	})
}

// DunningDigestRows: the workspace's notices sent in the 24 hours before now, oldest first.
func (q Q) DunningDigestRows(ctx context.Context, workspaceID string, now time.Time) ([]DunningDigestRow, error) {
	rows, err := q.db.Query(ctx, `SELECT n.invoice_id, COALESCE(i.number, ''), COALESCE(i.buyer->>'name', ''), i.currency, n.level,
			n.levels, n.title, n.total
		FROM dunning_notices n JOIN invoices i ON i.id = n.invoice_id
		WHERE n.workspace_id = $1 AND n.sent_at > $2::timestamptz - interval '24 hours' AND n.sent_at <= $2
		ORDER BY n.sent_at, n.invoice_id`, workspaceID, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DunningDigestRow, error) {
		var d DunningDigestRow
		err := r.Scan(&d.InvoiceID, &d.Number, &d.ClientName, &d.Currency, &d.Level, &d.Levels, &d.Title, &d.Total)
		return d, err
	})
}

// OverdueInvoice is an open invoice that fell due recently, for the "invoice.overdue" notification.
type OverdueInvoice struct {
	WorkspaceID, InvoiceID, Number, Client, Currency, DueDate string
	Open                                                      Money
}

// RecentlyOverdue lists, at now, the open invoices dunning applies to whose due date passed within the last days
// (each workspace's civil date), with dunning on or off.
func (q Q) RecentlyOverdue(ctx context.Context, now time.Time, days int) ([]OverdueInvoice, error) {
	rows, err := q.db.Query(ctx, `SELECT w.id, i.id, COALESCE(i.number, ''), `+invoiceClientName+`, i.currency, i.due_date::text,
			i.total + i.rounding_amount - i.amount_paid - i.amount_credited
		FROM invoices i JOIN workspaces w ON w.id = i.workspace_id JOIN clients c ON c.id = i.client_id
		WHERE w.deleted_at IS NULL AND `+dunningTarget+` AND i.total + i.rounding_amount - i.amount_paid - i.amount_credited > 0
			AND i.due_date < ($1::timestamptz AT TIME ZONE w.timezone)::date
			AND i.due_date >= ($1::timestamptz AT TIME ZONE w.timezone)::date - $2::int
		ORDER BY w.id, i.due_date, i.id`, now, days)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (OverdueInvoice, error) {
		var o OverdueInvoice
		err := r.Scan(&o.WorkspaceID, &o.InvoiceID, &o.Number, &o.Client, &o.Currency, &o.DueDate, &o.Open)
		return o, err
	})
}
