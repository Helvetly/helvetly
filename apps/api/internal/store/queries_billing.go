package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Workspaces and their billing (internal/workspaces, internal/billing).

// Billing is a workspace's Stripe state; the zero value is a workspace that never went to Checkout.
type Billing struct {
	CustomerID, SubscriptionID string
	Status, Plan, Interval     string
	CurrentPeriodEnd, TrialEnd *time.Time
	CancelAtPeriodEnd          bool
	TrialUsed                  bool
	Discount                   json.RawMessage // the subscription's discount as billing stored it; nil when none
	PerSeat                    bool            // the subscription's price is per seat (else an earlier flat price)
	Seats                      *int64          // the quantity Stripe bills; nil before a subscription is recorded
}

// Subscription is what a Stripe subscription says, written by ApplySubscription.
type Subscription struct {
	ID, Status, Plan, Interval string
	CurrentPeriodEnd, TrialEnd *time.Time
	CancelAtPeriodEnd          bool
	Discount                   json.RawMessage
	PerSeat                    bool
	Seats                      int64 // the subscription item's quantity
}

// Usage is what the plan limits count.
type Usage struct {
	Members, Clients, InvoicesThisMonth, ExpensesThisMonth int64
	Products, Engagements, SignaturesThisMonth             int64
	StorageBytes                                           int64
	AITokensThisMonth                                      int64 // heidi_usage of the calendar month
}

// PlanLimit is one cap of one plan (plan_limits); Max nil is unlimited.
type PlanLimit struct {
	Plan, Limit string
	Max         *int64
}

// PlanLimits are every plan's caps, as seeded in plan_limits.
func (q Q) PlanLimits(ctx context.Context) ([]PlanLimit, error) {
	rows, err := q.db.Query(ctx, `SELECT plan, limit_key, max_value FROM plan_limits`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PlanLimit
	for rows.Next() {
		var l PlanLimit
		if err := rows.Scan(&l.Plan, &l.Limit, &l.Max); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (q Q) WorkspaceBilling(ctx context.Context, workspaceID string) (Billing, error) {
	var b Billing
	var customer, sub *string
	err := q.db.QueryRow(ctx, `SELECT stripe_customer_id, stripe_subscription_id, status, plan, billing_interval,
			current_period_end, trial_end, cancel_at_period_end, trial_used, discount, per_seat, seats
		FROM workspace_billing WHERE workspace_id = $1`, workspaceID).
		Scan(&customer, &sub, &b.Status, &b.Plan, &b.Interval, &b.CurrentPeriodEnd, &b.TrialEnd, &b.CancelAtPeriodEnd, &b.TrialUsed,
			&b.Discount, &b.PerSeat, &b.Seats)
	if errors.Is(err, ErrNotFound) {
		return Billing{}, nil
	}
	if customer != nil {
		b.CustomerID = *customer
	}
	if sub != nil {
		b.SubscriptionID = *sub
	}
	return b, err
}

// LockBilling serialises Checkout, plan changes and resource admissions until the transaction ends.
func (q Q) LockBilling(ctx context.Context, workspaceID string) error {
	return q.LockAddress(ctx, "workspace-billing:"+workspaceID)
}

func (q Q) SetStripeCustomer(ctx context.Context, workspaceID, customerID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_billing (workspace_id, stripe_customer_id, updated_at) VALUES ($1, $2, $3)
		ON CONFLICT (workspace_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = EXCLUDED.updated_at`,
		workspaceID, customerID, now)
	return err
}

// ApplySubscription records the subscription's state; a trial on it marks the workspace's trial used.
func (q Q) ApplySubscription(ctx context.Context, workspaceID, customerID string, s Subscription, now time.Time) error {
	var discount *string
	if len(s.Discount) > 0 {
		d := string(s.Discount)
		discount = &d
	}
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_billing (workspace_id, stripe_customer_id, stripe_subscription_id, status,
			plan, billing_interval, current_period_end, trial_end, cancel_at_period_end, trial_used, updated_at, discount,
			per_seat, seats)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $8::timestamptz IS NOT NULL, $10, $11::jsonb, $12, $13)
		ON CONFLICT (workspace_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id,
			stripe_subscription_id = EXCLUDED.stripe_subscription_id, status = EXCLUDED.status, plan = EXCLUDED.plan,
			billing_interval = EXCLUDED.billing_interval, current_period_end = EXCLUDED.current_period_end,
			trial_end = EXCLUDED.trial_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
			trial_used = workspace_billing.trial_used OR EXCLUDED.trial_used, updated_at = EXCLUDED.updated_at,
			discount = EXCLUDED.discount, per_seat = EXCLUDED.per_seat, seats = EXCLUDED.seats`,
		workspaceID, customerID, s.ID, s.Status, s.Plan, s.Interval, s.CurrentPeriodEnd, s.TrialEnd, s.CancelAtPeriodEnd, now, discount,
		s.PerSeat, s.Seats)
	return err
}

// RecordStripeEvent reports false when the event was recorded before (Stripe delivers at least once).
func (q Q) RecordStripeEvent(ctx context.Context, id, typ string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO stripe_events (id, type, received_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		id, typ, now)
	return tag.RowsAffected() == 1, err
}

// WorkspaceUsage counts what the plan limits cover; monthly counts start at monthStart (midnight in the workspace's
// time zone, so its date is the workspace's month). Members are the people besides the workspace's owner: every
// workspace keeps one, and the plan sells the seats for the rest. Only accepted invitations count: a seat is taken
// when the invitation is accepted (JoinInvitedMember), not when it is sent. Engagements count while not cancelled and not ended before today, the civil date of now there.
func (q Q) WorkspaceUsage(ctx context.Context, workspaceID string, monthStart, now time.Time) (Usage, error) {
	today := now.In(monthStart.Location()).Format(time.DateOnly)
	var u Usage
	err := q.db.QueryRow(ctx, `SELECT
			greatest((SELECT count(*) FROM workspace_members WHERE workspace_id = $1) - 1, 0),
			(SELECT count(*) FROM clients WHERE workspace_id = $1 AND deleted_at IS NULL),
			(SELECT count(*) FROM invoices WHERE workspace_id = $1 AND kind NOT IN ('credit_note','corrected') AND created_at >= $2),
			(SELECT count(*) FROM expenses WHERE workspace_id = $1 AND deleted_at IS NULL AND created_at >= $2),
			(SELECT count(*) FROM products WHERE workspace_id = $1 AND deleted_at IS NULL),
			(SELECT count(*) FROM engagements WHERE workspace_id = $1 AND deleted_at IS NULL
				AND (cancelled_on IS NULL OR cancelled_on >= $3::date) AND (end_date IS NULL OR end_date >= $3::date)),
			(SELECT count(*) FROM signature_requests WHERE workspace_id = $1 AND created_at >= $2),
			(SELECT coalesce(sum(size), 0) FROM documents WHERE workspace_id = $1)
			+ (SELECT coalesce(sum(size), 0) FROM expense_receipts WHERE workspace_id = $1),
			(SELECT coalesce(sum(tokens_used), 0) FROM heidi_usage WHERE workspace_id = $1 AND period = $4)`,
		workspaceID, monthStart, today, monthStart.Format("2006-01")).Scan(&u.Members, &u.Clients, &u.InvoicesThisMonth, &u.ExpensesThisMonth,
		&u.Products, &u.Engagements, &u.SignaturesThisMonth, &u.StorageBytes, &u.AITokensThisMonth)
	return u, err
}

// Seats is the number of people in the workspace (owner, admins and members): what a per-seat subscription is
// billed for. Open invitations take no seat until accepted.
func (q Q) Seats(ctx context.Context, workspaceID string) (int64, error) {
	var n int64
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM workspace_members WHERE workspace_id = $1`, workspaceID).Scan(&n)
	return n, err
}

// SeatsOutOfStep are the workspaces whose live per-seat subscription bills another quantity than their members,
// for the job that catches up on a missed sync.
func (q Q) SeatsOutOfStep(ctx context.Context) ([]string, error) {
	rows, err := q.db.Query(ctx, `SELECT b.workspace_id FROM workspace_billing b JOIN workspaces w ON w.id = b.workspace_id
		WHERE w.deleted_at IS NULL AND b.per_seat AND b.status IN ('active', 'trialing', 'past_due')
			AND b.seats IS DISTINCT FROM (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = b.workspace_id)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// LockStorageUsage serializes exact storage admission until the caller's transaction commits.
func (q Q) LockStorageUsage(ctx context.Context, workspaceID string) error {
	return q.LockAdmission(ctx, workspaceID, "storage_bytes")
}

// AdmissionWorkspace is the workspace clock for a canonical write, including jobs without a session.
func (q Q) AdmissionWorkspace(ctx context.Context, id string) (Workspace, error) {
	var w Workspace
	err := q.db.QueryRow(ctx, `SELECT id,name,timezone FROM workspaces WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&w.ID, &w.Name, &w.Timezone)
	return w, err
}

func (q Q) UpdateWorkspace(ctx context.Context, w Workspace) error {
	_, err := q.db.Exec(ctx, `UPDATE workspaces SET name = $2, timezone = $3 WHERE id = $1 AND deleted_at IS NULL`, w.ID, w.Name, w.Timezone)
	return err
}

// DeleteWorkspace marks the workspace deleted and removes everyone's way in: members, sessions, open invitations.
func (q Q) DeleteWorkspace(ctx context.Context, workspaceID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `WITH
			w AS (UPDATE workspaces SET deleted_at = $2 WHERE id = $1),
			i AS (UPDATE workspace_invitations SET revoked_at = $2
				WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL),
			s AS (DELETE FROM sessions WHERE workspace_id = $1)
		DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID, now)
	return err
}

// AddAITokenPack records a paid AI token pack for the workspace's month period; false when this Checkout Session was
// recorded before (Stripe delivers at least once).
func (q Q) AddAITokenPack(ctx context.Context, sessionID, workspaceID, period string, tokens int64, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO ai_token_packs (checkout_session_id, workspace_id, period, tokens, created_at)
		VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, sessionID, workspaceID, period, tokens, now)
	return tag.RowsAffected() == 1, err
}

// AITokenPacks is the tokens the workspace bought for the month period (YYYY-MM), less those taken back.
func (q Q) AITokenPacks(ctx context.Context, workspaceID, period string) (int64, error) {
	var n int64
	err := q.db.QueryRow(ctx, `SELECT coalesce(sum(tokens - revoked), 0) FROM ai_token_packs WHERE workspace_id = $1 AND period = $2`,
		workspaceID, period).Scan(&n)
	return n, err
}

// RevokeAITokenPack takes back a refunded or charged-back pack, once: up to max of its tokens when it counts for
// period, none when it has lapsed. A pack not recorded yet is recorded taken back whole, so its late credit adds
// nothing. ok is false when the pack was taken back before (or is another workspace's).
func (q Q) RevokeAITokenPack(ctx context.Context, sessionID, workspaceID, period string, tokens, max int64, now time.Time) (taken int64, ok bool, err error) {
	err = q.db.QueryRow(ctx, `INSERT INTO ai_token_packs (checkout_session_id, workspace_id, period, tokens, revoked, revoked_at, created_at)
		VALUES ($1, $2, $3, $4, $4, $6, $6)
		ON CONFLICT (checkout_session_id) DO UPDATE SET revoked_at = $6,
			revoked = CASE WHEN ai_token_packs.period = EXCLUDED.period THEN least(ai_token_packs.tokens, greatest($5::bigint, 0)) ELSE 0 END
		WHERE ai_token_packs.revoked_at IS NULL AND ai_token_packs.workspace_id = EXCLUDED.workspace_id
		RETURNING revoked`, sessionID, workspaceID, period, tokens, max, now).Scan(&taken)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return taken, err == nil, err
}

// SaveDispute records a dispute's latest status; fresh is true the first time the dispute is seen.
func (q Q) SaveDispute(ctx context.Context, id, workspaceID, status string, now time.Time) (fresh bool, err error) {
	err = q.db.QueryRow(ctx, `INSERT INTO billing_disputes (id, workspace_id, status, updated_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
		RETURNING xmax = 0`, id, workspaceID, status, now).Scan(&fresh)
	return fresh, err
}

// Disputed reports whether a payment of the workspace is in a dispute that is not closed yet.
func (q Q) Disputed(ctx context.Context, workspaceID string) (bool, error) {
	var open bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM billing_disputes WHERE workspace_id = $1
		AND status NOT IN ('won', 'lost', 'warning_closed'))`, workspaceID).Scan(&open)
	return open, err
}
