package billing

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

// TestRepriceKeepsTheLifetimeDiscount: the owner's workspace with a 100 % coupon for good, on an earlier offer's flat
// per-seat Business price, is moved onto the current tiered Business price only with -apply: same subscription,
// its people as the quantity, nothing prorated, the coupon kept. A coupon for other products refuses the move.
func TestRepriceKeepsTheLifetimeDiscount(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.join(ws, "member")
	e.subscribe(ws, "price_xm")
	legacy := func(coupon map[string]any) {
		e.stripe.mu.Lock()
		defer e.stripe.mu.Unlock()
		s := e.stripe.subs["sub_"+ws]
		s["items"] = map[string]any{"data": []map[string]any{{"id": "si_1", "quantity": int64(2), "current_period_start": periodStart,
			"price": map[string]any{"id": "price_v15_business_month", "lookup_key": "helvetly_business_month",
				"metadata": map[string]string{PricingKey: PerSeat, "helvetly_plan": Business, "helvetly_interval": "month"}}}}}
		s["discounts"] = []map[string]any{{"source": map[string]any{"coupon": coupon}}}
	}
	lifetime := map[string]any{"id": "owner_lifetime", "percent_off": 100.0, "duration": "forever"}
	legacy(lifetime)

	var out bytes.Buffer
	if err := Reprice(ctx, e.st, e.svc.stripe, ws, false, &out); err != nil || !strings.Contains(out.String(), "dry run") ||
		!strings.Contains(out.String(), "price_v15_business_month × 2 -> price_xm ("+currentOffer+"_business_month) × 2, 99.00 total") ||
		!strings.Contains(out.String(), "[owner_lifetime]") {
		t.Fatalf("dry run: %v %s", err, out.String())
	}
	if n := e.stripe.called("POST /v1/subscriptions/sub_" + ws); n != 0 {
		t.Fatalf("a dry run changed the subscription %d times", n)
	}

	out.Reset()
	if err := Reprice(ctx, e.st, e.svc.stripe, ws, true, &out); err != nil || !strings.Contains(out.String(), "moved") {
		t.Fatalf("apply: %v %s", err, out.String())
	}
	f := e.stripe.form("POST /v1/subscriptions/sub_" + ws)
	if f.Get("items[0][id]") != "si_1" || f.Get("items[0][price]") != "price_xm" || f.Get("items[0][quantity]") != "2" ||
		f.Get("proration_behavior") != "none" || f.Get("metadata[offer_id]") != currentOffer || f.Has("discounts[0][coupon]") {
		t.Fatalf("move form %v", f)
	}
	out.Reset()
	if err := Reprice(ctx, e.st, e.svc.stripe, ws, true, &out); err != nil || !strings.Contains(out.String(), "nothing to do") {
		t.Fatalf("again: %v %s", err, out.String())
	}

	legacy(lifetime)
	e.stripe.mu.Lock()
	e.stripe.subs["sub_"+ws]["schedule"] = "sub_sched_1" // a downgrade booked for the period's end
	e.stripe.mu.Unlock()
	if err := Reprice(ctx, e.st, e.svc.stripe, ws, true, &out); err == nil || !strings.Contains(err.Error(), "scheduled change") {
		t.Fatalf("a scheduled change: %v", err)
	}
	e.stripe.mu.Lock()
	delete(e.stripe.subs["sub_"+ws], "schedule")
	e.stripe.mu.Unlock()

	legacy(map[string]any{"id": "pro_only", "percent_off": 50.0, "duration": "forever", "applies_to": map[string]any{"products": []string{"prod_pro"}}})
	if err := Reprice(ctx, e.st, e.svc.stripe, ws, true, &out); err == nil || !strings.Contains(err.Error(), "would stop applying") {
		t.Fatalf("a coupon for another product: %v", err)
	}
	if err := Reprice(ctx, e.st, e.svc.stripe, e.workspace().workspace, false, &out); err == nil {
		t.Fatal("a workspace without a subscription was repriced")
	}
}
