package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// UsagePeriod is the quota month now falls in: the UTC calendar month, whatever the workspace's time zone, plan,
// seats or billing cycle, so changing none of them starts a month again.
func UsagePeriod(now time.Time) string { return now.UTC().Format("2006-01") }

// UsagePeriodStart is the instant now's quota month started (00:00 UTC on its first day).
func UsagePeriodStart(now time.Time) time.Time {
	t := now.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// AdmissionPeriod is the quota month an admission compares usage in: the month the operation being admitted is
// recorded in (ConsumeUsage, ReserveUsage), or now's for any other check.
func (q Q) AdmissionPeriod(now time.Time) string {
	if q.period != "" {
		return q.period
	}
	return UsagePeriod(now)
}

// UsageOp is one operation counted against a monthly limit.
type UsageOp struct {
	Resource string // the limit's key, e.g. invoices_per_month
	// ID names the operation within the workspace and resource and stays the same on every retry, e.g.
	// "invoice.issue:<invoice id>" or a client's Idempotency-Key.
	ID     string
	Params string // what the operation does; the same ID with other Params is ErrUsageConflict, not a retry
	Amount int64  // what it uses, or at most uses when reserved
}

// ErrUsageConflict: an operation id came again with other parameters.
var ErrUsageConflict = errors.New("usage operation id reused with other parameters")

// ConsumeUsage admits op and records it used, in q's transaction: for an operation without an external effect,
// whose write commits or rolls back with its usage. The same op again (a retry) counts nothing and reports replay,
// in whichever month it first counted.
func (q Q) ConsumeUsage(ctx context.Context, workspaceID string, op UsageOp, now time.Time) (replay bool, err error) {
	return q.recordUsage(ctx, workspaceID, op, now, false)
}

// ReserveUsage admits op and holds its Amount for an operation with an external effect (a provider call, an email, a
// transfer): commit the reservation before the effect, hold no transaction during it, then SettleUsage once the
// outcome is known. An outcome that stays unknown is not settled: the reservation keeps counting, so a blind retry
// cannot spend it twice. A replay reports true and reserves nothing more.
func (q Q) ReserveUsage(ctx context.Context, workspaceID string, op UsageOp, now time.Time) (replay bool, err error) {
	return q.recordUsage(ctx, workspaceID, op, now, true)
}

func (q Q) recordUsage(ctx context.Context, workspaceID string, op UsageOp, now time.Time, reserve bool) (bool, error) {
	if op.Resource == "" || op.ID == "" || op.Amount < 0 {
		return false, fmt.Errorf("usage %q of %q: an operation needs a resource, an id and an amount of 0 or more", op.ID, op.Resource)
	}
	sum := sha256.Sum256([]byte(op.Params))
	hash := hex.EncodeToString(sum[:])
	replay := false
	err := q.writeTx(ctx, func(q Q) error {
		// Billing first, then the resource: the order every admission takes (LockAdmission).
		if err := q.LockAdmission(ctx, workspaceID, op.Resource); err != nil {
			return err
		}
		var existing string
		err := q.db.QueryRow(ctx, `SELECT params_hash FROM usage_events WHERE workspace_id = $1 AND resource = $2 AND operation = $3`,
			workspaceID, op.Resource, op.ID).Scan(&existing)
		switch {
		case err == nil && existing == hash:
			replay = true
			return nil
		case err == nil:
			return fmt.Errorf("%w: %s", ErrUsageConflict, op.ID)
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		q.period = UsagePeriod(now)
		if err := q.Admit(ctx, workspaceID, op.Resource, op.Amount); err != nil {
			return err
		}
		reserved, consumed, settled := int64(0), op.Amount, &now
		if reserve {
			reserved, consumed, settled = op.Amount, 0, nil
		}
		_, err = q.db.Exec(ctx, `INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed,
			created_at, settled_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			workspaceID, op.Resource, op.ID, hash, q.period, reserved, consumed, now, settled)
		return err
	})
	return replay, err
}

// SettleUsage records what a reserved operation used once its outcome is known and releases the rest of its
// reservation: used 0 releases all of it (the effect did not happen). It counts in the month it was reserved in.
// More than reserved is recorded as used too: an incurred cost is never hidden. Settling again changes nothing; the
// first outcome stands. ErrNotFound when the operation was never reserved.
func (q Q) SettleUsage(ctx context.Context, workspaceID, resource, id string, used int64, now time.Time) error {
	if used < 0 {
		return fmt.Errorf("usage %q of %q: used cannot be negative", id, resource)
	}
	var settled bool
	err := q.db.QueryRow(ctx, `WITH s AS (UPDATE usage_events SET consumed = $4, reserved = 0, settled_at = $5
			WHERE workspace_id = $1 AND resource = $2 AND operation = $3 AND settled_at IS NULL RETURNING 1)
		SELECT EXISTS (SELECT 1 FROM s) OR EXISTS (SELECT 1 FROM usage_events WHERE workspace_id = $1 AND resource = $2 AND operation = $3)`,
		workspaceID, resource, id, used, now).Scan(&settled)
	if err == nil && !settled {
		return ErrNotFound
	}
	return err
}

// PeriodUsage is a limit's usage in one quota month: what settled operations used and what pending ones hold.
type PeriodUsage struct {
	Consumed, Reserved int64
}

// Total is what counts against the limit: used and still reserved.
func (u PeriodUsage) Total() int64 { return u.Consumed + u.Reserved }

// UsageInPeriods is the workspace's usage of resource in the quota months from through to (UsagePeriod), both
// included: one month, or the months a trial's single allowance spans.
func (q Q) UsageInPeriods(ctx context.Context, workspaceID, resource, from, to string) (PeriodUsage, error) {
	var u PeriodUsage
	err := q.db.QueryRow(ctx, `SELECT coalesce(sum(consumed), 0), coalesce(sum(reserved), 0) FROM usage_events
		WHERE workspace_id = $1 AND resource = $2 AND period BETWEEN $3 AND $4`, workspaceID, resource, from, to).Scan(&u.Consumed, &u.Reserved)
	return u, err
}

// Snapshots is what a workspace's whole exports (own_data_export) have done recently, for the next one's admission:
// an export that sent nothing (it failed first) does not count.
type Snapshots struct {
	Running   bool       // one has not settled yet, started in the last six hours (an older one crashed)
	LastAt    *time.Time // the latest counted export in the last seven days
	ThisMonth int64      // exports counted in now's quota month
	Bytes     int64      // what they sent or hold
}

// ReserveSnapshot admits one whole export of the workspace as the usage operation id of resource, holding amount bytes:
// under the workspace's admission lock, check sees the recent exports and refuses with its error, or the export is
// reserved. SettleUsage records what it sent.
func (q Q) ReserveSnapshot(ctx context.Context, workspaceID, resource, id string, amount int64, now time.Time, check func(Snapshots) error) error {
	return q.writeTx(ctx, func(q Q) error {
		if err := q.LockAdmission(ctx, workspaceID, resource); err != nil {
			return err
		}
		var s Snapshots
		err := q.db.QueryRow(ctx, `SELECT
				coalesce(bool_or(settled_at IS NULL AND created_at > $3::timestamptz - interval '6 hours'), false),
				max(created_at) FILTER (WHERE created_at > $3::timestamptz - interval '7 days' AND (settled_at IS NULL OR consumed > 0)),
				count(*) FILTER (WHERE period = $4 AND (settled_at IS NULL OR consumed > 0)),
				coalesce(sum(consumed + reserved) FILTER (WHERE period = $4), 0)
			FROM usage_events WHERE workspace_id = $1 AND resource = $2`, workspaceID, resource, now, UsagePeriod(now)).
			Scan(&s.Running, &s.LastAt, &s.ThisMonth, &s.Bytes)
		if err != nil {
			return err
		}
		if err := check(s); err != nil {
			return err
		}
		_, err = q.db.Exec(ctx, `INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at)
			VALUES ($1, $2, $3, '', $4, $5, 0, $6)`, workspaceID, resource, id, UsagePeriod(now), amount, now)
		return err
	})
}

// CapExceeded is why ReserveCapped refused: the limit's usage and cap when the operation came.
type CapExceeded struct {
	Resource  string
	Used, Max int64
	Requested int64
}

func (e *CapExceeded) Error() string {
	return fmt.Sprintf("%s: %d used of %d, %d more requested", e.Resource, e.Used, e.Max, e.Requested)
}

// ReserveCapped reserves every op, all or none, each within its cap (-1: none) counting usage from the quota month
// from through now's, under each resource's own admission lock and not the workspace's billing lock: for an effect
// started inside another transaction that may hold the billing lock already (an email sent while a quote is saved),
// where a second connection taking it again would wait on itself. The caller reads the caps (billing). A refusal is
// ErrAdmissionDenied wrapping *CapExceeded. ops come in their resources' lexicographic order.
func (q Q) ReserveCapped(ctx context.Context, workspaceID string, ops []UsageOp, caps []int64, from string, now time.Time) error {
	return q.writeTx(ctx, func(q Q) error {
		for i, op := range ops {
			if op.Resource == "" || op.ID == "" || op.Amount < 0 {
				return fmt.Errorf("usage %q of %q: an operation needs a resource, an id and an amount of 0 or more", op.ID, op.Resource)
			}
			if _, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,7))`, "resource-admission:"+workspaceID+":"+op.Resource); err != nil {
				return err
			}
			u, err := q.UsageInPeriods(ctx, workspaceID, op.Resource, from, UsagePeriod(now))
			if err != nil {
				return err
			}
			if caps[i] >= 0 && (u.Total() > caps[i] || op.Amount > caps[i]-u.Total()) {
				return fmt.Errorf("%w: %w", ErrAdmissionDenied, &CapExceeded{Resource: op.Resource, Used: u.Total(), Max: caps[i], Requested: op.Amount})
			}
			sum := sha256.Sum256([]byte(op.Params))
			if _, err := q.db.Exec(ctx, `INSERT INTO usage_events (workspace_id, resource, operation, params_hash, period, reserved, consumed, created_at)
				VALUES ($1, $2, $3, $4, $5, $6, 0, $7)`, workspaceID, op.Resource, op.ID, hex.EncodeToString(sum[:]), UsagePeriod(now), op.Amount, now); err != nil {
				return err
			}
		}
		return nil
	})
}
