package billing

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"

	"helvetly.com/api/internal/store"
)

// Reprice moves a workspace's live subscription onto the offer on sale's tiered price of the same plan and interval
// (`helvetly billing reprice`, after the offer reset of 2026-11-24): the same subscription, its people as the quantity,
// its discounts and coupons as they are (Stripe keeps a subscription's discounts when an item's price changes) and
// nothing billed for the move. It refuses when a coupon applies only to other products, as it would stop applying.
// Without apply it only says what it would do.
func Reprice(ctx context.Context, db *store.Store, stripe *StripeClient, workspaceID string, apply bool, out io.Writer) error {
	b, err := db.WorkspaceBilling(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("workspace %s: %w", workspaceID, err)
	}
	if b.SubscriptionID == "" || !live(b.Status) {
		return fmt.Errorf("workspace %s has no live subscription (status %q)", workspaceID, b.Status)
	}
	offer, err := db.CurrentOffer(ctx)
	if err != nil {
		return fmt.Errorf("the offer on sale: %w", err)
	}
	var sub subscription
	expand := append(slices.Clone(subscriptionExpand), "discounts.source.coupon.applies_to")
	if err := stripe.Call(ctx, http.MethodGet, "/v1/subscriptions/"+url.PathEscape(b.SubscriptionID), url.Values{"expand[]": expand}, "", &sub); err != nil {
		return fmt.Errorf("reading subscription %s: %w", b.SubscriptionID, err)
	}
	if sub.schedule() != "" || sub.PendingUpdate != nil { // the schedule's next phase or the update would undo the move
		return fmt.Errorf("subscription %s has a scheduled change or a pending update: let it apply or release it first", sub.ID)
	}
	plan, interval := sub.price().planAndInterval()
	if plan == "" || len(sub.Items.Data) != 1 {
		return fmt.Errorf("subscription %s has %d items and price %s, which is no plan's", sub.ID, len(sub.Items.Data), sub.priceID())
	}
	key := LookupKey(offer.ID, plan, interval)
	var found list[price]
	if err := stripe.Call(ctx, http.MethodGet, "/v1/prices", url.Values{"active": {"true"}, "lookup_keys[]": {key}}, "", &found); err != nil {
		return fmt.Errorf("reading the price %s: %w", key, err)
	}
	if len(found.Data) == 0 {
		return fmt.Errorf("no active price with lookup key %s: export the catalogue of %s to Stripe first (helvetly offer catalog)", key, offer.ID)
	}
	target := found.Data[0]
	if sub.priceID() == target.ID {
		fmt.Fprintf(out, "workspace %s: subscription %s is on %s (%s) already; nothing to do\n", workspaceID, sub.ID, key, target.ID)
		return nil
	}
	coupons := []string{}
	for _, d := range sub.Discounts {
		c := d.Source.Coupon
		if c.AppliesTo != nil && len(c.AppliesTo.Products) > 0 && !slices.Contains(c.AppliesTo.Products, target.Product) {
			return fmt.Errorf("coupon %s applies only to %v, not to %s's product %s: it would stop applying, so nothing was changed",
				c.ID, c.AppliesTo.Products, key, target.Product)
		}
		coupons = append(coupons, c.ID)
	}
	people, err := db.Seats(ctx, workspaceID)
	if err != nil {
		return err
	}
	quantity := max(people, 1)
	fmt.Fprintf(out, "workspace %s: subscription %s (%s, %s %s): price %s × %d -> %s (%s) × %d, %s total; discounts kept: %v\n",
		workspaceID, sub.ID, sub.Status, plan, interval, sub.priceID(), sub.quantity(), target.ID, key, quantity,
		money(PlanTotal(plan, interval, quantity)), coupons)
	if !apply {
		fmt.Fprintln(out, "dry run: nothing changed; run again with -apply to move it")
		return nil
	}
	form := url.Values{"items[0][id]": {sub.Items.Data[0].ID}, "items[0][price]": {target.ID},
		"items[0][quantity]": {fmt.Sprint(quantity)}, "proration_behavior": {"none"}, "metadata[offer_id]": {offer.ID},
		"expand[]": expand} // the answer's discounts as objects, to check they stayed
	var moved subscription
	if err := stripe.Call(ctx, http.MethodPost, "/v1/subscriptions/"+url.PathEscape(sub.ID), form,
		"helvetly-reprice-"+sub.ID+"-"+target.ID, &moved); err != nil {
		return fmt.Errorf("moving subscription %s: %w", sub.ID, err)
	}
	if moved.priceID() != target.ID || len(moved.Discounts) < len(sub.Discounts) {
		return errors.New("stripe answered with another price or fewer discounts: check the subscription in the Dashboard")
	}
	fmt.Fprintf(out, "moved: subscription %s is on %s; Stripe's webhook brings the workspace up to date\n", sub.ID, key)
	return nil
}

// money is minor units as "CHF 19.00"-like text without the currency, for the operator's output.
func money(minor int64) string { return fmt.Sprintf("%d.%02d", minor/100, minor%100) }
