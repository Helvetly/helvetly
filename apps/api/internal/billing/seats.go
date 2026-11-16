package billing

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"helvetly.com/api/internal/store"
)

// SyncSeats sets a live per-seat subscription's quantity to the workspace's seats, after a member joined or left
// (syncSeats). A flat or ended subscription, or billing off, changes nothing. A
// failure is logged, not returned: the membership change stands, and the hourly job (Run) catches up.
func (s *Service) SyncSeats(ctx context.Context, workspaceID string) {
	ctx = context.WithoutCancel(ctx)
	if s.enabled {
		if err := s.db.MarkSeatsChanged(ctx, workspaceID, s.now()); err != nil {
			s.log.ErrorContext(ctx, "noting a membership change failed", "workspace", workspaceID, "error", err)
		}
	}
	s.resyncSeats(ctx, workspaceID)
}

func (s *Service) resyncSeats(ctx context.Context, workspaceID string) {
	if err := s.syncSeats(context.WithoutCancel(ctx), workspaceID); err != nil {
		s.log.ErrorContext(ctx, "syncing the subscription's seats failed", "workspace", workspaceID, "error", err)
	}
}

// syncSeats sets the quantity to the workspace's people. More people than the seats paid for the period are charged
// at once, prorated from the latest membership change (clamped to the current period and now), and granted only once
// paid (pending_if_incomplete: an unpaid seat adds nothing to the pooled allowances). Fewer people, or a person
// replacing one within the paid seats, change nothing now: a reduction is billed from the renewal and the seats stay
// paid until then (paidSeats), without a refund or a fresh monthly allowance. During the trial seats are free.
// Idempotent: nothing changes when Stripe already bills the members, or while a seat change waits for its payment.
func (s *Service) syncSeats(ctx context.Context, workspaceID string) error {
	if !s.enabled {
		return nil
	}
	return s.db.Tx(ctx, func(q store.Q) error {
		// The billing lock orders this after a plan change or another sync, so the last one bills the last count.
		if err := q.LockBilling(ctx, workspaceID); err != nil {
			return err
		}
		b, err := q.WorkspaceBilling(ctx, workspaceID)
		if err != nil || !b.PerSeat || !live(b.Status) || b.SubscriptionID == "" {
			return err
		}
		seats, err := q.Seats(ctx, workspaceID)
		if err != nil {
			return err
		}
		seats = max(seats, 1)
		if b.Seats != nil && *b.Seats == seats {
			return nil
		}
		sub, err := s.getSubscription(ctx, b.SubscriptionID)
		if err != nil {
			return err
		}
		if len(sub.Items.Data) == 0 {
			return fmt.Errorf("billing: subscription %s has no items", sub.ID)
		}
		if sub.quantity() != seats && live(sub.Status) && sub.PendingUpdate == nil {
			form := url.Values{"items[0][id]": {sub.Items.Data[0].ID}, "items[0][quantity]": {strconv.FormatInt(seats, 10)},
				"proration_behavior": {"none"}, "expand[]": subscriptionExpand}
			if sub.Status != "trialing" && seats > paidSeats(b) {
				form.Set("proration_behavior", "always_invoice")
				form.Set("payment_behavior", "pending_if_incomplete")
				form.Set("proration_date", strconv.FormatInt(prorationDate(b.SeatsChangedAt, sub.periodStart(), s.now()), 10))
			}
			if err := s.stripe.Call(ctx, http.MethodPost, "/v1/subscriptions/"+url.PathEscape(sub.ID), form, "", &sub); err != nil {
				return err
			}
		}
		_, err = s.save(ctx, q, workspaceID, b, sub)
		return err
	})
}

// prorationDate is when a seat change counts from: the membership change (now when unknown), never before the
// period's start (Stripe wants a date inside the current period) nor after now.
func prorationDate(changed *time.Time, periodStart int64, now time.Time) int64 {
	at := now.Unix()
	if changed != nil {
		at = min(changed.Unix(), at)
	}
	return max(at, periodStart)
}

// Run keeps per-seat subscriptions in step with their members every hour: a sync that failed, or a membership
// that ended without one (a closed account), is billed right on the next run. It also reads again the
// subscriptions whose plan expired (LapsedTick), and forgets trial claims past their retention (TrialClaimsTick), also
// with billing off, so claims kept from when it was on still expire.
func (s *Service) Run(ctx context.Context) {
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if s.enabled {
			if err := s.SeatsTick(ctx); err != nil {
				s.log.ErrorContext(ctx, "seats job", "error", err)
			}
			if err := s.LapsedTick(ctx); err != nil {
				s.log.ErrorContext(ctx, "lapsed plans job", "error", err)
			}
		}
		if err := s.TrialClaimsTick(ctx); err != nil {
			s.log.ErrorContext(ctx, "trial claims job", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// SeatsTick syncs every workspace whose per-seat subscription bills another number than its members; a failure on
// one is logged and retried on the next run, only a failed lookup is returned.
func (s *Service) SeatsTick(ctx context.Context) error {
	ids, err := s.db.SeatsOutOfStep(ctx)
	if err != nil {
		return fmt.Errorf("list workspaces with seats out of step: %w", err)
	}
	for _, id := range ids {
		s.resyncSeats(ctx, id)
	}
	return nil
}

// LapsedTick reads again from Stripe every subscription recorded live whose plan expired: a renewal whose event was
// lost moves the end on, an unpaid one stays locked. A failure on one is logged and retried on the next run.
func (s *Service) LapsedTick(ctx context.Context) error {
	ids, err := s.db.PlansLapsed(ctx, s.now())
	if err != nil {
		return fmt.Errorf("list workspaces whose plan expired: %w", err)
	}
	for _, id := range ids {
		b, err := s.db.WorkspaceBilling(ctx, id)
		if err == nil {
			var sub subscription
			if sub, err = s.getSubscription(ctx, b.SubscriptionID); err == nil {
				err = s.apply(ctx, sub, event{})
			}
		}
		if err != nil {
			s.log.ErrorContext(ctx, "reading a lapsed subscription failed", "workspace", id, "error", err)
		}
	}
	return nil
}
