package store

import (
	"context"
	"errors"
	"strings"
	"time"
)

// The operator's read-only questions (internal/admintelegram): aggregates over every workspace, and one workspace's
// summary. Nothing here reads secrets, tokens, sealed or HR fields or document contents.

const operatorDay = 24 * time.Hour

type OperatorUsers struct {
	Total, Today, Week, Month int64 // not deleted; signed up since the UTC day's start, 7 and 30 days ago
	Active7, Active30         int64 // people with a session used in the last 7 and 30 days
}

func (q Q) OperatorUsers(ctx context.Context, now time.Time) (OperatorUsers, error) {
	var u OperatorUsers
	err := q.db.QueryRow(ctx, `SELECT
			count(*) FILTER (WHERE deleted_at IS NULL),
			count(*) FILTER (WHERE created_at >= $1),
			count(*) FILTER (WHERE created_at >= $2),
			count(*) FILTER (WHERE created_at >= $3),
			(SELECT count(DISTINCT user_id) FROM sessions WHERE last_active_at >= $2),
			(SELECT count(DISTINCT user_id) FROM sessions WHERE last_active_at >= $3)
		FROM users`, now.UTC().Truncate(operatorDay), now.Add(-7*operatorDay), now.Add(-30*operatorDay)).
		Scan(&u.Total, &u.Today, &u.Week, &u.Month, &u.Active7, &u.Active30)
	return u, err
}

type OperatorWorkspaces struct {
	Total, Week, Month, Deleted int64 // Total and the new ones not deleted; Deleted soft-deleted (restorable 30 days)
}

func (q Q) OperatorWorkspaces(ctx context.Context, now time.Time) (OperatorWorkspaces, error) {
	var w OperatorWorkspaces
	err := q.db.QueryRow(ctx, `SELECT
			count(*) FILTER (WHERE deleted_at IS NULL),
			count(*) FILTER (WHERE deleted_at IS NULL AND created_at >= $1),
			count(*) FILTER (WHERE deleted_at IS NULL AND created_at >= $2),
			count(*) FILTER (WHERE deleted_at IS NOT NULL)
		FROM workspaces`, now.Add(-7*operatorDay), now.Add(-30*operatorDay)).Scan(&w.Total, &w.Week, &w.Month, &w.Deleted)
	return w, err
}

// OperatorSubscription is a live workspace's subscription as billing stored it, with the currency it was sold in.
type OperatorSubscription struct {
	Billing
	Currency string
}

// OperatorSubscriptions are the subscriptions of workspaces not deleted, and how many ended (canceled) since since.
func (q Q) OperatorSubscriptions(ctx context.Context, since time.Time) ([]OperatorSubscription, int64, error) {
	rows, err := q.db.Query(ctx, `SELECT b.status, b.plan, b.billing_interval, b.trial_end, b.cancel_at_period_end,
			b.per_seat, b.seats, b.paid_seats, b.plan_expires_at,
			coalesce((SELECT c.currency FROM billing_checkouts c WHERE c.workspace_id = b.workspace_id
				AND c.settled_subscription = b.stripe_subscription_id ORDER BY c.created_at DESC LIMIT 1), 'chf')
		FROM workspace_billing b JOIN workspaces w ON w.id = b.workspace_id
		WHERE b.stripe_subscription_id IS NOT NULL AND w.deleted_at IS NULL`)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var subs []OperatorSubscription
	for rows.Next() {
		var s OperatorSubscription
		if err := rows.Scan(&s.Status, &s.Plan, &s.Interval, &s.TrialEnd, &s.CancelAtPeriodEnd, &s.PerSeat, &s.Seats,
			&s.PaidSeats, &s.PlanExpiresAt, &s.Currency); err != nil {
			return nil, 0, err
		}
		subs = append(subs, s)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var cancelled int64
	err = q.db.QueryRow(ctx, `SELECT count(*) FROM workspace_billing WHERE status = 'canceled' AND updated_at >= $1`, since).
		Scan(&cancelled)
	return subs, cancelled, err
}

type OperatorSignup struct {
	At               time.Time
	Email, Workspace string // the workspace they own first; "" when none
	Billing          Billing
}

// OperatorSignups are the latest n people to sign up, newest first.
func (q Q) OperatorSignups(ctx context.Context, n int) ([]OperatorSignup, error) {
	rows, err := q.db.Query(ctx, `SELECT u.created_at, u.email, coalesce(w.name, ''), coalesce(b.status, ''),
			coalesce(b.plan, ''), b.plan_expires_at
		FROM users u
		LEFT JOIN LATERAL (SELECT m.workspace_id FROM workspace_members m WHERE m.user_id = u.id
			ORDER BY m.role <> 'owner', m.created_at LIMIT 1) m ON true
		LEFT JOIN workspaces w ON w.id = m.workspace_id
		LEFT JOIN workspace_billing b ON b.workspace_id = m.workspace_id
		WHERE u.deleted_at IS NULL
		ORDER BY u.created_at DESC LIMIT $1`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OperatorSignup
	for rows.Next() {
		var s OperatorSignup
		if err := rows.Scan(&s.At, &s.Email, &s.Workspace, &s.Billing.Status, &s.Billing.Plan, &s.Billing.PlanExpiresAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

type OperatorWorkspace struct {
	ID, Name, Slug                string
	CreatedAt                     time.Time
	DeletedAt, LastActive         *time.Time
	Billing                       Billing
	Members, Clients, Invoices    int64 // Invoices: issued
	Documents, StorageBytes       int64
	HeidiTokens, AutomationTokens int64 // this UTC month
	OwnerEmail                    string
	OtherWorkspacesOfEmail        int64 // when found by email: that person's further workspaces
}

// OperatorFindWorkspace is one workspace's summary, found by its id, a portal slug (current or earlier) or the email
// of a member (their first workspace, owned ones first). ErrNotFound when none matches.
func (q Q) OperatorFindWorkspace(ctx context.Context, key string, now time.Time) (OperatorWorkspace, error) {
	key = strings.TrimSpace(key)
	var w OperatorWorkspace
	err := q.db.QueryRow(ctx, `SELECT w.id, 0 FROM workspaces w WHERE w.id = $1
		UNION ALL (SELECT s.workspace_id, 0 FROM portal_slugs s WHERE s.slug = lower($1) LIMIT 1)
		UNION ALL (SELECT m.workspace_id, count(*) OVER () - 1 FROM users u JOIN workspace_members m ON m.user_id = u.id
			WHERE lower(u.email) = lower($1) ORDER BY m.role <> 'owner', m.created_at LIMIT 1)
		LIMIT 1`, key).Scan(&w.ID, &w.OtherWorkspacesOfEmail)
	if err != nil {
		return w, err
	}
	err = q.db.QueryRow(ctx, `SELECT w.name, w.created_at, w.deleted_at,
			coalesce((SELECT slug FROM portal_slugs WHERE workspace_id = w.id AND retired_at IS NULL), ''),
			coalesce(b.status, ''), coalesce(b.plan, ''), coalesce(b.billing_interval, ''), b.trial_end, b.plan_expires_at,
			coalesce(b.cancel_at_period_end, false), b.seats, b.paid_seats,
			(SELECT count(*) FROM workspace_members WHERE workspace_id = w.id),
			(SELECT count(*) FROM clients WHERE workspace_id = w.id AND deleted_at IS NULL),
			(SELECT count(*) FROM invoices WHERE workspace_id = w.id AND issued_at IS NOT NULL),
			(SELECT count(*) FROM documents WHERE workspace_id = w.id AND deleted_at IS NULL AND NOT hr_private),
			(SELECT coalesce(sum(size), 0) FROM stored_objects WHERE workspace_id = w.id),
			coalesce((SELECT tokens_used FROM heidi_usage WHERE workspace_id = w.id AND period = $2 AND pool = 'heidi'), 0),
			coalesce((SELECT tokens_used FROM heidi_usage WHERE workspace_id = w.id AND period = $2 AND pool = 'automation'), 0),
			(SELECT max(last_active_at) FROM sessions WHERE workspace_id = w.id),
			coalesce((SELECT u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
				WHERE m.workspace_id = w.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1), '')
		FROM workspaces w LEFT JOIN workspace_billing b ON b.workspace_id = w.id WHERE w.id = $1`, w.ID, UsagePeriod(now)).
		Scan(&w.Name, &w.CreatedAt, &w.DeletedAt, &w.Slug, &w.Billing.Status, &w.Billing.Plan, &w.Billing.Interval,
			&w.Billing.TrialEnd, &w.Billing.PlanExpiresAt, &w.Billing.CancelAtPeriodEnd, &w.Billing.Seats, &w.Billing.PaidSeats,
			&w.Members, &w.Clients, &w.Invoices, &w.Documents, &w.StorageBytes, &w.HeidiTokens, &w.AutomationTokens,
			&w.LastActive, &w.OwnerEmail)
	return w, err
}

type OperatorPool struct {
	Pool               string
	Tokens, CostMicros int64
}

type OperatorRank struct {
	Workspace string // its name
	Amount    int64
}

type OperatorUsage struct {
	StorageBytes   int64
	Pools          []OperatorPool // this UTC month, Heidi's and the automation pool
	OperatorTokens int64          // the operator bot's own tokens today
	Emails         int64          // business email recipients this UTC month
	TopStorage     []OperatorRank
	TopAI          []OperatorRank // tokens of both pools this UTC month
}

func (q Q) OperatorUsage(ctx context.Context, now time.Time) (OperatorUsage, error) {
	var u OperatorUsage
	period := UsagePeriod(now)
	err := q.db.QueryRow(ctx, `SELECT
			(SELECT coalesce(sum(size), 0) FROM stored_objects),
			(SELECT coalesce(sum(consumed + reserved), 0) FROM usage_events WHERE resource = $2 AND period = $1),
			coalesce((SELECT tokens FROM operator_ai_usage WHERE day = $3::date), 0)`,
		period, EmailRecipients, now.UTC().Format(time.DateOnly)).Scan(&u.StorageBytes, &u.Emails, &u.OperatorTokens)
	if err != nil {
		return u, err
	}
	rows, err := q.db.Query(ctx, `SELECT pool, sum(tokens_used), sum(cost_micros) FROM heidi_usage WHERE period = $1
		GROUP BY pool ORDER BY pool DESC`, period)
	if err != nil {
		return u, err
	}
	for rows.Next() {
		var p OperatorPool
		if err := rows.Scan(&p.Pool, &p.Tokens, &p.CostMicros); err != nil {
			rows.Close()
			return u, err
		}
		u.Pools = append(u.Pools, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return u, err
	}
	if u.TopStorage, err = q.operatorRanks(ctx, `SELECT w.name, t.amount FROM (SELECT workspace_id, sum(size) AS amount
		FROM stored_objects GROUP BY workspace_id ORDER BY amount DESC LIMIT 5) t JOIN workspaces w ON w.id = t.workspace_id
		WHERE t.amount > 0 ORDER BY t.amount DESC`); err != nil {
		return u, err
	}
	u.TopAI, err = q.operatorRanks(ctx, `SELECT w.name, t.amount FROM (SELECT workspace_id, sum(tokens_used) AS amount
		FROM heidi_usage WHERE period = $1 GROUP BY workspace_id ORDER BY amount DESC LIMIT 5) t
		JOIN workspaces w ON w.id = t.workspace_id WHERE t.amount > 0 ORDER BY t.amount DESC`, period)
	return u, err
}

func (q Q) operatorRanks(ctx context.Context, sql string, args ...any) ([]OperatorRank, error) {
	rows, err := q.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OperatorRank
	for rows.Next() {
		var r OperatorRank
		if err := rows.Scan(&r.Workspace, &r.Amount); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type OperatorHealth struct {
	Connections, MaxConnections int64 // client connections to the server (every instance), and its max_connections
	PoolInUse, PoolMax          int64 // this instance's pool
	ZipExports, CalendarPushes  int64 // waiting
	StagedUploads, ImportFiles  int64 // staged files kept; import files queued or being read
	AdminAlerts                 int64 // operator alerts not delivered yet
	// Failed in the last 24 hours: e-invoice transmissions, ZIP exports, import files; calendar pushes now retrying.
	FailedEInvoices, FailedZips, FailedImports, FailingPushes int64
}

func (s *Store) OperatorHealth(ctx context.Context, now time.Time) (OperatorHealth, error) {
	var h OperatorHealth
	err := s.pool.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend'),
			current_setting('max_connections')::bigint,
			(SELECT count(*) FROM document_zip_exports WHERE status = 'pending'),
			(SELECT count(*) FROM calendar_push_queue),
			(SELECT count(*) FROM staged_uploads),
			(SELECT count(*) FROM import_files WHERE status IN ('queued', 'extracting')),
			(SELECT count(*) FROM admin_alerts),
			(SELECT count(*) FROM einvoice_transmissions WHERE status IN ('failed', 'rejected') AND updated_at >= $1),
			(SELECT count(*) FROM document_zip_exports WHERE status = 'failed' AND finished_at >= $1),
			(SELECT count(*) FROM import_files WHERE status = 'failed' AND updated_at >= $1),
			(SELECT count(*) FROM calendar_push_queue WHERE last_error IS NOT NULL)`, now.Add(-operatorDay)).
		Scan(&h.Connections, &h.MaxConnections, &h.ZipExports, &h.CalendarPushes, &h.StagedUploads, &h.ImportFiles,
			&h.AdminAlerts, &h.FailedEInvoices, &h.FailedZips, &h.FailedImports, &h.FailingPushes)
	stat := s.pool.Stat()
	h.PoolInUse, h.PoolMax = int64(stat.AcquiredConns()), int64(stat.MaxConns())
	return h, err
}

// ---- the bot's own state ----

// ClaimAdminBot takes or renews the polling lease for holder for ttl (by the database's clock, shared by every
// instance); false while another instance holds it. offset is the next Telegram update offset to ask for.
func (q Q) ClaimAdminBot(ctx context.Context, holder string, ttl time.Duration) (offset int64, ok bool, err error) {
	err = q.db.QueryRow(ctx, `INSERT INTO admin_bot_lease (holder, until) VALUES ($1, now() + $2 * interval '1 second')
		ON CONFLICT (id) DO UPDATE SET holder = EXCLUDED.holder, until = EXCLUDED.until
			WHERE admin_bot_lease.holder = EXCLUDED.holder OR admin_bot_lease.until < now()
		RETURNING update_offset`, holder, ttl.Seconds()).Scan(&offset)
	if errors.Is(err, ErrNotFound) {
		return 0, false, nil
	}
	return offset, err == nil, err
}

// SaveAdminBotOffset keeps the next update offset, only while holder holds the lease.
func (q Q) SaveAdminBotOffset(ctx context.Context, holder string, offset int64) error {
	_, err := q.db.Exec(ctx, `UPDATE admin_bot_lease SET update_offset = $2 WHERE holder = $1`, holder, offset)
	return err
}

// ReleaseAdminBot gives the lease up at shutdown, so the next instance polls at once.
func (q Q) ReleaseAdminBot(ctx context.Context, holder string) error {
	_, err := q.db.Exec(ctx, `UPDATE admin_bot_lease SET until = now() - interval '1 second' WHERE holder = $1`, holder)
	return err
}

// ReserveOperatorAI reserves tokens of today's (UTC) operator allowance cap; false when they do not fit.
func (q Q) ReserveOperatorAI(ctx context.Context, now time.Time, tokens, limit int64) (bool, error) {
	if tokens > limit {
		return false, nil
	}
	tag, err := q.db.Exec(ctx, `INSERT INTO operator_ai_usage (day, tokens) VALUES ($1::date, $2)
		ON CONFLICT (day) DO UPDATE SET tokens = operator_ai_usage.tokens + EXCLUDED.tokens
			WHERE operator_ai_usage.tokens + EXCLUDED.tokens <= $3`, now.UTC().Format(time.DateOnly), tokens, limit)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// SettleOperatorAI replaces a reservation by what the call used and adds its cost.
func (q Q) SettleOperatorAI(ctx context.Context, now time.Time, reserved, used, costMicros int64) error {
	_, err := q.db.Exec(ctx, `UPDATE operator_ai_usage SET tokens = greatest(tokens - $2 + $3, 0), cost_micros = cost_micros + $4
		WHERE day = $1::date`, now.UTC().Format(time.DateOnly), reserved, used, costMicros)
	return err
}
