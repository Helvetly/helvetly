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
	PlanExpiresAt              *time.Time      // the paid end plus the billing grace; nil when not known yet
	SeatsChangedAt             *time.Time      // when the membership last changed (MarkSeatsChanged)
	TrialStart                 *time.Time      // when the trial began; its pools count from here, across months
	PaidSeats                  *int64          // the seats paid for the current period; nil before it is known
	PendingPlan                string          // a plan change scheduled for PendingAt (the paid period's end); "" none
	PendingInterval            string
	PendingAt                  *time.Time
	AllowancePeriod            string           // the UTC month (2006-01) Allowances apply in
	Allowances                 map[string]int64 // costly monthly allowances granted pro rata after an increase
}

// Subscription is what a Stripe subscription says, written by ApplySubscription.
type Subscription struct {
	ID, Status, Plan, Interval string
	CurrentPeriodEnd, TrialEnd *time.Time
	CancelAtPeriodEnd          bool
	Discount                   json.RawMessage
	PerSeat                    bool
	Seats                      int64 // the subscription item's quantity
	PaidSeats                  int64 // the seats paid for the current period: Seats, or more until a reduction renews
	PlanExpiresAt              *time.Time
	TrialStart                 *time.Time
	PendingPlan                string
	PendingInterval            string
	PendingAt                  *time.Time
}

// Usage is what the plan limits count.
type Usage struct {
	Members, Clients, InvoicesThisMonth, ExpensesThisMonth int64
	Products, Engagements, SignaturesThisMonth             int64
	StorageBytes                                           int64
	AITokensThisMonth                                      int64 // heidi_usage of the quota month
	InvoiceDrafts, QuotesRetained                          int64
	AutomationsThisMonth                                   int64 // automatic actions used and reserved
}

func (q Q) WorkspaceBilling(ctx context.Context, workspaceID string) (Billing, error) {
	var b Billing
	var customer, sub *string
	err := q.db.QueryRow(ctx, `SELECT stripe_customer_id, stripe_subscription_id, status, plan, billing_interval,
			current_period_end, trial_end, cancel_at_period_end, trial_used, discount, per_seat, seats, plan_expires_at,
			seats_changed_at, trial_start, paid_seats, pending_plan, pending_interval, pending_at, allowance_period, allowances
		FROM workspace_billing WHERE workspace_id = $1`, workspaceID).
		Scan(&customer, &sub, &b.Status, &b.Plan, &b.Interval, &b.CurrentPeriodEnd, &b.TrialEnd, &b.CancelAtPeriodEnd, &b.TrialUsed,
			&b.Discount, &b.PerSeat, &b.Seats, &b.PlanExpiresAt, &b.SeatsChangedAt, &b.TrialStart, &b.PaidSeats, &b.PendingPlan,
			&b.PendingInterval, &b.PendingAt, &b.AllowancePeriod, &b.Allowances)
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

// ApplySubscription records the subscription's state; a trial on it marks the workspace's trial used. A workspace
// without an offer is assigned the current one (the offer on sale when its subscription was first recorded).
func (q Q) ApplySubscription(ctx context.Context, workspaceID, customerID string, s Subscription, now time.Time) error {
	var discount *string
	if len(s.Discount) > 0 {
		d := string(s.Discount)
		discount = &d
	}
	_, err := q.db.Exec(ctx, `INSERT INTO workspace_billing (workspace_id, stripe_customer_id, stripe_subscription_id, status,
			plan, billing_interval, current_period_end, trial_end, cancel_at_period_end, trial_used, updated_at, discount,
			per_seat, seats, plan_expires_at, offer_id, paid_seats, trial_start, pending_plan, pending_interval, pending_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $8::timestamptz IS NOT NULL, $10, $11::jsonb, $12, $13, $14,
			(SELECT id FROM offer_versions ORDER BY published_at DESC, id DESC LIMIT 1), $15, $16, $17, $18, $19)
		ON CONFLICT (workspace_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id,
			stripe_subscription_id = EXCLUDED.stripe_subscription_id, status = EXCLUDED.status, plan = EXCLUDED.plan,
			billing_interval = EXCLUDED.billing_interval, current_period_end = EXCLUDED.current_period_end,
			trial_end = EXCLUDED.trial_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end,
			trial_used = workspace_billing.trial_used OR EXCLUDED.trial_used, updated_at = EXCLUDED.updated_at,
			discount = EXCLUDED.discount, per_seat = EXCLUDED.per_seat, seats = EXCLUDED.seats,
			plan_expires_at = EXCLUDED.plan_expires_at, offer_id = coalesce(workspace_billing.offer_id, EXCLUDED.offer_id),
			paid_seats = EXCLUDED.paid_seats, trial_start = EXCLUDED.trial_start, pending_plan = EXCLUDED.pending_plan,
			pending_interval = EXCLUDED.pending_interval, pending_at = EXCLUDED.pending_at`,
		workspaceID, customerID, s.ID, s.Status, s.Plan, s.Interval, s.CurrentPeriodEnd, s.TrialEnd, s.CancelAtPeriodEnd, now, discount,
		s.PerSeat, s.Seats, s.PlanExpiresAt, s.PaidSeats, s.TrialStart, s.PendingPlan, s.PendingInterval, s.PendingAt)
	return err
}

// MarkSeatsChanged notes when the workspace's membership changed, the date its seat change is prorated from.
func (q Q) MarkSeatsChanged(ctx context.Context, workspaceID string, at time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_billing SET seats_changed_at = $2 WHERE workspace_id = $1`, workspaceID, at)
	return err
}

// PlansLapsed are the workspaces whose subscription is recorded live but whose plan expired, for the job that reads
// them again from Stripe (a renewal whose event was lost moves the end on; a failed one stays locked).
func (q Q) PlansLapsed(ctx context.Context, now time.Time) ([]string, error) {
	return q.workspaceIDs(ctx, `SELECT b.workspace_id FROM workspace_billing b JOIN workspaces w ON w.id = b.workspace_id
		WHERE w.deleted_at IS NULL AND b.status IN ('active', 'trialing', 'past_due') AND b.plan_expires_at <= $1`, now)
}

// RecordStripeEvent reports false when the event was recorded before (Stripe delivers at least once).
func (q Q) RecordStripeEvent(ctx context.Context, id, typ string, now time.Time) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO stripe_events (id, type, received_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		id, typ, now)
	return tag.RowsAffected() == 1, err
}

// WorkspaceUsage counts what the plan limits cover at now. Monthly counts are the usage recorded in the quota months
// from through now's (UsagePeriod, UTC): now's month, or every month of a trial since it began; state counts are what
// exists. Members are the people besides the workspace's owner: every workspace keeps one, and the plan sells the
// seats for the rest. Only accepted invitations count: a seat is taken when the invitation is accepted
// (JoinInvitedMember), not when it is sent. Engagements count while not cancelled and not ended before today, the
// workspace's civil date of now. Invoice drafts and quotes count while they exist.
func (q Q) WorkspaceUsage(ctx context.Context, ws Workspace, from string, now time.Time) (Usage, error) {
	var u Usage
	err := q.db.QueryRow(ctx, `WITH monthly AS (SELECT resource, sum(consumed + reserved) AS n FROM usage_events
			WHERE workspace_id = $1 AND period BETWEEN $2 AND $4 GROUP BY resource)
		SELECT
			greatest((SELECT count(*) FROM workspace_members WHERE workspace_id = $1) - 1, 0),
			(SELECT count(*) FROM clients WHERE workspace_id = $1 AND deleted_at IS NULL),
			coalesce((SELECT n FROM monthly WHERE resource = 'invoices_per_month'), 0),
			coalesce((SELECT n FROM monthly WHERE resource = 'expenses_per_month'), 0),
			(SELECT count(*) FROM products WHERE workspace_id = $1 AND deleted_at IS NULL),
			(SELECT count(*) FROM engagements WHERE workspace_id = $1 AND deleted_at IS NULL
				AND (cancelled_on IS NULL OR cancelled_on >= $3::date) AND (end_date IS NULL OR end_date >= $3::date)),
			coalesce((SELECT n FROM monthly WHERE resource = 'signatures_per_month'), 0),
			(SELECT coalesce(sum(size), 0) FROM documents WHERE workspace_id = $1)
			+ (SELECT coalesce(sum(size), 0) FROM expense_receipts WHERE workspace_id = $1),
			(SELECT coalesce(sum(tokens_used), 0) FROM heidi_usage WHERE workspace_id = $1 AND period BETWEEN $2 AND $4),
			(SELECT count(*) FROM invoices WHERE workspace_id = $1 AND status = 'draft'),
			(SELECT count(*) FROM quotes WHERE workspace_id = $1),
			coalesce((SELECT n FROM monthly WHERE resource = 'automation_actions_per_month'), 0)`,
		ws.ID, from, ws.Today(now), UsagePeriod(now)).Scan(&u.Members, &u.Clients, &u.InvoicesThisMonth, &u.ExpensesThisMonth,
		&u.Products, &u.Engagements, &u.SignaturesThisMonth, &u.StorageBytes, &u.AITokensThisMonth, &u.InvoiceDrafts, &u.QuotesRetained, &u.AutomationsThisMonth)
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
	return q.workspaceIDs(ctx, `SELECT b.workspace_id FROM workspace_billing b JOIN workspaces w ON w.id = b.workspace_id
		WHERE w.deleted_at IS NULL AND b.per_seat AND b.status IN ('active', 'trialing', 'past_due')
			AND b.seats IS DISTINCT FROM (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = b.workspace_id)`)
}

func (q Q) workspaceIDs(ctx context.Context, sql string, args ...any) ([]string, error) {
	rows, err := q.db.Query(ctx, sql, args...)
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

// RevokeAITokenPack takes back up to want of a refunded or charged-back pack's tokens in total: what more than taken
// before, at most max more when it counts for period, none more when it has lapsed; never less than before. A pack not
// recorded yet is recorded with want taken back, so its late credit adds only the rest. revoked is the pack's total
// taken back; ok is false when nothing changed (or the pack is another workspace's).
func (q Q) RevokeAITokenPack(ctx context.Context, sessionID, workspaceID, period string, tokens, want, max int64, now time.Time) (revoked int64, ok bool, err error) {
	err = q.db.QueryRow(ctx, `INSERT INTO ai_token_packs (checkout_session_id, workspace_id, period, tokens, revoked, revoked_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $7, $7)
		ON CONFLICT (checkout_session_id) DO UPDATE SET revoked_at = $7,
			revoked = least(EXCLUDED.revoked, ai_token_packs.revoked + greatest($6::bigint, 0))
		WHERE ai_token_packs.workspace_id = EXCLUDED.workspace_id AND ai_token_packs.period = EXCLUDED.period
			AND least(EXCLUDED.revoked, ai_token_packs.revoked + greatest($6::bigint, 0)) > ai_token_packs.revoked
		RETURNING revoked`, sessionID, workspaceID, period, tokens, min(want, tokens), max, now).Scan(&revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	return revoked, err == nil, err
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

// SetAllowances records the costly monthly allowances granted pro rata in the UTC month period (2006-01).
func (q Q) SetAllowances(ctx context.Context, workspaceID, period string, allowances map[string]int64) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_billing SET allowance_period = $2, allowances = $3 WHERE workspace_id = $1`,
		workspaceID, period, allowances)
	return err
}

// BillingCheckout is what a plan Checkout was opened for, recorded before Stripe is asked (billing_checkouts).
type BillingCheckout struct {
	ID, WorkspaceID, OfferID, Plan, Interval, Currency, PriceID, CreatedBy string
	Seats                                                                  int64
	Trial                                                                  bool
	SettledSubscription                                                    string // "" until the webhook settled it
}

func (q Q) InsertBillingCheckout(ctx context.Context, c BillingCheckout, now time.Time) error {
	_, err := q.db.Exec(ctx, `INSERT INTO billing_checkouts (id, workspace_id, offer_id, plan, billing_interval, currency,
			price_id, seats, trial, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		c.ID, c.WorkspaceID, c.OfferID, c.Plan, c.Interval, c.Currency, c.PriceID, c.Seats, c.Trial, c.CreatedBy, now)
	return err
}

// BillingCheckout is the checkout by id; ErrNotFound when there is none.
func (q Q) BillingCheckout(ctx context.Context, id string) (BillingCheckout, error) {
	var c BillingCheckout
	err := q.db.QueryRow(ctx, `SELECT id, workspace_id, offer_id, plan, billing_interval, currency, price_id, created_by,
			seats, trial, coalesce(settled_subscription, '') FROM billing_checkouts WHERE id = $1`, id).
		Scan(&c.ID, &c.WorkspaceID, &c.OfferID, &c.Plan, &c.Interval, &c.Currency, &c.PriceID, &c.CreatedBy, &c.Seats, &c.Trial,
			&c.SettledSubscription)
	return c, err
}

// SettleBillingCheckout marks the checkout as the subscription's and puts its workspace on the checkout's offer, once:
// a checkout settled before changes nothing (an operator may have moved the workspace since).
func (q Q) SettleBillingCheckout(ctx context.Context, id, subscriptionID string, now time.Time) error {
	_, err := q.db.Exec(ctx, `WITH c AS (
			UPDATE billing_checkouts SET settled_subscription = $2, settled_at = $3
			WHERE id = $1 AND settled_subscription IS NULL RETURNING workspace_id, offer_id)
		UPDATE workspace_billing b SET offer_id = c.offer_id FROM c WHERE b.workspace_id = c.workspace_id`, id, subscriptionID, now)
	return err
}

// ClaimTrial records the digests of who started a trial in the workspace and reports whether any of them started one
// in another workspace before. A digest claimed by this workspace already is no reuse.
func (q Q) ClaimTrial(ctx context.Context, workspaceID string, claims map[string]string, now time.Time) (bool, error) {
	reused := false
	for kind, digest := range claims {
		var owner string
		err := q.db.QueryRow(ctx, `INSERT INTO trial_claims (kind, digest, workspace_id, claimed_at) VALUES ($1, $2, $3, $4)
			ON CONFLICT (kind, digest) DO UPDATE SET kind = EXCLUDED.kind RETURNING workspace_id`,
			kind, digest, workspaceID, now).Scan(&owner)
		if err != nil {
			return false, err
		}
		reused = reused || owner != workspaceID
	}
	return reused, nil
}

// TrialClaimed reports whether any of the digests started a trial already.
func (q Q) TrialClaimed(ctx context.Context, claims map[string]string) (bool, error) {
	var found bool
	for kind, digest := range claims {
		if err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM trial_claims WHERE kind = $1 AND digest = $2)`,
			kind, digest).Scan(&found); err != nil || found {
			return found, err
		}
	}
	return false, nil
}

// AIUsage is the model tokens and cost in micro-USD the workspace used or holds reserved in the heidi_usage months from
// through to (2006-01, both included).
func (q Q) AIUsage(ctx context.Context, workspaceID, from, to string) (tokens, micros int64, err error) {
	err = q.db.QueryRow(ctx, `SELECT coalesce(sum(tokens_used + tokens_reserved), 0)::bigint,
			coalesce(sum(cost_micros + cost_reserved_micros), 0)::bigint
		FROM heidi_usage WHERE workspace_id = $1 AND period >= $2 AND period <= $3`, workspaceID, from, to).Scan(&tokens, &micros)
	return tokens, micros, err
}

// TrialAICostSince is the model cost in micro-USD, settled or still reserved, of every workspace in its trial since.
func (q Q) TrialAICostSince(ctx context.Context, since time.Time) (int64, error) {
	var n int64
	err := q.db.QueryRow(ctx, `SELECT coalesce(sum(coalesce(c.cost_micros, c.reserved_micros)), 0)::bigint
		FROM ai_calls c JOIN workspace_billing b ON b.workspace_id = c.workspace_id
		WHERE b.status = 'trialing' AND c.created_at >= $1`, since).Scan(&n)
	return n, err
}

// SetPendingPlan records a plan change scheduled for at (the paid period's end).
func (q Q) SetPendingPlan(ctx context.Context, workspaceID, plan, interval string, at *time.Time) error {
	_, err := q.db.Exec(ctx, `UPDATE workspace_billing SET pending_plan = $2, pending_interval = $3, pending_at = $4
		WHERE workspace_id = $1`, workspaceID, plan, interval, at)
	return err
}
