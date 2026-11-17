package store

import (
	"context"
	"time"
)

// AutomationActions is the monthly allowance of automatic actions: one durable business effect for one target (an
// issued instalment, an automatic draft, a scheduled notice) or one automatic message to one recipient. An action's
// id names the logical action, kind:occurrence:target[:recipient], never an attempt, so a retry, a second tick or a
// new month counts it once. Emails, issues, AI and storage the action uses count in their own allowances too.
const AutomationActions = "automation_actions_per_month"

// EmailRecipients is the business email limit an automatic message counts against besides AutomationActions.
const EmailRecipients = "emails_per_month"

// AutomationWait reports whether an automatic action needing these monthly limits should wait (billing).
type AutomationWait func(ctx context.Context, workspaceID string, limits ...string) (bool, error)

// SetAutomationWait is startup wiring, like SetAdmission: call once before jobs start.
func (s *Store) SetAutomationWait(w AutomationWait) { s.Q.waits = w }

// AutomationWaits reports whether a job should leave an automatic action needing limits for later, before preparing
// it: what was last refused of one of them still does not fit the workspace's cap and usage, so trying again would
// only be refused again. The action stays due and runs once a new month, a bigger cap or a reservation given back
// makes room. Without a gate (billing off, package tests) none waits.
func (q Q) AutomationWaits(ctx context.Context, workspaceID string, limits ...string) (bool, error) {
	if q.waits == nil {
		return false, nil
	}
	return q.waits(ctx, workspaceID, limits...)
}

func automationOp(id string) UsageOp { return UsageOp{Resource: AutomationActions, ID: id, Amount: 1} }

// CountAutomation counts a database-only automatic effect in q's transaction, so it commits or rolls back with the
// effect. ErrAdmissionDenied when the plan has no automations or none are left this month: the action waits.
func (q Q) CountAutomation(ctx context.Context, workspaceID, id string, now time.Time) error {
	_, err := q.ConsumeUsage(ctx, workspaceID, automationOp(id), now)
	return err
}

// ReserveAutomation holds one action for an automatic message before it is prepared and sent: on the pool it commits
// in a transaction of its own; inside a transaction that already holds locks, call it on that transaction's Q, since
// a second connection would deadlock concurrent runs on the pool. The same id again reserves nothing more.
// ErrAdmissionDenied as for CountAutomation.
func (q Q) ReserveAutomation(ctx context.Context, workspaceID, id string, now time.Time) error {
	_, err := q.ReserveUsage(ctx, workspaceID, automationOp(id), now)
	return err
}

// SettleAutomation records a reserved message as sent. Call it in the transaction that logs the message, before
// handing it to the mail server: the count commits with the log and rolls back with a failed send, which leaves the
// reservation held (its outcome is not known). ErrNotFound when a concurrent run released it: send nothing.
func (q Q) SettleAutomation(ctx context.Context, workspaceID, id string, now time.Time) error {
	return q.SettleUsage(ctx, workspaceID, AutomationActions, id, 1, now)
}

// ReleaseAutomation gives back the reservation of a message that will not go now (no longer due, the invoice paid,
// sent by a concurrent run), so the id can be reserved again when it is due. A settled action stays counted; a
// settlement in flight is waited for.
func (q Q) ReleaseAutomation(ctx context.Context, workspaceID, id string) error {
	_, err := q.db.Exec(ctx, `DELETE FROM usage_events WHERE workspace_id = $1 AND resource = $2 AND operation = $3 AND settled_at IS NULL`,
		workspaceID, AutomationActions, id)
	return err
}
