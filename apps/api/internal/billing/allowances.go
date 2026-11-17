package billing

import (
	"context"
	"time"

	"helvetly.com/api/internal/store"
)

// costly are the monthly allowances that cost Helvetly money to provide (the model, email, automations). An
// increase of them within the UTC quota month (a new subscription, a bigger plan, more paid seats) is granted pro rata
// to the seconds left in the month; the next month starts with the full allowance. Annual billing grants a month at a
// time like monthly billing. Usage and reservations stay: what is left is the new allowance less what was used.
var costly = []Limit{AITokens, AICost, Emails, AutomationActions}

// utcMonth is the UTC calendar month around t: its start and the next month's.
func utcMonth(t time.Time) (time.Time, time.Time) {
	t = t.UTC()
	start := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
	return start, start.AddDate(0, 1, 0)
}

// share is n × left / total without overflowing, rounded down.
func share(n, left, total int64) int64 {
	if left >= total {
		return n
	}
	return n/total*left + n%total*left/total
}

// granted are the costly allowances after a change at now from before (the plan and seats until now, in full; earlier
// is what this month's earlier increases granted, nil when none) to after (the new plan and seats in full).
// An allowance whose full value grows gets what it had plus its growth for the rest of the month; one that does not
// keeps what it had (a decrease applies whole). nil when none grows. Without a paid plan before (none, or the trial),
// the whole allowance is new: a converted trial gets no full month on top of what it used.
func granted(before Rights, earlier map[string]int64, after Rights, now time.Time) map[string]int64 {
	start, end := utcMonth(now)
	left, total := int64(end.Sub(now)/time.Second), int64(end.Sub(start)/time.Second)
	out := map[string]int64{}
	grew := false
	for _, l := range costly {
		a, ok := after.Items[string(l)]
		if !ok || a.State != StateLimited {
			continue
		}
		var full int64 // before's whole allowance
		if b := before.Items[string(l)]; before.Plan != "" && !before.Trial {
			switch b.State {
			case StateLimited:
				full = b.Value
			case StateUnlimited:
				full = a.Value
			}
		}
		had := full
		if v, ok := earlier[string(l)]; ok && v < had {
			had = v
		}
		out[string(l)] = min(a.Value, had)
		if a.Value > full {
			out[string(l)], grew = had+share(a.Value-full, left, total), true
		}
	}
	if !grew {
		return nil
	}
	return out
}

// prorate caps the plan's costly allowances at what was granted this month (granted); an operator's value or the
// trial's replaces them whole.
func (r *Rights) prorate(b store.Billing, now time.Time) {
	if b.AllowancePeriod != now.UTC().Format("2006-01") {
		return
	}
	for key, v := range b.Allowances {
		if e, ok := r.Items[key]; ok && e.Source == SourcePlan && e.State == StateLimited && v < e.Value {
			e.Value = v
			r.Items[key] = e
		}
	}
}

// grant records the costly allowances granted after the workspace's billing changed from before (the billing as it
// was, and the rights it gave in full, baseRights).
func (s *Service) grant(ctx context.Context, q store.Q, workspaceID string, before store.Billing, prev Rights) error {
	b, err := q.WorkspaceBilling(ctx, workspaceID)
	if err != nil {
		return err
	}
	now := s.now()
	if PlanOf(b, now) == "" || b.Status == "trialing" {
		return nil
	}
	full, err := s.baseRights(ctx, q, workspaceID, b)
	if err != nil {
		return err
	}
	var earlier map[string]int64
	if before.AllowancePeriod == now.UTC().Format("2006-01") {
		earlier = before.Allowances
	}
	g := granted(prev, earlier, full, now)
	if g == nil {
		return nil
	}
	return q.SetAllowances(ctx, workspaceID, now.UTC().Format("2006-01"), g)
}
