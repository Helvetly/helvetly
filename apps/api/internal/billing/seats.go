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

// SyncSeats sets a live per-seat subscription's quantity to the workspace's seats, after a member joined or left.
// Stripe prorates the change (its default, create_prorations): an added seat is charged and a removed one credited
// for the rest of the period, on the next invoice. A flat or ended subscription, or billing off, changes nothing.
// A failure is logged, not returned: the membership change stands, and the hourly job (Run) catches up.
func (s *Service) SyncSeats(ctx context.Context, workspaceID string) {
	if err := s.syncSeats(context.WithoutCancel(ctx), workspaceID); err != nil {
		s.log.ErrorContext(ctx, "syncing the subscription's seats failed", "workspace", workspaceID, "error", err)
	}
}

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
		form := url.Values{"items[0][id]": {sub.Items.Data[0].ID}, "items[0][quantity]": {strconv.FormatInt(seats, 10)},
			"proration_behavior": {"create_prorations"}, "expand[]": {"discount.promotion_code"}}
		if err := s.stripe.Call(ctx, http.MethodPost, "/v1/subscriptions/"+url.PathEscape(sub.ID), form, "", &sub); err != nil {
			return err
		}
		return q.ApplySubscription(ctx, workspaceID, sub.Customer, s.toStore(sub), s.now())
	})
}

// Run keeps per-seat subscriptions in step with their members every hour: a sync that failed, or a membership
// that ended without one (a closed account), is billed right on the next run.
func (s *Service) Run(ctx context.Context) {
	if !s.enabled {
		return
	}
	tick := time.NewTicker(time.Hour)
	defer tick.Stop()
	for {
		if err := s.SeatsTick(ctx); err != nil {
			s.log.ErrorContext(ctx, "seats job", "error", err)
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
		s.SyncSeats(ctx, id)
	}
	return nil
}
