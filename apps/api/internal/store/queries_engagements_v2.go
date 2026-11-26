package store

import (
	"context"
	"time"

	"helvetly.com/api/internal/invoicecalc"
)

// Engagements v2: prorated quantities, notices, the digest setting and the background job's lookups
// (docs/engagements-contract.md, "Automatic drafts and reminders").

// EngagementNotice: one raised-once reminder; the title and number belong to its engagement, for the digest.
type EngagementNotice struct {
	ID           string     `json:"id"`
	EngagementID string     `json:"engagement_id"`
	PeriodID     string     `json:"period_id"`
	Kind         string     `json:"kind"`
	InvoiceID    *string    `json:"invoice_id"`
	CreatedAt    time.Time  `json:"created_at"`
	NotifiedAt   *time.Time `json:"notified_at"`
	Title        string     `json:"title"`
	Number       int64      `json:"number"`
}

type EngagementSettings struct {
	Digest bool `json:"digest"`
}

// SetPeriodQuantityProrated sets the computed quantity; unlike SetPeriodQuantity it leaves quantity_manual alone.
func (q Q) SetPeriodQuantityProrated(ctx context.Context, periodID string, quantity invoicecalc.Quantity) error {
	tag, err := q.db.Exec(ctx, `UPDATE engagement_periods SET quantity = $2 WHERE id = $1`, periodID, quantity)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AddNotice records n unless that period already has that kind (for draft_created: for that invoice);
// false when it did. Relies on its unique index (00001_init).
func (q Q) AddNotice(ctx context.Context, n EngagementNotice) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO engagement_notices (id, engagement_id, period_id, kind, invoice_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
		n.ID, n.EngagementID, n.PeriodID, n.Kind, n.InvoiceID, n.CreatedAt)
	return tag.RowsAffected() == 1, err
}

// ClaimNotices marks the workspace's un-notified notices of live engagements notified at now and returns them, oldest
// first. Run it in the transaction that sends them: a concurrent claim waits on the rows, then finds them taken, and a
// rollback (nothing sent) leaves them for the next run.
func (q Q) ClaimNotices(ctx context.Context, workspaceID string, now time.Time) ([]EngagementNotice, error) {
	rows, err := q.db.Query(ctx, `WITH claimed AS (UPDATE engagement_notices n SET notified_at = $2 FROM engagements e
			WHERE e.id = n.engagement_id AND e.workspace_id = $1 AND e.deleted_at IS NULL AND n.notified_at IS NULL
			RETURNING n.id, n.engagement_id, n.period_id, n.kind, n.invoice_id, n.created_at, n.notified_at, e.title, e.number)
		SELECT * FROM claimed ORDER BY created_at, id`, workspaceID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []EngagementNotice{}
	for rows.Next() {
		var n EngagementNotice
		if err := rows.Scan(&n.ID, &n.EngagementID, &n.PeriodID, &n.Kind, &n.InvoiceID, &n.CreatedAt, &n.NotifiedAt,
			&n.Title, &n.Number); err != nil {
			return nil, err
		}
		list = append(list, n)
	}
	return list, rows.Err()
}

// ClaimDigestDay records the workspace's digest for day; false when one was already recorded. Like ClaimNotices,
// run it in the sending transaction.
func (q Q) ClaimDigestDay(ctx context.Context, workspaceID, day string) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO digest_days (workspace_id, day) VALUES ($1, $2::date) ON CONFLICT DO NOTHING`,
		workspaceID, day)
	return tag.RowsAffected() == 1, err
}

// EngagementSettings: a workspace that never set them digests by default.
func (q Q) EngagementSettings(ctx context.Context, workspaceID string) (EngagementSettings, error) {
	s := EngagementSettings{Digest: true}
	err := q.db.QueryRow(ctx, `SELECT coalesce((SELECT digest FROM engagement_settings WHERE workspace_id = $1), true)`,
		workspaceID).Scan(&s.Digest)
	return s, err
}

func (q Q) PutEngagementSettings(ctx context.Context, workspaceID string, s EngagementSettings, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO engagement_settings (workspace_id, digest, updated_at) VALUES ($1, $2, $3)
		ON CONFLICT (workspace_id) DO UPDATE SET digest = $2, updated_at = $3`, workspaceID, s.Digest, now)
	return err
}

// AutoInvoiceEngagements lists, across live workspaces, the live engagements that make their own drafts.
func (q Q) AutoInvoiceEngagements(ctx context.Context) ([]Engagement, error) {
	rows, err := q.db.Query(ctx, `SELECT `+engagementColumns+engagementFrom+` JOIN workspaces w ON w.id = e.workspace_id
		WHERE e.auto_invoice AND e.deleted_at IS NULL AND w.deleted_at IS NULL ORDER BY e.created_at, e.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Engagement{}
	for rows.Next() {
		e, err := scanEngagement(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

// LiveEngagementIDs lists the workspace's live engagements (the notice pass walks them).
func (q Q) LiveEngagementIDs(ctx context.Context, workspaceID string) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT id FROM engagements WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY number`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// DigestWorkspaces lists the live workspaces (id and time zone) with the digest on (the default) and un-notified notices.
func (q Q) DigestWorkspaces(ctx context.Context) ([]Workspace, error) {
	return q.engagementWorkspaces(ctx, `SELECT w.id, w.name, w.timezone FROM workspaces w
		WHERE w.deleted_at IS NULL AND coalesce((SELECT s.digest FROM engagement_settings s WHERE s.workspace_id = w.id), true)
		AND EXISTS (SELECT 1 FROM engagement_notices n JOIN engagements e ON e.id = n.engagement_id
			WHERE e.workspace_id = w.id AND e.deleted_at IS NULL AND n.notified_at IS NULL) ORDER BY w.id`)
}

// DigestRecipients: the workspace's owners and admins, and their addresses in the same order.
func (q Q) DigestRecipients(ctx context.Context, workspaceID string) ([]UserRef, []string, error) {
	rows, err := q.db.Query(ctx, `SELECT u.id, u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1 AND m.role IN ('owner', 'admin') ORDER BY u.email`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	users, emails := []UserRef{}, []string{}
	for rows.Next() {
		var u UserRef
		var email string
		if err := rows.Scan(&u.ID, &u.Name, &email); err != nil {
			return nil, nil, err
		}
		users, emails = append(users, u), append(emails, email)
	}
	return users, emails, rows.Err()
}

// SetPeriodFullQuantity sets the uncut snapshot; quantity and quantity_manual stay as they are.
func (q Q) SetPeriodFullQuantity(ctx context.Context, periodID string, full invoicecalc.Quantity) error {
	tag, err := q.db.Exec(ctx, `UPDATE engagement_periods SET full_quantity = $2 WHERE id = $1`, periodID, full)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
