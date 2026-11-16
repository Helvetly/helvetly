package engagements

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// Run ticks hourly until ctx ends (like documents.Service.Run).
func (s *Service) Run(ctx context.Context) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if err := s.Tick(ctx, time.Now()); err != nil {
			s.log.ErrorContext(ctx, "engagements job", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// draftJob is one invoice an auto-invoicing engagement is due.
type draftJob struct{ periodID, kind string }

// Tick is one idempotent run of the background job at now: auto drafts, notices, then the digest.
// A failure on one engagement is logged and retried next run; only a failed lookup is returned.
func (s *Service) Tick(ctx context.Context, now time.Time) error {
	t := *s // the views and InvoicePeriod read today from t.now
	t.now = func() time.Time { return now }
	targets, err := t.db.AutoInvoiceTargets(ctx)
	if err != nil {
		return fmt.Errorf("list auto-invoice engagements: %w", err)
	}
	for _, target := range targets {
		if err := guard(func() error { return t.autoDrafts(ctx, target) }); err != nil {
			t.log.ErrorContext(ctx, "engagement auto drafts", "engagement", target.EngagementID, "error", err)
		}
	}
	workspaces, err := t.db.LiveWorkspaces(ctx)
	if err != nil {
		return fmt.Errorf("list workspaces: %w", err)
	}
	for _, ws := range workspaces {
		if err := guard(func() error { return t.notices(ctx, ws) }); err != nil {
			t.log.ErrorContext(ctx, "engagement notices", "workspace", ws.ID, "error", err)
		}
	}
	_ = guard(func() error { t.sendDigests(ctx, now); return nil })
	return nil
}

// guard turns a panic in one unit of work into an error, so one bad engagement cannot stop the job or the process.
func guard(f func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return f()
}

func jobSession(ws store.Workspace) store.Session { return store.Session{Workspace: ws} }

// autoDrafts makes the drafts an engagement is due, each in its own transaction so one failure rolls back alone.
func (s *Service) autoDrafts(ctx context.Context, target store.AutoInvoiceTarget) error {
	ws := store.Workspace{ID: target.WorkspaceID, Timezone: target.Timezone}
	// Automatic drafts wait while the workspace's plan lacks engagement automations.
	if on, err := s.db.FeatureAllowed(ctx, ws.ID, store.FeatureEngagementAutomation); err != nil || !on {
		return err
	}
	var todo []draftJob
	err := s.db.Tx(ctx, func(q store.Q) error {
		cur, err := q.Engagement(ctx, target.WorkspaceID, target.EngagementID, true)
		if err != nil {
			return err
		}
		v, err := s.view(ctx, q, cur, s.today(ws))
		if err != nil {
			return err
		}
		// Older periods are left to the user, so turning auto_invoice on never creates a pile of drafts.
		lastClosed := ""
		for _, p := range v.periods {
			if p.State == "closed" && p.StartsOn > lastClosed {
				lastClosed = p.StartsOn
			}
		}
		for _, p := range v.periods {
			if cur.Billing == "advance" && p.State == "open" && p.AdvanceInvoice == nil {
				todo = append(todo, draftJob{p.ID, "advance"})
			}
			if p.State == "closed" && p.StartsOn == lastClosed && p.UninvoicedQuantity > 0 {
				todo = append(todo, draftJob{p.ID, "usage"})
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	var errs []error
	for _, j := range todo {
		if err := s.autoDraft(ctx, target, j); err != nil {
			s.log.ErrorContext(ctx, "engagement auto draft", "engagement", target.EngagementID, "period", j.periodID, "kind", j.kind, "error", err)
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (s *Service) autoDraft(ctx context.Context, target store.AutoInvoiceTarget, j draftJob) error {
	err := s.db.Tx(ctx, func(q store.Q) error {
		cur, err := q.Engagement(ctx, target.WorkspaceID, target.EngagementID, true) // the endpoint's row lock
		if err != nil {
			return err
		}
		if err := q.RequireFeature(ctx, target.WorkspaceID, store.FeatureEngagementAutomation); err != nil {
			return err // a plan change since the check above wins
		}
		if err := q.CountAutomation(ctx, target.WorkspaceID, "engagements.draft:"+cur.ID+":"+j.periodID+":"+j.kind, s.now()); err != nil {
			return err
		}
		id, err := s.InvoicePeriod(ctx, q, jobSession(store.Workspace{ID: target.WorkspaceID, Timezone: target.Timezone}), cur, j.periodID, j.kind, "")
		if err != nil {
			return err
		}
		added, err := q.AddNotice(ctx, store.EngagementNotice{ID: auth.NewID("ntc"), EngagementID: target.EngagementID, PeriodID: j.periodID,
			Kind: "draft_created", InvoiceID: &id, CreatedAt: s.now()})
		if err != nil || !added {
			return err
		}
		period := ""
		if v, err := s.view(ctx, q, cur, s.today(store.Workspace{Timezone: target.Timezone})); err != nil {
			return err
		} else if i := slices.IndexFunc(v.periods, func(p PeriodSummary) bool { return p.ID == j.periodID }); i >= 0 {
			period = periodLabel(v.periods[i])
		}
		return notifications.Notify(ctx, q, target.WorkspaceID, "engagement.draft_created", map[string]any{"invoice_id": id,
			"engagement_id": cur.ID, "engagement": cur.Title, "client": cur.Client.Name, "period": period},
			store.NotifyTo{Roles: notifications.Managers}, s.now())
	})
	if errors.Is(err, errAlreadyInvoiced) || errors.Is(err, errNothingToInvoice) || errors.Is(err, store.ErrFeatureDenied) ||
		errors.Is(err, store.ErrAdmissionDenied) {
		return nil // somebody got there first, or the plan changed or has no room: the draft waits
	}
	return err
}

// notices raises each reminder once per period (the table's unique key makes repeats no-ops).
func (s *Service) notices(ctx context.Context, ws store.Workspace) error {
	if on, err := s.db.FeatureAllowed(ctx, ws.ID, store.FeatureEngagementAutomation); err != nil || !on {
		return err
	}
	ids, err := s.db.LiveEngagementIDs(ctx, ws.ID)
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range ids {
		errs = append(errs, s.db.Tx(ctx, func(q store.Q) error {
			e, err := q.Engagement(ctx, ws.ID, id, false)
			if err != nil {
				return err
			}
			v, err := s.view(ctx, q, e, s.today(ws))
			if err != nil {
				return err
			}
			// each scheduled notice is one automatic action, once per period and kind; the digest mailing it is another
			count := func(p PeriodSummary, kind string) error {
				return q.CountAutomation(ctx, ws.ID, "engagements.notice:"+id+":"+p.ID+":"+kind, s.now())
			}
			add := func(p PeriodSummary, kind string) error {
				added, err := q.AddNotice(ctx, store.EngagementNotice{ID: auth.NewID("ntc"), EngagementID: id, PeriodID: p.ID,
					Kind: kind, CreatedAt: s.now()})
				if err != nil || !added {
					return err
				}
				return count(p, kind)
			}
			if p := v.CurrentPeriod; p != nil && p.State == "open" && p.Overage > 0 {
				if err := count(*p, "over_committed"); err != nil {
					return err
				}
				unit := ""
				if e.Unit != nil {
					unit = *e.Unit
				}
				if err := notifications.Notify(ctx, q, ws.ID, "engagement.over_committed", map[string]any{"engagement_id": id,
					"engagement": e.Title, "client": e.Client.Name, "period": periodLabel(*p), "overage": p.Overage.String(), "unit": unit},
					store.NotifyTo{Roles: notifications.Managers, Once: "engagement.over_committed:" + p.ID}, s.now()); err != nil {
					return err
				}
			}
			if p := v.CurrentPeriod; p != nil && p.State == "open" {
				if p.stats.EndingSoon {
					if err := add(*p, "ending_soon"); err != nil {
						return err
					}
				}
				if p.stats.ElapsedPct >= 50 && int64(p.Used)*2 < int64(p.Expected) {
					if err := add(*p, "under_pace"); err != nil {
						return err
					}
				}
			}
			if e.AutoInvoice {
				return nil
			}
			for _, p := range v.periods {
				if p.State == "closed" && p.UninvoicedQuantity > 0 {
					if err := add(p, "period_closed"); err != nil {
						return err
					}
				}
			}
			return nil
		}))
		if errors.Is(errs[len(errs)-1], store.ErrAdmissionDenied) {
			errs[len(errs)-1] = nil // the engagement's notices wait for room
		}
	}
	return errors.Join(errs...)
}

// periodLabel names a period in a notification: "2026-10-01 – 2026-10-31".
func periodLabel(p PeriodSummary) string { return p.StartsOn + " – " + p.EndsOn }
