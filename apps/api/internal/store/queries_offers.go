package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Offers (internal/billing/offer.go): the features and limits this binary knows (limits), the published offer
// versions with every plan's values (offer_versions, limit_plans), operators' values for one workspace
// (limit_workspaces) and the audit of every change to them (offer_audit).

// LimitDef is the definition of a feature or limit: what a published offer must give a value for.
type LimitDef struct {
	Key, Kind, Unit, Scope string
	Period                 string // "" without a period
	RequiresFeatures       []string
	AllowUnlimited         bool
}

// LimitDefs are every definition, in the offer's order.
func (q Q) LimitDefs(ctx context.Context) ([]LimitDef, error) {
	rows, err := q.db.Query(ctx, `SELECT key, kind, unit, scope, coalesce(period, ''), requires_features, allow_unlimited
		FROM limits ORDER BY position, key`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (LimitDef, error) {
		var d LimitDef
		err := r.Scan(&d.Key, &d.Kind, &d.Unit, &d.Scope, &d.Period, &d.RequiresFeatures, &d.AllowUnlimited)
		return d, err
	})
}

// OfferVersion is a published offer: Document is its file as the binary read it, unchanged since publication.
type OfferVersion struct {
	ID            string
	SchemaVersion int
	Checksum      string
	Document      json.RawMessage
	PublishedAt   time.Time
}

// PlanValue is one plan's value of a feature or limit in an offer: State enabled or disabled (a feature), limited to
// Value or unlimited (a limit), growing by PerSeat for every paid seat after the first.
type PlanValue struct {
	Plan, Key, State string
	Value            *int64
	PerSeat          int64
}

// LockOffers serialises publishing until the transaction ends.
func (q Q) LockOffers(ctx context.Context) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('offers', 0))`)
	return err
}

const offerColumns = `id, schema_version, checksum, document, published_at`

func scanOffer(row pgx.Row) (OfferVersion, error) {
	var v OfferVersion
	err := row.Scan(&v.ID, &v.SchemaVersion, &v.Checksum, &v.Document, &v.PublishedAt)
	return v, err
}

// CurrentOffer is the offer on sale: the one published last. ErrNotFound when none is.
func (q Q) CurrentOffer(ctx context.Context) (OfferVersion, error) {
	return scanOffer(q.db.QueryRow(ctx, `SELECT `+offerColumns+` FROM offer_versions ORDER BY published_at DESC, id DESC LIMIT 1`))
}

// Offer is a published offer by id; ErrNotFound when there is none.
func (q Q) Offer(ctx context.Context, id string) (OfferVersion, error) {
	return scanOffer(q.db.QueryRow(ctx, `SELECT `+offerColumns+` FROM offer_versions WHERE id = $1`, id))
}

// InsertOffer publishes an offer with its plan values. Both are immutable from the transaction's end (triggers).
func (q Q) InsertOffer(ctx context.Context, v OfferVersion, values []PlanValue) error {
	if _, err := q.db.Exec(ctx, `INSERT INTO offer_versions (id, schema_version, checksum, document, published_at)
		VALUES ($1, $2, $3, $4, now())`, v.ID, v.SchemaVersion, v.Checksum, v.Document); err != nil {
		return err
	}
	var plans, keys, states []string
	var vals []*int64
	var perSeat []int64
	for _, p := range values {
		plans, keys, states = append(plans, p.Plan), append(keys, p.Key), append(states, p.State)
		vals, perSeat = append(vals, p.Value), append(perSeat, p.PerSeat)
	}
	_, err := q.db.Exec(ctx, `INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
		SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::bigint[], $6::bigint[])`,
		v.ID, plans, keys, states, vals, perSeat)
	return err
}

// OfferPlanValues is every plan's value of every key in an offer.
func (q Q) OfferPlanValues(ctx context.Context, offerID string) ([]PlanValue, error) {
	rows, err := q.db.Query(ctx, `SELECT lp.plan_id, lp.limit_key, lp.state, lp.value, lp.per_additional_paid_seat
		FROM limit_plans lp JOIN limits l ON l.key = lp.limit_key WHERE lp.offer_id = $1 ORDER BY l.position, lp.plan_id`, offerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PlanValue, error) {
		var p PlanValue
		err := r.Scan(&p.Plan, &p.Key, &p.State, &p.Value, &p.PerSeat)
		return p, err
	})
}

// WorkspacesOnOffer counts the workspaces assigned to an offer.
func (q Q) WorkspacesOnOffer(ctx context.Context, offerID string) (int64, error) {
	var n int64
	err := q.db.QueryRow(ctx, `SELECT count(*) FROM workspace_billing WHERE offer_id = $1`, offerID).Scan(&n)
	return n, err
}

// ResolvedLimit is one key of a workspace's offer: the definition, the plan's value (nil State when the offer has
// none) and the workspace's own value when an operator set one that has not expired.
type ResolvedLimit struct {
	LimitDef
	Plan      *PlanValue
	Workspace *WorkspaceLimit
}

// WorkspaceLimit is an operator's value of a key for one workspace on one offer; it replaces the plan's whole value
// (not grown by seats) until ExpiresAt, when set.
type WorkspaceLimit struct {
	WorkspaceID, OfferID, Key, State string
	Value                            *int64
	ExpiresAt                        *time.Time
	Reason, SetBy                    string
	UpdatedAt                        time.Time
}

// ResolveLimits is every defined key of a workspace on plan of offerID at now, in one query: the plan's value and
// the workspace's own unexpired one.
func (q Q) ResolveLimits(ctx context.Context, workspaceID, offerID, plan string, now time.Time) ([]ResolvedLimit, error) {
	rows, err := q.db.Query(ctx, `SELECT l.key, l.kind, l.unit, l.scope, coalesce(l.period, ''), l.requires_features, l.allow_unlimited,
			lp.state, lp.value, coalesce(lp.per_additional_paid_seat, 0),
			lw.state, lw.value, lw.expires_at, coalesce(lw.reason, ''), coalesce(lw.set_by, ''), lw.updated_at
		FROM limits l
		LEFT JOIN limit_plans lp ON lp.limit_key = l.key AND lp.offer_id = $2 AND lp.plan_id = $3
		LEFT JOIN limit_workspaces lw ON lw.limit_key = l.key AND lw.workspace_id = $1 AND lw.offer_id = $2
			AND (lw.expires_at IS NULL OR lw.expires_at > $4)
		ORDER BY l.position, l.key`, workspaceID, offerID, plan, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ResolvedLimit, error) {
		var l ResolvedLimit
		var planState, wsState *string
		var planValue, wsValue *int64
		var perSeat int64
		var expires, updated *time.Time
		var reason, setBy string
		if err := r.Scan(&l.Key, &l.Kind, &l.Unit, &l.Scope, &l.Period, &l.RequiresFeatures, &l.AllowUnlimited,
			&planState, &planValue, &perSeat, &wsState, &wsValue, &expires, &reason, &setBy, &updated); err != nil {
			return l, err
		}
		if planState != nil {
			l.Plan = &PlanValue{Plan: plan, Key: l.Key, State: *planState, Value: planValue, PerSeat: perSeat}
		}
		if expires != nil {
			utc := expires.UTC()
			expires = &utc
		}
		if wsState != nil {
			l.Workspace = &WorkspaceLimit{WorkspaceID: workspaceID, OfferID: offerID, Key: l.Key, State: *wsState,
				Value: wsValue, ExpiresAt: expires, Reason: reason, SetBy: setBy, UpdatedAt: *updated}
		}
		return l, nil
	})
}

// LockWorkspaceLimit reads a workspace's own value of a key on an offer for update, expired or not; nil when none.
func (q Q) LockWorkspaceLimit(ctx context.Context, workspaceID, offerID, key string) (*WorkspaceLimit, error) {
	w := WorkspaceLimit{WorkspaceID: workspaceID, OfferID: offerID, Key: key}
	err := q.db.QueryRow(ctx, `SELECT state, value, expires_at, reason, set_by, updated_at FROM limit_workspaces
		WHERE workspace_id = $1 AND offer_id = $2 AND limit_key = $3 FOR UPDATE`, workspaceID, offerID, key).
		Scan(&w.State, &w.Value, &w.ExpiresAt, &w.Reason, &w.SetBy, &w.UpdatedAt)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	return &w, err
}

// SetWorkspaceLimit gives a workspace its own value of a key on an offer.
func (q Q) SetWorkspaceLimit(ctx context.Context, w WorkspaceLimit) error {
	_, err := q.db.Exec(ctx, `INSERT INTO limit_workspaces (workspace_id, offer_id, limit_key, state, value, expires_at, reason, set_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (workspace_id, offer_id, limit_key) DO UPDATE SET state = EXCLUDED.state, value = EXCLUDED.value,
			expires_at = EXCLUDED.expires_at, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by, updated_at = now()`,
		w.WorkspaceID, w.OfferID, w.Key, w.State, w.Value, w.ExpiresAt, w.Reason, w.SetBy)
	return err
}

// ClearWorkspaceLimit drops a workspace's own value of a key on an offer, so its plan's applies again.
func (q Q) ClearWorkspaceLimit(ctx context.Context, workspaceID, offerID, key string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM limit_workspaces WHERE workspace_id = $1 AND offer_id = $2 AND limit_key = $3`,
		workspaceID, offerID, key)
	return err
}

// WorkspaceOffer is the offer a workspace is on; "" when none is assigned (it never had a subscription).
func (q Q) WorkspaceOffer(ctx context.Context, workspaceID string) (string, error) {
	var id *string
	err := q.db.QueryRow(ctx, `SELECT offer_id FROM workspace_billing WHERE workspace_id = $1`, workspaceID).Scan(&id)
	if errors.Is(err, ErrNotFound) || id == nil {
		return "", nil
	}
	return *id, err
}

// AuditOffer records an operator's change to offers or limits, with what it was before and after (JSON; nil is none).
func (q Q) AuditOffer(ctx context.Context, actor, action, target string, before, after any, reason string) error {
	_, err := q.db.Exec(ctx, `INSERT INTO offer_audit (actor, action, target, before, after, reason) VALUES ($1, $2, $3, $4, $5, $6)`,
		actor, action, target, before, after, reason)
	return err
}
