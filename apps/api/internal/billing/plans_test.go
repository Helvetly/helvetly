package billing

import (
	"net/http"
	"testing"
	"time"
)

func TestPricesByLookupKey(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspaceIn("Europe/Zurich")
	delete(e.stripe.catalog, "helvetly_business_year") // not deployed yet
	for range 2 {
		code, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
		data, _ := body["data"].(map[string]any)
		list, _ := data["plans"].([]any)
		if code != http.StatusOK || len(list) != 3 {
			t.Fatalf("overview: %d %v", code, body)
		}
		for i, want := range []struct {
			id           string
			month, year  float64
			yearDeployed bool
		}{{"basic", 1900, 18300, true}, {"pro", 4900, 47100, true}, {"business", 9900, 0, false}} {
			p, _ := list[i].(map[string]any)
			prices, _ := p["prices"].(map[string]any)
			month, _ := prices["month"].(map[string]any)
			year, _ := prices["year"].(map[string]any)
			if p["id"] != want.id || month["amount"] != want.month || month["currency"] != "chf" || (year != nil) != want.yearDeployed ||
				(want.yearDeployed && year["amount"] != want.year) {
				t.Fatalf("plan %d: %v", i, p)
			}
		}
	}
	if n := e.stripe.called("GET /v1/prices"); n != 1 {
		t.Fatalf("prices read %d times, want 1 (cached)", n)
	}
	f := e.stripe.form("GET /v1/prices")
	if got := len(f["lookup_keys[]"]); got != 6 || f.Get("active") != "true" {
		t.Fatalf("prices form %v", f)
	}
	// A plan whose price is not deployed cannot be bought.
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Business, "interval": "year"}); code != http.StatusConflict {
		t.Fatalf("undeployed price: %d", code)
	}
}

func TestLockedGuard(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	for _, path := range []string{"/api/v1/clients", "/api/v1/invoices", "/api/v1/documents"} {
		code, body := e.do(owner, http.MethodPost, path, map[string]string{"x": "y"})
		errBody, _ := body["error"].(map[string]any)
		details, ok := errBody["details"].(map[string]any)
		if code != http.StatusPaymentRequired || errBody["code"] != "plan_required" || !ok || len(details) != 0 {
			t.Fatalf("POST %s without a plan: %d %v", path, code, body)
		}
	}
	for _, tc := range []struct{ method, path string }{
		{"PUT", "/api/v1/engagement-settings"}, {"DELETE", "/api/v1/clients/cli_1"}, {"POST", "/api/v1/workspace"},
	} {
		if code, _ := e.do(owner, tc.method, tc.path, nil); code != http.StatusPaymentRequired {
			t.Fatalf("%s %s without a plan: %d", tc.method, tc.path, code)
		}
	}
	notLocked := []struct{ method, path string }{
		{"GET", "/api/v1/clients"}, {"GET", "/api/v1/billing"}, {"POST", "/api/v1/billing/checkout"}, {"POST", "/api/v1/billing/portal"},
		{"POST", "/api/v1/session/workspace"}, {"POST", "/api/v1/session/onboarded"}, {"POST", "/api/v1/workspaces"}, {"PATCH", "/api/v1/workspace"},
		{"DELETE", "/api/v1/workspace"}, {"POST", "/api/v1/public/sign/abc"}, {"POST", "/api/v1/auth/email/start"},
		{"POST", "/api/v1/invitations/accept"}, {"POST", "/api/v1/account/passkeys/start"},
	}
	for _, tc := range notLocked {
		if code, body := e.do(owner, tc.method, tc.path, map[string]string{}); code == http.StatusPaymentRequired {
			t.Fatalf("%s %s was locked: %v", tc.method, tc.path, body)
		}
	}
	// The webhook is not signed in and must always get through.
	if code := e.event("evt_x", "invoice.paid", map[string]any{"id": "in_1"}); code != http.StatusOK {
		t.Fatalf("webhook: %d", code)
	}

	for _, status := range []string{"active", "trialing", "past_due"} {
		e.stripe.put("sub_1", ws, "cus_1", status, "price_bm")
		e.event("evt_"+status, "customer.subscription.updated", map[string]any{"id": "sub_1"})
		if code, body := e.do(owner, http.MethodPost, "/api/v1/clients", map[string]string{"x": "y"}); code != http.StatusCreated {
			t.Fatalf("%s subscription: %d %v", status, code, body)
		}
	}
	e.stripe.put("sub_1", ws, "cus_1", "canceled", "price_bm")
	e.event("evt_canceled", "customer.subscription.deleted", map[string]any{"id": "sub_1"})
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/clients", map[string]string{"x": "y"}); code != http.StatusPaymentRequired {
		t.Fatalf("after cancelling: %d", code)
	}

	t.Run("billing off", func(t *testing.T) {
		off := newEnv(t, false)
		if code, _ := off.do(off.workspace(), http.MethodPost, "/api/v1/clients", map[string]string{"x": "y"}); code != http.StatusCreated {
			t.Fatalf("billing off: %d", code)
		}
	})
}

func TestTrialOnlyOnTheTrialPlan(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	checkout := func(plan string) {
		t.Helper()
		if code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": plan, "interval": "month"}); code != http.StatusOK {
			t.Fatalf("checkout %s: %d %v", plan, code, body)
		}
	}
	for _, plan := range []string{Basic, Pro} {
		checkout(plan)
		if f := e.stripe.form("POST /v1/checkout/sessions"); f.Get("subscription_data[trial_period_days]") != "" || f.Has("subscription_data[metadata][trial_user]") {
			t.Fatalf("%s got a trial: %v", plan, f)
		}
	}
	checkout(Business) // the offer's trial plan
	f := e.stripe.form("POST /v1/checkout/sessions")
	if f.Get("subscription_data[trial_period_days]") != "7" || f.Get("subscription_data[trial_settings][end_behavior][missing_payment_method]") != "cancel" ||
		f.Get("payment_method_collection") != "always" || f.Get("subscription_data[metadata][trial_user]") == "" {
		t.Fatalf("Business has no 7-day trial with card: %v", f)
	}
}

func TestPromotionCode(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	member := e.join(owner.workspace, "member")
	past, future := time.Now().Add(-time.Hour).Unix(), time.Now().Add(24*time.Hour).Unix()
	e.stripe.promo("LAUNCH20", true, future, 0, 0)
	e.stripe.promo("PROONLY", true, 0, 0, 0, "prod_pro", "prod_business")
	e.stripe.promo("OFF", false, 0, 0, 0)
	e.stripe.promo("OLD", true, past, 0, 0)
	e.stripe.promo("USEDUP", true, 0, 5, 5)
	e.stripe.promo("NOPLAN", true, 0, 0, 0, "prod_other")

	post := func(b *browser, code string) (int, map[string]any) {
		return e.do(b, http.MethodPost, "/api/v1/billing/promotion-code", map[string]string{"code": code})
	}
	code, body := post(owner, " launch20 ")
	data, _ := body["data"].(map[string]any)
	if code != http.StatusOK || data["code"] != "LAUNCH20" || data["percent_off"] != 20.0 || data["amount_off"] != nil ||
		data["duration"] != "repeating" || data["duration_in_months"] != 3.0 || data["plans"] != nil || data["expires_at"] == nil {
		t.Fatalf("valid: %d %v", code, body)
	}
	code, body = post(owner, "PROONLY")
	data, _ = body["data"].(map[string]any)
	if plans, _ := data["plans"].([]any); code != http.StatusOK || len(plans) != 2 || plans[0] != "pro" || plans[1] != "business" || data["expires_at"] != nil {
		t.Fatalf("limited to plans: %d %v", code, body)
	}
	for _, tc := range []struct{ code, reason, message string }{
		{"OFF", "invalid", "This code isn't valid."},
		{"OLD", "invalid", "This code isn't valid."},
		{"USEDUP", "invalid", "This code isn't valid."},
		{"UNKNOWN", "invalid", "This code isn't valid."},
		{"", "invalid", "This code isn't valid."},
		{"NOPLAN", "plan", "This code doesn't apply to any plan."},
	} {
		code, body := post(owner, tc.code)
		errBody, _ := body["error"].(map[string]any)
		details, _ := errBody["details"].(map[string]any)
		fields, _ := details["fields"].(map[string]any)
		if code != http.StatusUnprocessableEntity || errBody["code"] != "promotion_code_invalid" || errBody["message"] != tc.message ||
			details["reason"] != tc.reason || fields["code"] != "invalid" {
			t.Fatalf("code %q: %d %v", tc.code, code, body)
		}
	}
	if code, _ := post(member, "LAUNCH20"); code != http.StatusForbidden {
		t.Fatalf("a member checked a code: %d", code)
	}
}

func TestCheckoutWithCode(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.stripe.promo("LAUNCH20", true, 0, 0, 0)
	e.stripe.promo("PROONLY", true, 0, 0, 0, "prod_pro")
	checkout := func(plan, code string) (int, map[string]any) {
		return e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": plan, "interval": "month", "promotion_code": code})
	}

	if code, body := checkout(Pro, "LAUNCH20"); code != http.StatusOK {
		t.Fatalf("with a code: %d %v", code, body)
	}
	f := e.stripe.form("POST /v1/checkout/sessions")
	if f.Get("discounts[0][promotion_code]") != "promo_LAUNCH20" || f.Has("allow_promotion_codes") {
		t.Fatalf("with a code: %v", f)
	}
	if code, _ := checkout(Pro, ""); code != http.StatusOK {
		t.Fatal(code)
	}
	if f := e.stripe.form("POST /v1/checkout/sessions"); f.Get("allow_promotion_codes") != "true" || f.Has("discounts[0][promotion_code]") {
		t.Fatalf("without a code: %v", f)
	}

	// A code for other plans is refused, and no Checkout session is made.
	before := e.stripe.called("POST /v1/checkout/sessions")
	code, body := checkout(Basic, "PROONLY")
	if errBody, _ := body["error"].(map[string]any); code != http.StatusUnprocessableEntity || errBody["code"] != "promotion_code_invalid" ||
		e.stripe.called("POST /v1/checkout/sessions") != before {
		t.Fatalf("wrong plan: %d %v", code, body)
	}
	if code, _ := checkout(Business, "PROONLY"); code != http.StatusUnprocessableEntity {
		t.Fatalf("Business is not in the code's products: %d", code)
	}
	if errBody, _ := body["error"].(map[string]any); errBody["message"] != "This code doesn't apply to the Basic plan." {
		t.Fatalf("wrong plan message: %v", body)
	}
	if code, _ := checkout(Pro, "PROONLY"); code != http.StatusOK {
		t.Fatalf("right plan: %d", code)
	}

	// A live subscription switch gets the same discount.
	e.stripe.put("sub_1", owner.workspace, "cus_1", "active", "price_bm")
	e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"})
	if code, body := checkout(Pro, "LAUNCH20"); code != http.StatusOK {
		t.Fatalf("switch: %d %v", code, body)
	}
	if got := e.stripe.form("POST /v1/subscriptions/sub_1").Get("discounts[0][promotion_code]"); got != "promo_LAUNCH20" {
		t.Fatalf("switch discount = %q", got)
	}
}

// amountPromo adds an amount-off code: 10 off in francs, and in the other currencies given.
func (f *fakeStripe) amountPromo(code string, others ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	options := map[string]any{"chf": map[string]any{"amount_off": 1000}}
	for _, cur := range others {
		options[cur] = map[string]any{"amount_off": 1000}
	}
	f.coupons["co_"+code] = map[string]any{"id": "co_" + code, "amount_off": 1000, "currency": "chf", "duration": "once", "valid": true,
		"currency_options": options}
	f.promos[code] = map[string]any{"id": "promo_" + code, "code": code, "active": true, "promotion": map[string]any{"type": "coupon", "coupon": "co_" + code}}
}

func TestAmountOffCodeNeedsTheWorkspaceCurrency(t *testing.T) {
	e := newEnv(t, true)
	e.stripe.amountPromo("TENOFF", EUR)
	e.stripe.amountPromo("FRANCS")
	for _, tc := range []struct {
		name, tz, code string
		status         int
		reason         string
		amount         any
		currency       any
	}{
		{"francs in Switzerland", "Europe/Zurich", "FRANCS", http.StatusOK, "", 1000.0, "chf"},
		{"the euro option in Germany", "Europe/Berlin", "TENOFF", http.StatusOK, "", 1000.0, "eur"},
		{"no dollar amount", "America/New_York", "TENOFF", http.StatusUnprocessableEntity, "currency", nil, nil},
		{"a francs-only code in Germany", "Europe/Berlin", "FRANCS", http.StatusUnprocessableEntity, "currency", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			owner := e.workspaceIn(tc.tz)
			code, body := e.do(owner, http.MethodPost, "/api/v1/billing/promotion-code", map[string]string{"code": tc.code})
			if code != tc.status {
				t.Fatalf("check: %d %v", code, body)
			}
			if tc.status != http.StatusOK {
				errBody, _ := body["error"].(map[string]any)
				details, _ := errBody["details"].(map[string]any)
				if details["reason"] != tc.reason || errBody["message"] != "This code is for payments in CHF." {
					t.Fatalf("refusal: %v", body)
				}
				code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month", "promotion_code": tc.code})
				if code != http.StatusUnprocessableEntity {
					t.Fatalf("checkout with the code: %d", code)
				}
				return
			}
			data, _ := body["data"].(map[string]any)
			if data["amount_off"] != tc.amount || data["currency"] != tc.currency {
				t.Fatalf("promotion: %v", data)
			}
		})
	}
}

func TestOneDiscountAtATime(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.stripe.promo("LAUNCH20", true, 0, 0, 0)
	e.subscribe(owner.workspace, "price_bm")
	checkout := func(plan, code string) (int, map[string]any) {
		return e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": plan, "interval": "month", "promotion_code": code})
	}

	// The same plan and interval with a code: only the code is applied.
	if code, body := checkout(Basic, "LAUNCH20"); code != http.StatusOK {
		t.Fatalf("code on the same plan: %d %v", code, body)
	}
	f := e.stripe.form("POST /v1/subscriptions/sub_" + owner.workspace)
	if f.Get("discounts[0][promotion_code]") != "promo_LAUNCH20" || f.Has("items[0][price]") || f.Has("proration_behavior") {
		t.Fatalf("code only: %v", f)
	}
	if code, _ := checkout(Basic, ""); code != http.StatusConflict {
		t.Fatalf("same plan without a code: %d", code)
	}

	// Now the subscription has a discount: no other code until it ends.
	e.stripe.mu.Lock()
	e.stripe.subs["sub_"+owner.workspace]["discounts"] = []map[string]any{{"source": map[string]any{"type": "coupon",
		"coupon": map[string]any{"percent_off": 20.0, "duration": "repeating", "duration_in_months": 3}}}}
	e.stripe.mu.Unlock()
	for _, tc := range []struct {
		name string
		do   func() (int, map[string]any)
	}{
		{"check", func() (int, map[string]any) {
			return e.do(owner, http.MethodPost, "/api/v1/billing/promotion-code", map[string]string{"code": "LAUNCH20"})
		}},
		{"switch", func() (int, map[string]any) { return checkout(Pro, "LAUNCH20") }},
	} {
		code, body := tc.do()
		errBody, _ := body["error"].(map[string]any)
		details, _ := errBody["details"].(map[string]any)
		if code != http.StatusUnprocessableEntity || details["reason"] != "has_discount" {
			t.Fatalf("%s with a discount: %d %v", tc.name, code, body)
		}
	}
	if code, body := checkout(Pro, ""); code != http.StatusOK {
		t.Fatalf("switch without a code keeps the discount: %d %v", code, body)
	}
}

func TestOverviewDiscount(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.subscribe(owner.workspace, "price_bm")
	e.stripe.mu.Lock()
	e.stripe.subs["sub_"+owner.workspace]["discounts"] = []map[string]any{{
		"source":         map[string]any{"type": "coupon", "coupon": map[string]any{"percent_off": 20.0, "duration": "repeating", "duration_in_months": 3}},
		"promotion_code": map[string]any{"id": "promo_1", "code": "LAUNCH20"}, "end": 1786000000}}
	e.stripe.mu.Unlock()
	code, body := e.do(owner, http.MethodPost, "/api/v1/billing/sync", nil)
	data, _ := body["data"].(map[string]any)
	d, _ := data["discount"].(map[string]any)
	if code != http.StatusOK || d["code"] != "LAUNCH20" || d["percent_off"] != 20.0 || d["amount_off"] != nil || d["duration"] != "repeating" ||
		d["duration_in_months"] != 3.0 || d["ends_at"] != "2026-08-06T07:06:40Z" {
		t.Fatalf("discount: %d %v", code, body)
	}
	_, body = e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	if data, _ := body["data"].(map[string]any); data["discount"] == nil || data["locked"] != false || data["plan"] != Basic {
		t.Fatalf("overview: %v", body)
	}
}

func TestPlanAmountYearly(t *testing.T) {
	for _, tt := range []struct {
		plan        string
		month, year int64
	}{
		{Basic, 1900, 18300},    // 182.40 rounds up to 183
		{Pro, 4900, 47100},      // 470.40 rounds up to 471
		{Business, 9900, 95100}, // 950.40 rounds up to 951
	} {
		if got := PlanAmount(tt.plan, "month"); got != tt.month {
			t.Errorf("%s monthly = %d, want %d", tt.plan, got, tt.month)
		}
		if got := PlanAmount(tt.plan, "year"); got != tt.year {
			t.Errorf("%s yearly = %d, want %d", tt.plan, got, tt.year)
		}
	}
}
