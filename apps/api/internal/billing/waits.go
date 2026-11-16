package billing

import (
	"context"

	"helvetly.com/api/internal/store"
)

// A job's automatic action refused for a used-up monthly limit waits instead of being prepared and refused again on
// every tick: the refusal is remembered with the amount it asked for (noteRefused), and AutomationWaits holds back the
// actions needing that limit while that amount still does not fit, the admission's own test. A new month, the trial's
// end, a plan, seat or override change, or a reservation given back ends the wait; the action, still due, runs on the
// next tick.
// shortcut: kept in this process's memory, so a restart or another instance tries once more before it waits too.

// noteRefused remembers that need of a limit automatic actions count against did not fit the workspace's cap.
func (s *Service) noteRefused(workspaceID string, l Limit, need int64) {
	if l == AutomationActions || l == Emails || l == EmailAttachments {
		s.refused.Store(workspaceID+" "+string(l), need)
	}
}

// AutomationWaits is the store.AutomationWait: whether an amount refused of one of limits still does not fit the
// workspace's cap and usage now. A refusal that would fit now is forgotten.
func (s *Service) AutomationWaits(ctx context.Context, workspaceID string, limits ...string) (bool, error) {
	var b *store.Billing
	var r Rights
	now := s.now()
	for _, l := range limits {
		key := workspaceID + " " + l
		need, ok := s.refused.Load(key)
		if !ok {
			continue
		}
		if b == nil {
			got, err := s.db.WorkspaceBilling(ctx, workspaceID)
			if err != nil {
				return false, err
			}
			if r, err = s.entitlementsOf(ctx, s.db.Q, workspaceID, got); err != nil {
				return false, err
			}
			b = &got
		}
		if max, err := r.Cap(Limit(l)); err == nil { // no plan: the action's own checks answer
			u, err := s.db.UsageInPeriods(ctx, workspaceID, l, store.UsagePeriod(quotaStart(*b, now)), store.UsagePeriod(now))
			if err != nil {
				return false, err
			}
			if n, _ := need.(int64); !fits(u.Total(), n, max) {
				return true, nil
			}
		}
		s.refused.CompareAndDelete(key, need)
	}
	return false, nil
}
