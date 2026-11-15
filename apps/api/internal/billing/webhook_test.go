package billing

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestDelayedSubscriptionReadCannotRestoreAnOldPlan(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	ctx := context.Background()
	e.stripe.put("sub_1", b.workspace, "cus_1", "active", "price_pm")
	var delayed subscription
	if err := e.svc.stripe.Call(ctx, http.MethodGet, "/v1/subscriptions/sub_1", nil, "", &delayed); err != nil {
		t.Fatal(err)
	}
	// A second delivery observes cancellation while the first handler still holds the old response.
	e.stripe.put("sub_1", b.workspace, "cus_1", "canceled", "price_pm")
	e.event("evt_canceled", "customer.subscription.deleted", map[string]any{"id": "sub_1"})
	if err := e.svc.apply(ctx, delayed, event{ID: "evt_delayed", Type: "customer.subscription.updated"}); err != nil {
		t.Fatal(err)
	}
	got, err := e.st.WorkspaceBilling(ctx, b.workspace)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "canceled" || PlanOf(got, time.Now()) != "" {
		t.Fatalf("stale delivery restored canceled plan: %+v", got)
	}
}

// An incomplete subscription (its first payment unpaid) never grants its plan: a paid plan on record stays as it is
// while the payment is pending, a workspace without one stays locked. incomplete_expired only records the status of
// the subscription on record. Once paid (active) it is applied, or settled as a second live one.
func TestIncompleteSubscriptionNeverGrantsItsPlan(t *testing.T) {
	type step struct{ sub, status, price string }
	for _, tc := range []struct {
		name      string
		steps     []step
		keep      int // the billing after steps[keep] must stay as it was (-1: no check)
		sub       string
		status    string
		plan      string
		cancelled string // a subscription cancelled at Stripe as a second live one
	}{
		{"incomplete newcomer with a live paid plan", []step{{"sub_1", "active", "price_bm"}, {"sub_2", "incomplete", "price_pm"}},
			0, "sub_1", "active", Basic, ""},
		{"incomplete newcomer with a past-due plan", []step{{"sub_1", "past_due", "price_bm"}, {"sub_2", "incomplete", "price_xm"}},
			0, "sub_1", "past_due", Basic, ""},
		{"incomplete without a plan", []step{{"sub_1", "incomplete", "price_pm"}}, -1, "sub_1", "incomplete", "", ""},
		{"incomplete after an ended plan", []step{{"sub_1", "active", "price_bm"}, {"sub_1", "canceled", "price_bm"},
			{"sub_2", "incomplete", "price_pm"}}, 1, "sub_1", "canceled", "", ""},
		{"incomplete then paid", []step{{"sub_1", "incomplete", "price_pm"}, {"sub_1", "active", "price_pm"}},
			-1, "sub_1", "active", Pro, ""},
		{"incomplete newcomer paid while a plan is live", []step{{"sub_1", "active", "price_bm"}, {"sub_2", "incomplete", "price_pm"},
			{"sub_2", "active", "price_pm"}}, 0, "sub_1", "active", Basic, "sub_2"},
		{"incomplete on record gives way to a paid one", []step{{"sub_1", "incomplete", "price_bm"}, {"sub_2", "active", "price_pm"}},
			-1, "sub_2", "active", Pro, ""},
		{"incomplete_expired newcomer with a live plan", []step{{"sub_1", "active", "price_bm"}, {"sub_2", "incomplete", "price_pm"},
			{"sub_2", "incomplete_expired", "price_pm"}}, 0, "sub_1", "active", Basic, ""},
		{"incomplete_expired without a plan", []step{{"sub_1", "incomplete", "price_pm"}, {"sub_1", "incomplete_expired", "price_pm"}},
			-1, "sub_1", "incomplete_expired", "", ""},
		{"incomplete_expired first seen", []step{{"sub_1", "incomplete_expired", "price_pm"}}, -1, "sub_1", "incomplete_expired", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t, true)
			ws := e.workspace().workspace
			state := func() string {
				b := e.billing(ws)
				return fmt.Sprintf("%s %s %s %s %v %v %v", b.SubscriptionID, b.Status, b.Plan, b.Interval, b.PlanExpiresAt,
					b.CurrentPeriodEnd, b.TrialUsed)
			}
			var kept string
			deliver := func(prefix string) {
				for i, s := range tc.steps {
					if code := e.event(fmt.Sprintf("%s_%d", prefix, i), "customer.subscription.updated", map[string]any{"id": s.sub}); code != http.StatusOK {
						t.Fatalf("%s %d: status %d", prefix, i, code)
					}
				}
			}
			for i, s := range tc.steps {
				e.stripe.put(s.sub, ws, "cus_1", s.status, s.price)
				if code := e.event(fmt.Sprintf("evt_%d", i), "customer.subscription.updated", map[string]any{"id": s.sub}); code != http.StatusOK {
					t.Fatalf("step %d: status %d", i, code)
				}
				if i == tc.keep {
					kept = state()
				}
			}
			check := func(when string) {
				t.Helper()
				b := e.billing(ws)
				if b.SubscriptionID != tc.sub || b.Status != tc.status || PlanOf(b, time.Now()) != tc.plan {
					t.Fatalf("%s: billing %+v, want %s %s plan %q", when, b, tc.sub, tc.status, tc.plan)
				}
				if kept != "" && state() != kept {
					t.Fatalf("%s: billing changed from %s to %s", when, kept, state())
				}
				if n := e.stripe.called("DELETE /v1/subscriptions/" + tc.cancelled); (tc.cancelled != "") != (n > 0) {
					t.Fatalf("%s: cancelled %q %d times, calls %v", when, tc.cancelled, n, e.stripe.calls)
				}
			}
			check("applied")
			// Replayed (the same event ids) and re-delivered (new ids, out of order) events read the state as it is.
			deliver("evt")
			check("replayed")
			deliver("evt_again")
			check("re-delivered")
		})
	}
}

// Billing reads only an event's id, type and object id and reads the object again with its pinned version, so the
// endpoint's API version (null on an endpoint that follows the account's default) does not change what is applied.
func TestWebhookPayloadOfAnyAPIVersion(t *testing.T) {
	e := newEnv(t, true)
	discount := map[string]any{"source": map[string]any{"type": "coupon", "coupon": map[string]any{"id": "co_1", "percent_off": 20.0,
		"duration": "repeating", "duration_in_months": 3}}, "promotion_code": map[string]any{"id": "promo_1", "code": "LAUNCH20"}, "end": periodEnd}
	applied := func(payload func(ws string, current map[string]any) map[string]any) store.Billing {
		t.Helper()
		ws := e.workspace().workspace
		sub := "sub_" + ws
		e.stripe.put(sub, ws, "cus_"+ws, "active", "price_pm")
		e.stripe.mu.Lock()
		e.stripe.subs[sub]["items"] = items("price_pm", false, 3)
		e.stripe.subs[sub]["discounts"] = []map[string]any{discount}
		current := maps.Clone(e.stripe.subs[sub])
		e.stripe.mu.Unlock()
		if code := e.event("evt_"+ws, "customer.subscription.updated", payload(ws, current)); code != http.StatusOK {
			t.Fatalf("status %d", code)
		}
		return e.billing(ws)
	}
	now := applied(func(_ string, current map[string]any) map[string]any { return current })
	// 2024-06-20: the period at the top level, one `discount` with the coupon inline, no periods on the items.
	old := applied(func(ws string, _ map[string]any) map[string]any {
		return map[string]any{"id": "sub_" + ws, "object": "subscription", "status": "active", "customer": "cus_" + ws,
			"current_period_start": periodStart, "current_period_end": periodEnd, "metadata": map[string]string{"workspace_id": ws},
			"discount": map[string]any{"coupon": map[string]any{"id": "co_1", "percent_off": 20.0, "duration": "repeating",
				"duration_in_months": 3}, "promotion_code": "promo_1", "end": periodEnd},
			"plan": map[string]any{"id": "price_pm"}, "quantity": 3,
			"items": map[string]any{"data": []map[string]any{{"id": "si_1", "price": map[string]any{"id": "price_pm"}, "quantity": 3}}}}
	})
	if now.Plan != Pro || now.Seats == nil || *now.Seats != 3 || len(now.Discount) == 0 || now.PlanExpiresAt == nil {
		t.Fatalf("current payload: %+v", now)
	}
	if old.Plan != now.Plan || old.Status != now.Status || !old.PlanExpiresAt.Equal(*now.PlanExpiresAt) || *old.Seats != *now.Seats ||
		string(old.Discount) != string(now.Discount) {
		t.Fatalf("2024-06-20 payload applied %+v (discount %s), current %+v (discount %s)", old, old.Discount, now, now.Discount)
	}
}

func TestWebhookAITokenPackOfAnyAPIVersion(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	bought := func(payload func(cs map[string]any) map[string]any) int64 {
		t.Helper()
		b := e.workspace()
		e.subscribe(b.workspace, "price_bm")
		before, err := e.svc.AITokens(ctx, e.st.Q, b.workspace)
		if err != nil {
			t.Fatal(err)
		}
		cs := map[string]any{"id": "cs_" + b.workspace, "object": "checkout.session", "mode": "payment", "status": "complete",
			"customer": "cus_" + b.workspace, "payment_status": "paid", "metadata": map[string]string{"workspace_id": b.workspace,
				AITokensKey: "5000000"}}
		e.stripe.session(cs) // what Stripe answers with the pinned version
		if code := e.eventSigned("evt_"+b.workspace, "checkout.session.completed", payload(cs), whsec); code != http.StatusOK {
			t.Fatalf("status %d", code)
		}
		after, err := e.svc.AITokens(ctx, e.st.Q, b.workspace)
		if err != nil {
			t.Fatal(err)
		}
		return after - before
	}
	now := bought(func(cs map[string]any) map[string]any { return cs })
	// 2024-06-20: shipping and the customer's details in their older form; billing reads none of it.
	old := bought(func(cs map[string]any) map[string]any {
		return map[string]any{"id": cs["id"], "object": "checkout.session", "mode": "payment", "payment_status": "paid",
			"customer": cs["customer"], "metadata": cs["metadata"], "shipping": nil, "shipping_rate": nil,
			"customer_details": map[string]any{"email": "anna@example.com", "tax_exempt": "none", "tax_ids": []any{}},
			"total_details":    map[string]any{"amount_discount": 0, "amount_shipping": 0, "amount_tax": 0}}
	})
	if now != 5_000_000 || old != now {
		t.Fatalf("pack added %d with the current payload, %d with the 2024-06-20 one", now, old)
	}
}
