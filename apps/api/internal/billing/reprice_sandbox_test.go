package billing

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

// TestRepriceInTheStripeSandbox runs Reprice against Stripe test mode when HELVETLY_STRIPE_SANDBOX_KEY holds an
// sk_test_ key (never in CI): a customer with a 100 % coupon for good on a flat per-seat price is moved onto a tiered
// price with the current Business lookup key, and keeps its coupon. When the sandbox has no such price yet the test
// makes one and afterwards deactivates it and frees its lookup key for the catalogue export; its customer (with the
// subscription), coupon, prices and product go too.
func TestRepriceInTheStripeSandbox(t *testing.T) {
	key := os.Getenv("HELVETLY_STRIPE_SANDBOX_KEY")
	if !strings.HasPrefix(key, "sk_test_") {
		t.Skip("HELVETLY_STRIPE_SANDBOX_KEY is not a Stripe test key")
	}
	ctx := context.Background()
	sc := NewStripeClient(key, "https://api.stripe.com")
	call := func(method, path string, form url.Values, out any) {
		t.Helper()
		if err := sc.Call(ctx, method, path, form, "", out); err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
	}
	type obj struct {
		ID      string `json:"id"`
		Product string `json:"product"`
	}
	run := fmt.Sprint("reprice-test-", time.Now().Unix())
	var product obj
	call(http.MethodPost, "/v1/products", url.Values{"name": {"Helvetly reprice test " + run}}, &product)
	t.Cleanup(func() {
		_ = sc.Call(ctx, http.MethodPost, "/v1/products/"+product.ID, url.Values{"active": {"false"}}, "", nil)
	})
	var flat obj
	call(http.MethodPost, "/v1/prices", url.Values{"product": {product.ID}, "currency": {"chf"}, "unit_amount": {"9900"},
		"recurring[interval]": {"month"}, "tax_behavior": {"inclusive"}, "metadata[helvetly_plan]": {Business},
		"metadata[helvetly_interval]": {"month"}, "metadata[" + PricingKey + "]": {PerSeat}}, &flat)
	t.Cleanup(func() {
		_ = sc.Call(ctx, http.MethodPost, "/v1/prices/"+flat.ID, url.Values{"active": {"false"}}, "", nil)
	})

	lookup := LookupKey(currentOffer, Business, "month")
	var found list[price]
	call(http.MethodGet, "/v1/prices", url.Values{"active": {"true"}, "lookup_keys[]": {lookup}}, &found)
	target := ""
	if len(found.Data) > 0 {
		target = found.Data[0].ID
	} else {
		var tiered obj
		call(http.MethodPost, "/v1/prices", url.Values{"product": {product.ID}, "currency": {"chf"}, "billing_scheme": {"tiered"},
			"tiers_mode": {"graduated"}, "tiers[0][up_to]": {"5"}, "tiers[0][flat_amount]": {"9900"}, "tiers[0][unit_amount]": {"0"},
			"tiers[1][up_to]": {"inf"}, "tiers[1][unit_amount]": {"2000"}, "recurring[interval]": {"month"}, "tax_behavior": {"inclusive"},
			"lookup_key": {lookup}, "metadata[helvetly_plan]": {Business}, "metadata[helvetly_interval]": {"month"},
			"metadata[" + PricingKey + "]": {PerSeat}}, &tiered)
		target = tiered.ID
		t.Cleanup(func() { // before the product (cleanups run last first): free the key for the catalogue export
			_ = sc.Call(ctx, http.MethodPost, "/v1/prices/"+tiered.ID, url.Values{"active": {"false"}, "lookup_key": {""}}, "", nil)
		})
	}
	var coupon, customer, sub obj
	call(http.MethodPost, "/v1/coupons", url.Values{"percent_off": {"100"}, "duration": {"forever"}, "name": {run}}, &coupon)
	t.Cleanup(func() { _ = sc.Call(ctx, http.MethodDelete, "/v1/coupons/"+coupon.ID, nil, "", nil) })
	call(http.MethodPost, "/v1/customers", url.Values{"email": {"reprice-test@example.com"}, "description": {run}}, &customer)
	t.Cleanup(func() { _ = sc.Call(ctx, http.MethodDelete, "/v1/customers/"+customer.ID, nil, "", nil) })
	call(http.MethodPost, "/v1/subscriptions", url.Values{"customer": {customer.ID}, "items[0][price]": {flat.ID},
		"items[0][quantity]": {"2"}, "discounts[0][coupon]": {coupon.ID}}, &sub)

	e := newEnv(t, false)
	ws := e.workspace().workspace
	e.exec(`INSERT INTO workspace_billing (workspace_id, stripe_customer_id, stripe_subscription_id, status, plan, billing_interval, offer_id, updated_at)
		VALUES ($1, $2, $3, 'active', 'business', 'month', $4, now())
		ON CONFLICT (workspace_id) DO UPDATE SET stripe_customer_id = $2, stripe_subscription_id = $3, status = 'active', plan = 'business',
			billing_interval = 'month', offer_id = $4`, ws, customer.ID, sub.ID, currentOffer)
	var out bytes.Buffer
	if err := Reprice(ctx, e.st, sc, ws, false, &out); err != nil || !strings.Contains(out.String(), "dry run") {
		t.Fatalf("dry run: %v %s", err, out.String())
	}
	if err := Reprice(ctx, e.st, sc, ws, true, &out); err != nil || !strings.Contains(out.String(), "moved") {
		t.Fatalf("apply: %v %s", err, out.String())
	}
	var after subscription
	call(http.MethodGet, "/v1/subscriptions/"+sub.ID, url.Values{"expand[]": {"discounts.source.coupon"}}, &after)
	if after.priceID() != target || len(after.Discounts) != 1 || after.Discounts[0].Source.Coupon.ID != coupon.ID {
		t.Fatalf("after the move: price %s, discounts %+v", after.priceID(), after.Discounts)
	}
	t.Logf("%s", out.String())
}
