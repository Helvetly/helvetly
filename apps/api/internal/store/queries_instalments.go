package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Instalment schedules, instalment plans and reminders (docs/invoices-contract.md "Instalments", "Instalment plans",
// "Reminders"). Only rows are stored; effective, paid, open and status are derived on read by the invoices package.

// InstalmentItem is one instalment of an invoice's schedule.
type InstalmentItem struct {
	Seq       int     `json:"seq"`
	DueDate   string  `json:"due_date"`
	Amount    Money   `json:"amount"`
	Effective Money   `json:"effective"`
	Paid      Money   `json:"paid"`
	Open      Money   `json:"open"`
	Status    string  `json:"status"`
	Reference *string `json:"reference"`
}

type InstalmentSchedule struct {
	Interval string           `json:"interval"`
	Items    []InstalmentItem `json:"items"`
}

// PlanRef: the plan that issued a partial invoice, or seq 0 on the plan's source draft.
type PlanRef struct {
	ID    string `json:"id"`
	Seq   int    `json:"seq"`
	Count int    `json:"count"`
}

type Plan struct {
	ID               string     `json:"id"`
	WorkspaceID      string     `json:"-"`
	SourceInvoiceID  string     `json:"source_invoice_id"`
	ClientID         string     `json:"client_id"`
	Count            int        `json:"count"`
	Interval         string     `json:"interval"`
	FirstDueDate     string     `json:"first_due_date"`
	LeadDays         int        `json:"lead_days"`
	AutoSend         bool       `json:"auto_send"`
	Status           string     `json:"status"` // active | paused | cancelled | done
	RemindersEnabled bool       `json:"reminders_enabled"`
	CreatedBy        *string    `json:"-"`
	CreatedAt        time.Time  `json:"created_at"`
	Items            []PlanItem `json:"items"`
}

// PlanItem: one instalment of a plan; the invoice fields are set once it was issued.
type PlanItem struct {
	Seq       int        `json:"seq"`
	DueDate   string     `json:"due_date"`
	IssueOn   string     `json:"issue_on"`
	InvoiceID *string    `json:"invoice_id"`
	Number    *string    `json:"number"`
	Status    *string    `json:"status"` // the issued invoice's status
	IssuedAt  *time.Time `json:"issued_at"`
}

// DuePlanItem: a plan item whose issue day has come, with what issuing it needs.
type DuePlanItem struct {
	Workspace Workspace
	Plan      Plan
	Item      PlanItem
}

// ReminderTarget: one reminder to send, keyed by (InvoiceID, Seq, Kind, OffsetDays). Seq is the instalment of a
// schedule, or the plan seq of a partial invoice issued by a plan.
type ReminderTarget struct {
	WorkspaceID string
	InvoiceID   string
	Seq         int
	Count       int    // instalments in all, for "2/6"
	Kind        string // before | after
	OffsetDays  int
	DueDate     string
	Open        Money
	ClientEmail string // "" when the client has none
	Language    string
	Number      string
	Today       string // the workspace's civil date at the run
}

// ---- schedules ----

// SetInstalments replaces the invoice's schedule; interval "" clears it.
func (q Q) SetInstalments(ctx context.Context, invoiceID, interval string, items []InstalmentItem) error {
	if _, err := q.db.Exec(ctx, `UPDATE invoices SET instalment_interval = NULLIF($2, '') WHERE id = $1`, invoiceID, interval); err != nil {
		return err
	}
	if _, err := q.db.Exec(ctx, `DELETE FROM invoice_instalments WHERE invoice_id = $1`, invoiceID); err != nil {
		return err
	}
	if interval == "" {
		return nil
	}
	for _, it := range items {
		if _, err := q.db.Exec(ctx, `INSERT INTO invoice_instalments (invoice_id, seq, due_date, amount, reference) VALUES ($1, $2, $3, $4, $5)`,
			invoiceID, it.Seq, it.DueDate, it.Amount, it.Reference); err != nil {
			return err
		}
	}
	return nil
}

// SetRemindersEnabled switches the reminders of one invoice (kept out of SaveDraft, whose callers build invoices
// without it).
func (q Q) SetRemindersEnabled(ctx context.Context, invoiceID string, on bool) error {
	_, err := q.db.Exec(ctx, `UPDATE invoices SET reminders_enabled = $2 WHERE id = $1`, invoiceID, on)
	return err
}

func (q Q) instalments(ctx context.Context, invoiceID string) ([]InstalmentItem, error) {
	rows, err := q.db.Query(ctx, `SELECT seq, due_date::text, amount, reference FROM invoice_instalments WHERE invoice_id = $1 ORDER BY seq`,
		invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (InstalmentItem, error) {
		var it InstalmentItem
		err := r.Scan(&it.Seq, &it.DueDate, &it.Amount, &it.Reference)
		return it, err
	})
}

// ---- plans ----

const planColumns = `p.id, p.workspace_id, p.source_invoice_id, p.client_id, p.count, p.instalment_interval, p.first_due_date::text,
	p.lead_days, p.auto_send, p.status, p.reminders_enabled, p.created_by, p.created_at`

func scanPlan(r pgx.Row, extra ...any) (Plan, error) {
	var p Plan
	err := r.Scan(append([]any{&p.ID, &p.WorkspaceID, &p.SourceInvoiceID, &p.ClientID, &p.Count, &p.Interval, &p.FirstDueDate,
		&p.LeadDays, &p.AutoSend, &p.Status, &p.RemindersEnabled, &p.CreatedBy, &p.CreatedAt}, extra...)...)
	return p, err
}

// CreatePlan inserts the plan and its items.
func (q Q) CreatePlan(ctx context.Context, p Plan) error {
	if _, err := q.db.Exec(ctx, `INSERT INTO instalment_plans (id, workspace_id, source_invoice_id, client_id, count, instalment_interval,
		first_due_date, lead_days, auto_send, status, reminders_enabled, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, p.ID, p.WorkspaceID, p.SourceInvoiceID, p.ClientID, p.Count,
		p.Interval, p.FirstDueDate, p.LeadDays, p.AutoSend, p.Status, p.RemindersEnabled, p.CreatedBy, p.CreatedAt); err != nil {
		return err
	}
	for _, it := range p.Items {
		if _, err := q.db.Exec(ctx, `INSERT INTO instalment_plan_items (plan_id, seq, due_date, issue_on) VALUES ($1, $2, $3, $4)`,
			p.ID, it.Seq, it.DueDate, it.IssueOn); err != nil {
			return err
		}
	}
	return nil
}

// Plan: one plan with its items; pgx.ErrNoRows when the workspace has no such plan. forUpdate locks the plan row.
func (q Q) Plan(ctx context.Context, workspaceID, id string, forUpdate bool) (Plan, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE"
	}
	p, err := scanPlan(q.db.QueryRow(ctx, `SELECT `+planColumns+` FROM instalment_plans p WHERE p.workspace_id = $1 AND p.id = $2`+lock,
		workspaceID, id))
	if err != nil {
		return p, err
	}
	p.Items, err = q.planItems(ctx, id)
	return p, err
}

// Plans: the workspace's plans, newest first; clientID "" lists every client's.
func (q Q) Plans(ctx context.Context, workspaceID, clientID string) ([]Plan, error) {
	rows, err := q.db.Query(ctx, `SELECT `+planColumns+` FROM instalment_plans p WHERE p.workspace_id = $1 AND ($2 = '' OR p.client_id = $2)
		ORDER BY p.created_at DESC, p.id`, workspaceID, clientID)
	if err != nil {
		return nil, err
	}
	plans, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Plan, error) { return scanPlan(r) })
	if err != nil {
		return nil, err
	}
	// shortcut: one items query per plan, a workspace has few plans; join them in one query if lists grow.
	for i := range plans {
		if plans[i].Items, err = q.planItems(ctx, plans[i].ID); err != nil {
			return nil, err
		}
	}
	return plans, nil
}

// HasSourcePlan includes cancelled plans, whose source invoice stays locked.
func (q Q) HasSourcePlan(ctx context.Context, workspaceID, invoiceID string) (bool, error) {
	var found bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM instalment_plans WHERE workspace_id = $1 AND source_invoice_id = $2)`,
		workspaceID, invoiceID).Scan(&found)
	return found, err
}

func (q Q) planItems(ctx context.Context, planID string) ([]PlanItem, error) {
	rows, err := q.db.Query(ctx, `SELECT it.seq, it.due_date::text, it.issue_on::text, it.invoice_id, i.number, i.status, it.issued_at
		FROM instalment_plan_items it LEFT JOIN invoices i ON i.id = it.invoice_id WHERE it.plan_id = $1 ORDER BY it.seq`, planID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PlanItem, error) {
		var it PlanItem
		err := r.Scan(&it.Seq, &it.DueDate, &it.IssueOn, &it.InvoiceID, &it.Number, &it.Status, &it.IssuedAt)
		return it, err
	})
}

// SetPlanStatus moves a plan to status when it is in one of from; false when it is not (or is missing).
func (q Q) SetPlanStatus(ctx context.Context, workspaceID, id, status string, from []string) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE instalment_plans SET status = $3 WHERE workspace_id = $1 AND id = $2 AND status = ANY($4)`,
		workspaceID, id, status, from)
	return tag.RowsAffected() == 1, err
}

// DuePlanItems: the unissued items of active plans in live workspaces whose issue day (workspace time zone) has come.
func (q Q) DuePlanItems(ctx context.Context, now time.Time) ([]DuePlanItem, error) {
	rows, err := q.db.Query(ctx, `SELECT `+planColumns+`, w.name, w.timezone, it.seq, it.due_date::text, it.issue_on::text
		FROM instalment_plan_items it JOIN instalment_plans p ON p.id = it.plan_id JOIN workspaces w ON w.id = p.workspace_id
		WHERE p.status = 'active' AND w.deleted_at IS NULL AND it.invoice_id IS NULL AND it.issue_on <= ($1::timestamptz AT TIME ZONE w.timezone)::date
		ORDER BY it.issue_on, p.id, it.seq`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DuePlanItem, error) {
		var d DuePlanItem
		var err error
		d.Plan, err = scanPlan(r, &d.Workspace.Name, &d.Workspace.Timezone, &d.Item.Seq, &d.Item.DueDate, &d.Item.IssueOn)
		d.Workspace.ID = d.Plan.WorkspaceID
		return d, err
	})
}

// UnsentPartial: a plan partial whose automatic send failed.
type UnsentPartial struct {
	Workspace Workspace
	InvoiceID string
}

// UnsentPlanPartials lists the open partials of auto-send plans (not paused or cancelled) issued in the 7 days before
// now and never sent, whose client or frozen buyer has an email address: the automatic sends to retry. The window keeps
// a lasting failure from being retried hourly for ever.
func (q Q) UnsentPlanPartials(ctx context.Context, now time.Time) ([]UnsentPartial, error) {
	rows, err := q.db.Query(ctx, `SELECT i.workspace_id, w.name, w.timezone, i.id
		FROM invoices i JOIN instalment_plans p ON p.id = i.plan_id JOIN workspaces w ON w.id = i.workspace_id
			JOIN clients c ON c.id = i.client_id
		WHERE i.status = 'open' AND i.plan_id IS NOT NULL AND i.sent_at IS NULL AND i.send_uncertain_at IS NULL AND i.send_started_at IS NULL AND i.issued_at > $1::timestamptz - interval '7 days'
			AND p.auto_send AND p.status IN ('active', 'done') AND w.deleted_at IS NULL
			AND COALESCE(c.billing_email, c.email, i.buyer->>'email') IS NOT NULL
		ORDER BY i.issued_at, i.id`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (UnsentPartial, error) {
		var u UnsentPartial
		err := r.Scan(&u.Workspace.ID, &u.Workspace.Name, &u.Workspace.Timezone, &u.InvoiceID)
		return u, err
	})
}

// ClaimPlanSend claims the automatic send of an unsent invoice at now; false when it was sent or another run holds a
// claim younger than 15 minutes.
func (q Q) ClaimPlanSend(ctx context.Context, invoiceID string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE invoices SET send_claimed_at = $2 WHERE id = $1 AND status = 'open' AND sent_at IS NULL AND send_uncertain_at IS NULL AND send_started_at IS NULL
		AND (send_claimed_at IS NULL OR send_claimed_at < $2::timestamptz - interval '15 minutes')`, invoiceID, now)
	return tag.RowsAffected() == 1, err
}

// ReleasePlanSend gives up a claim after a failed send, so the next run retries.
func (q Q) ReleasePlanSend(ctx context.Context, invoiceID string, claimedAt time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE invoices SET send_claimed_at = NULL WHERE id = $1 AND send_claimed_at = $2`, invoiceID, claimedAt)
	return err
}

// MarkPlanItemIssued records the invoice issued for a plan item and links the invoice to the plan; false when the item
// was already issued. The plan is done once every item is issued. Run it in the issuing transaction.
func (q Q) MarkPlanItemIssued(ctx context.Context, planID string, seq int, invoiceID string, at time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `UPDATE instalment_plan_items SET invoice_id = $3, issued_at = $4
		WHERE plan_id = $1 AND seq = $2 AND invoice_id IS NULL`, planID, seq, invoiceID, at)
	if err != nil || tag.RowsAffected() != 1 {
		return false, err
	}
	if _, err := q.db.Exec(ctx, `UPDATE invoices SET plan_id = $1, plan_seq = $2 WHERE id = $3`, planID, seq, invoiceID); err != nil {
		return false, err
	}
	_, err = q.db.Exec(ctx, `UPDATE instalment_plans SET status = 'done' WHERE id = $1 AND status = 'active'
		AND NOT EXISTS (SELECT 1 FROM instalment_plan_items WHERE plan_id = $1 AND invoice_id IS NULL)`, planID)
	return err == nil, err
}

// ---- reminders ----

// openInstalments: the open amount of each instalment of the open scheduled invoices matching where. Open of
// instalment k is max(0, E(k) − paid) − max(0, E(k−1) − paid), E the cumulated amounts capped by Σ − credited.
func openInstalments(where string) string {
	return `SELECT x.invoice_id, x.seq, x.due_date, count(*) OVER whole AS cnt,
			GREATEST(0, LEAST(sum(x.amount) OVER upto, sum(x.amount) OVER whole - scheduled.amount_credited) - scheduled.amount_paid)
			- GREATEST(0, LEAST(sum(x.amount) OVER upto - x.amount, sum(x.amount) OVER whole - scheduled.amount_credited) - scheduled.amount_paid) AS open
		FROM invoice_instalments x JOIN invoices scheduled ON scheduled.id = x.invoice_id
		WHERE scheduled.status = 'open' AND scheduled.instalment_interval IS NOT NULL AND ` + where + `
		WINDOW whole AS (PARTITION BY x.invoice_id), upto AS (PARTITION BY x.invoice_id ORDER BY x.seq)`
}

// DueReminders lists the reminders not sent yet whose day has come (workspace time zone): "before" from
// remind_before_days ahead of the due date until it, "after" for the largest remind_after_days already passed. Targets
// are open instalments of scheduled invoices and open partial invoices issued by a plan, with reminders on for the
// workspace (settings "instalments"), the invoice and the plan.
func (q Q) DueReminders(ctx context.Context, now time.Time, invoiceID string) ([]ReminderTarget, error) {
	rows, err := q.db.Query(ctx, `WITH ws AS (
			SELECT w.id, ($1::timestamptz AT TIME ZONE w.timezone)::date AS today,
				COALESCE((s.settings->'instalments'->>'remind_before_days')::int, 5) AS before_days,
				CASE WHEN jsonb_typeof(s.settings->'instalments'->'remind_after_days') = 'array'
					THEN ARRAY(SELECT jsonb_array_elements_text(s.settings->'instalments'->'remind_after_days')::int)
					ELSE ARRAY[3, 10] END AS after_days
			FROM workspaces w LEFT JOIN invoice_settings s ON s.workspace_id = w.id
			WHERE w.deleted_at IS NULL AND COALESCE((s.settings->'instalments'->>'reminders_enabled')::boolean, true)),
		inst AS (`+openInstalments("($2 = '' OR scheduled.id = $2)")+`),
		targets AS (
			SELECT invoice_id, seq, due_date, cnt, open FROM inst
			UNION ALL
			SELECT i.id, i.plan_seq, i.due_date, p.count, GREATEST(0, i.total + i.rounding_amount - i.amount_paid - i.amount_credited)
			FROM invoices i JOIN instalment_plans p ON p.id = i.plan_id
			WHERE ($2 = '' OR i.id = $2) AND i.status = 'open' AND i.reminders_enabled AND p.reminders_enabled
				AND (NOT p.auto_send OR i.sent_at IS NOT NULL))
		SELECT i.workspace_id, t.invoice_id, t.seq, t.cnt, r.kind, r.off, t.due_date::text, t.open,
			COALESCE((SELECT cc.email FROM client_contacts cc WHERE cc.client_id = i.client_id AND cc.is_primary), c.billing_email, c.email, ''),
			i.language, COALESCE(i.number, ''), ws.today::text
		FROM targets t JOIN invoices i ON i.id = t.invoice_id JOIN clients c ON c.id = i.client_id JOIN ws ON ws.id = i.workspace_id
		CROSS JOIN LATERAL (
			SELECT 'before' AS kind, ws.before_days AS off WHERE ws.today >= t.due_date - ws.before_days AND ws.today < t.due_date
			UNION ALL
			SELECT 'after', max(a) FROM unnest(ws.after_days) a WHERE ws.today >= t.due_date + a HAVING max(a) IS NOT NULL) r
		WHERE t.open > 0 AND i.reminders_enabled AND NOT EXISTS (SELECT 1 FROM reminder_log l
			WHERE l.target_id = t.invoice_id AND l.seq = t.seq AND l.kind = r.kind AND l.offset_days = r.off)
		ORDER BY i.workspace_id, t.invoice_id, t.seq, r.kind`, now, invoiceID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ReminderTarget, error) {
		var t ReminderTarget
		err := r.Scan(&t.WorkspaceID, &t.InvoiceID, &t.Seq, &t.Count, &t.Kind, &t.OffsetDays, &t.DueDate, &t.Open, &t.ClientEmail,
			&t.Language, &t.Number, &t.Today)
		return t, err
	})
}

// LogReminder claims an unconfirmed reminder before transport. An existing attempt keeps the same step from retrying.
func (q Q) LogReminder(ctx context.Context, t ReminderTarget, at time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO reminder_log (workspace_id, target_id, seq, kind, offset_days, sent_at, confirmed) VALUES ($1, $2, $3, $4, $5, $6, false)
		ON CONFLICT DO NOTHING`, t.WorkspaceID, t.InvoiceID, t.Seq, t.Kind, t.OffsetDays, at)
	return tag.RowsAffected() == 1, err
}

// DigestRow: one line of the digest's "Instalments" section. Kind is due (within 7 days), overdue, issued (a plan
// partial issued in the last 24 hours) or not_issued (a plan item whose issue day came, InvoiceID its source draft).
type DigestRow struct {
	WorkspaceID string
	Kind        string
	InvoiceID   string
	Number      string // "" for not_issued
	ClientName  string
	Seq, Count  int
	DueDate     string
	Open        Money // 0 for issued and not_issued
	Currency    string
}

// digestRows: the digest rows of the live workspaces with the digest on; $1 a workspace or ” for all, $2 now.
func digestRows() string {
	today := `($2::timestamptz AT TIME ZONE w.timezone)::date`
	return `WITH inst AS (` + openInstalments("($1 = '' OR scheduled.workspace_id = $1)") + `),
		open_rows AS (
			SELECT invoice_id, seq, cnt::int AS cnt, due_date, open FROM inst
			UNION ALL
			SELECT i.id, i.plan_seq, p.count, i.due_date, GREATEST(0, i.total + i.rounding_amount - i.amount_paid - i.amount_credited)
			FROM invoices i JOIN instalment_plans p ON p.id = i.plan_id WHERE i.status = 'open' AND ($1 = '' OR i.workspace_id = $1)),
		rows AS (
			SELECT CASE WHEN o.due_date < ` + today + ` THEN 'overdue' ELSE 'due' END AS kind, i.workspace_id, o.invoice_id,
				i.number, i.client_id, i.buyer, o.seq, o.cnt, o.due_date, o.open, i.currency
			FROM open_rows o JOIN invoices i ON i.id = o.invoice_id JOIN workspaces w ON w.id = i.workspace_id
			WHERE o.open > 0 AND o.due_date <= ` + today + ` + 7
			UNION ALL
			SELECT 'issued', p.workspace_id, it.invoice_id, i.number, i.client_id, i.buyer, it.seq, p.count, it.due_date, 0, i.currency
			FROM instalment_plan_items it JOIN instalment_plans p ON p.id = it.plan_id JOIN invoices i ON i.id = it.invoice_id
			WHERE it.issued_at > $2::timestamptz - interval '24 hours' AND ($1 = '' OR p.workspace_id = $1)
			UNION ALL
			SELECT CASE WHEN i.send_uncertain_at IS NOT NULL OR i.send_started_at IS NOT NULL THEN 'check_delivery' ELSE 'send_original' END,
				i.workspace_id, i.id, i.number, i.client_id, i.buyer, i.plan_seq, p.count, i.due_date, 0, i.currency
			FROM invoices i JOIN instalment_plans p ON p.id = i.plan_id
			WHERE p.auto_send AND i.status = 'open' AND i.sent_at IS NULL AND ($1 = '' OR i.workspace_id = $1)
			  AND (i.send_uncertain_at IS NOT NULL OR i.send_started_at <= $2::timestamptz - interval '15 minutes'
				    OR i.issued_at <= $2::timestamptz - interval '7 days')
			UNION ALL
			SELECT 'not_issued', p.workspace_id, p.source_invoice_id, NULL, i.client_id, i.buyer, it.seq, p.count, it.due_date, 0, i.currency
			FROM instalment_plan_items it JOIN instalment_plans p ON p.id = it.plan_id JOIN invoices i ON i.id = p.source_invoice_id
				JOIN workspaces w ON w.id = p.workspace_id
			WHERE p.status = 'active' AND it.invoice_id IS NULL AND it.issue_on <= ` + today + ` AND ($1 = '' OR p.workspace_id = $1))
		SELECT r.workspace_id, r.kind, r.invoice_id, COALESCE(r.number, ''), COALESCE(r.buyer->>'name', c.name), r.seq, r.cnt,
			r.due_date::text, r.open, r.currency
		FROM rows r JOIN workspaces w ON w.id = r.workspace_id JOIN clients c ON c.id = r.client_id
		WHERE w.deleted_at IS NULL AND coalesce((SELECT s.digest FROM engagement_settings s WHERE s.workspace_id = w.id), true)
		ORDER BY r.workspace_id, array_position(ARRAY['overdue', 'due', 'not_issued', 'issued'], r.kind), r.due_date, r.invoice_id, r.seq`
}

// DigestRows: the "Instalments" digest rows of one workspace at now (its time zone), overdue, due, not issued, issued.
func (q Q) DigestRows(ctx context.Context, workspaceID string, now time.Time) ([]DigestRow, error) {
	rows, err := q.db.Query(ctx, digestRows(), workspaceID, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DigestRow, error) {
		var d DigestRow
		err := r.Scan(&d.WorkspaceID, &d.Kind, &d.InvoiceID, &d.Number, &d.ClientName, &d.Seq, &d.Count, &d.DueDate, &d.Open, &d.Currency)
		return d, err
	})
}

// InstalmentDigestWorkspaces: the live workspaces (id and time zone) with the digest on and digest rows at now.
func (q Q) InstalmentDigestWorkspaces(ctx context.Context, now time.Time) ([]Workspace, error) {
	rows, err := q.db.Query(ctx, `SELECT DISTINCT d.workspace_id, w.name, w.timezone FROM (`+digestRows()+`) d(workspace_id)
		JOIN workspaces w ON w.id = d.workspace_id ORDER BY d.workspace_id`, "", now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Workspace, error) {
		var w Workspace
		err := r.Scan(&w.ID, &w.Name, &w.Timezone)
		return w, err
	})
}

// FinishReminder confirms a recorded attempt or releases it after a definite refusal.
func (q Q) FinishReminder(ctx context.Context, t ReminderTarget, sent bool) error {
	statement := "DELETE FROM reminder_log"
	if sent {
		statement = "UPDATE reminder_log SET confirmed = true"
	}
	_, err := q.db.Exec(ctx, statement+` WHERE workspace_id = $1 AND target_id = $2 AND seq = $3 AND kind = $4 AND offset_days = $5 AND NOT confirmed`,
		t.WorkspaceID, t.InvoiceID, t.Seq, t.Kind, t.OffsetDays)
	return err
}
