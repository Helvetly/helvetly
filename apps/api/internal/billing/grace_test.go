package billing

import (
	"context"
	"net/http"
	"testing"
	"time"
)

// set changes fields of a fake subscription, as Stripe would have it now.
func (f *fakeStripe) set(id string, fields map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for k, v := range fields {
		f.subs[id][k] = v
	}
}

// startedAt moves a fake subscription's current period to have begun at t.
func (f *fakeStripe) startedAt(id string, t time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.subs[id]["items"].(map[string]any)["data"].([]map[string]any)[0]["current_period_start"] = t.Unix()
}

func TestPlanChangeWaitsForThePaymentOfWhatIsChargedNow(t *testing.T) {
	for _, tc := range []struct {
		name, status, from, plan, interval string
		how                                string // pays: charged now, granted once paid; scheduled: at the period's end; trial: for after it
	}{
		{"upgrade", "active", "price_bm", Pro, "month", "pays"},
		{"monthly to yearly, same plan", "active", "price_pm", Pro, "year", "pays"},
		{"monthly to yearly, lower plan", "active", "price_pm", Basic, "year", "scheduled"},
		{"downgrade", "active", "price_pm", Basic, "month", "scheduled"},
		{"yearly to monthly", "active", "price_py", Pro, "month", "scheduled"},
		{"past due: an upgrade waits for its payment", "past_due", "price_bm", Pro, "month", "pays"},
		{"trial: another plan for after it", "trialing", "price_xm", Basic, "month", "trial"},
		{"trial: another interval", "trialing", "price_xm", Business, "year", "trial"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t, true)
			owner := e.workspace()
			ws := owner.workspace
			e.stripe.put("sub_1", ws, "cus_1", tc.status, tc.from)
			e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"})
			before := e.billing(ws)
			code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": tc.plan, "interval": tc.interval})
			if code != http.StatusOK {
				t.Fatalf("change: %d %v", code, body)
			}
			f, b := e.stripe.form("POST /v1/subscriptions/sub_1"), e.billing(ws)
			switch tc.how {
			case "pays":
				if f.Get("proration_behavior") != "always_invoice" || f.Get("payment_behavior") != "pending_if_incomplete" ||
					f.Has("metadata[plan]") || b.Plan != tc.plan || b.Interval != tc.interval {
					t.Fatalf("update form %v, billing %+v", f, b)
				}
			case "scheduled":
				sf := e.stripe.form("POST /v1/subscription_schedules/sub_sched_sub_1")
				if e.stripe.called("POST /v1/subscriptions/sub_1") != 0 || sf.Get("phases[1][items][0][price]") != priceIDs[LookupKey(tc.plan, tc.interval)] ||
					b.Plan != before.Plan || b.Interval != before.Interval || b.PendingPlan != tc.plan || b.PendingInterval != tc.interval {
					t.Fatalf("schedule form %v, billing %+v", sf, b)
				}
			case "trial":
				if f.Get("proration_behavior") != "none" || f.Has("payment_behavior") || f.Has("trial_end") ||
					b.Plan != tc.plan || b.Interval != tc.interval || b.Status != "trialing" {
					t.Fatalf("update form %v, billing %+v", f, b)
				}
			}
		})
	}
}

func TestDeclinedUpgradeAnswers402WithAPayLink(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.stripe.put("sub_1", ws, "cus_1", "active", "price_bm")
	e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"})
	e.stripe.declines = true
	code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"})
	errBody, _ := body["error"].(map[string]any)
	details, _ := errBody["details"].(map[string]any)
	if code != http.StatusPaymentRequired || errBody["code"] != "payment_failed" || details["reason"] != PaymentInsufficientFunds ||
		details["pay_url"] != "https://invoice.stripe.com/i/pending" || details["plan"] != Pro || details["decline_code"] != "insufficient_funds" ||
		details["expires_at"] == nil {
		t.Fatalf("declined upgrade: %d %v", code, body)
	}
	if b := e.billing(ws); b.Plan != Basic {
		t.Fatalf("an unpaid upgrade changed the plan: %+v", b)
	}

	// The dashboard asks again later; only an owner or admin may.
	e.stripe.set("sub_1", map[string]any{"pending_update": map[string]any{"expires_at": time.Now().Add(time.Hour).Unix(),
		"subscription_items": []map[string]any{{"price": map[string]any{"id": "price_pm", "lookup_key": "helvetly_pro_month"}}}},
		"latest_invoice": "in_pending"})
	e.stripe.invoices["in_pending"] = map[string]any{"id": "in_pending", "status": "open", "hosted_invoice_url": "https://invoice.stripe.com/i/pending"}
	code, body = e.do(owner, http.MethodGet, "/api/v1/billing/pending-payment", nil)
	data, _ := body["data"].(map[string]any)
	if code != http.StatusOK || data["pending"] != true || data["plan"] != Pro || data["pay_url"] != "https://invoice.stripe.com/i/pending" {
		t.Fatalf("pending payment: %d %v", code, body)
	}
	if code, _ := e.do(e.join(ws, "member"), http.MethodGet, "/api/v1/billing/pending-payment", nil); code != http.StatusForbidden {
		t.Fatalf("a member read the pending payment: %d", code)
	}
	e.stripe.set("sub_1", map[string]any{"pending_update": nil})
	if code, body := e.do(owner, http.MethodGet, "/api/v1/billing/pending-payment", nil); code != http.StatusOK || body["data"].(map[string]any)["pending"] != false {
		t.Fatalf("nothing pending: %d %v", code, body)
	}
}

func TestPaymentReasonAndStripeURL(t *testing.T) {
	for _, tc := range []struct{ status, code, decline, want string }{
		{"succeeded", "", "", PaymentProcessing},
		{"requires_action", "", "", PaymentAuthRequired},
		{"requires_payment_method", "card_declined", "insufficient_funds", PaymentInsufficientFunds},
		{"requires_payment_method", "expired_card", "", PaymentExpiredCard},
		{"requires_payment_method", "incorrect_cvc", "", PaymentIncorrectDetails},
		{"requires_payment_method", "card_declined", "generic_decline", PaymentDeclined},
		{"canceled", "", "", PaymentUnknown},
	} {
		if got := paymentReason(tc.status, tc.code, tc.decline); got != tc.want {
			t.Errorf("paymentReason(%q, %q, %q) = %q, want %q", tc.status, tc.code, tc.decline, got, tc.want)
		}
	}
	for raw, want := range map[string]bool{"https://invoice.stripe.com/i/1": true, "https://stripe.com/x": true,
		"http://invoice.stripe.com/i/1": false, "https://stripe.com.evil.test/": false, "https://evilstripe.com/": false} {
		if safeStripeURL(raw) != want {
			t.Errorf("safeStripeURL(%q) = %v", raw, !want)
		}
	}
}

func TestPlanExpiry(t *testing.T) {
	now := time.Unix(1_800_000_000, 0).UTC()
	start, end := now.Add(-24*time.Hour), now.Add(29*24*time.Hour)
	sub := func(status string, invoice string) subscription {
		var s subscription
		s.Status, s.CurrentPeriodEnd = status, end.Unix()
		s.Items.Data = make([]struct {
			ID                 string `json:"id"`
			CurrentPeriodStart int64  `json:"current_period_start"`
			CurrentPeriodEnd   int64  `json:"current_period_end"`
			Price              price  `json:"price"`
			Quantity           int64  `json:"quantity"`
		}, 1)
		s.Items.Data[0].CurrentPeriodStart = start.Unix()
		if invoice != "" {
			s.LatestInvoice = []byte(invoice)
		}
		return s
	}
	trial := sub("trialing", "")
	trialEnd := now.Add(5 * 24 * time.Hour).Unix()
	trial.TrialEnd = &trialEnd
	earlier := now.Add(-time.Hour)
	later := now.Add(10 * 24 * time.Hour)
	renewal := `{"status":"open","billing_reason":"subscription_cycle"}`
	extra := `{"status":"open","billing_reason":"subscription_update"}`
	for _, tc := range []struct {
		name string
		sub  subscription
		prev *time.Time
		want time.Time
	}{
		{"active: the period's end and the grace", sub("active", ""), nil, end.Add(billingGrace)},
		{"trialing: the trial's end and the grace", trial, nil, time.Unix(trialEnd, 0).Add(billingGrace)},
		{"past due, renewal open: the period's start and the grace", sub("past_due", renewal), &later, start.Add(billingGrace)},
		{"past due, renewal open, an earlier end stays", sub("past_due", renewal), &earlier, earlier},
		{"past due, an unpaid extra keeps the paid end", sub("past_due", extra), &later, later},
		{"past due, nothing recorded: the period's end", sub("past_due", extra), nil, end.Add(billingGrace)},
		{"canceled: now", sub("canceled", ""), &later, now},
		{"unpaid: an earlier end stays", sub("unpaid", ""), &earlier, earlier},
		{"incomplete: now", sub("incomplete", ""), nil, now},
	} {
		if got := planExpiry(tc.sub, tc.prev, now); got == nil || !got.Equal(tc.want) {
			t.Errorf("%s: %v, want %v", tc.name, got, tc.want)
		}
	}
}

// A renewal that stays unpaid keeps the plan for the grace from the period's start, then the workspace is read-only
// (reads and billing still work); paying unlocks it.
func TestUnpaidRenewalLocksAfterTheGrace(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_pm")
	sub := "sub_" + ws

	renewal := map[string]any{"id": "in_r", "status": "open", "billing_reason": "subscription_cycle"}
	e.stripe.set(sub, map[string]any{"status": "past_due", "latest_invoice": renewal})
	e.stripe.startedAt(sub, time.Now().Add(-24*time.Hour))
	e.event("evt_fail_1", "customer.subscription.updated", map[string]any{"id": sub})
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/clients", map[string]any{}); code != http.StatusCreated {
		t.Fatalf("in the grace: %d", code)
	}

	e.stripe.startedAt(sub, time.Now().Add(-4*24*time.Hour))
	e.event("evt_fail_2", "customer.subscription.updated", map[string]any{"id": sub})
	code, body := e.do(owner, http.MethodPost, "/api/v1/clients", map[string]any{})
	errBody, _ := body["error"].(map[string]any)
	details, _ := errBody["details"].(map[string]any)
	if code != http.StatusPaymentRequired || errBody["code"] != "plan_required" || details["reason"] != "payment_overdue" {
		t.Fatalf("after the grace: %d %v", code, body)
	}
	if code, _ := e.do(owner, http.MethodGet, "/api/v1/clients", nil); code != http.StatusOK {
		t.Fatalf("a read after the grace: %d", code)
	}
	code, body = e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	data, _ := body["data"].(map[string]any)
	if code != http.StatusOK || data["locked"] != true || data["payment_overdue"] != true || data["plan"] != "" {
		t.Fatalf("overview: %d %v", code, data)
	}

	// Paid: Stripe says active again, the period's end moves the plan on.
	e.stripe.set(sub, map[string]any{"status": "active", "latest_invoice": map[string]any{"id": "in_r", "status": "paid", "billing_reason": "subscription_cycle"}})
	e.event("evt_paid", "customer.subscription.updated", map[string]any{"id": sub})
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/clients", map[string]any{}); code != http.StatusCreated {
		t.Fatalf("after paying: %d", code)
	}
}

// The hourly job reads a lapsed subscription again: one renewed at Stripe whose event was lost opens again.
func TestLapsedTickReadsTheSubscriptionAgain(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	e.subscribe(ws, "price_pm")
	e.exec(`UPDATE workspace_billing SET plan_expires_at = now() - interval '1 hour' WHERE workspace_id = $1`, ws)
	if PlanOf(e.billing(ws), time.Now()) != "" {
		t.Fatal("an expired plan still works")
	}
	if err := e.svc.LapsedTick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if b := e.billing(ws); PlanOf(b, time.Now()) != Pro || b.PlanExpiresAt.Unix() != time.Unix(periodEnd, 0).Add(billingGrace).Unix() {
		t.Fatalf("after the job: %+v", b)
	}
}

func TestOpenInvoicesAreVoidedWhenStripeCancelsForNonPayment(t *testing.T) {
	e := newEnv(t, true)
	ws := e.workspace().workspace
	e.subscribe(ws, "price_pm")
	sub := "sub_" + ws
	e.stripe.invoices["in_open"] = map[string]any{"id": "in_open", "subscription": sub, "status": "open"}
	e.stripe.invoices["in_paid"] = map[string]any{"id": "in_paid", "subscription": sub, "status": "paid"}

	// Cancelled by the customer: the invoices stay.
	e.stripe.set(sub, map[string]any{"status": "canceled", "cancellation_details": map[string]any{"reason": "cancellation_requested"}})
	e.event("evt_cancel", "customer.subscription.deleted", map[string]any{"id": sub})
	if len(e.stripe.voided) != 0 {
		t.Fatalf("voided after a requested cancellation: %v", e.stripe.voided)
	}
	e.stripe.set(sub, map[string]any{"cancellation_details": map[string]any{"reason": "payment_failed"}})
	e.event("evt_failed", "customer.subscription.deleted", map[string]any{"id": sub})
	if len(e.stripe.voided) != 1 || e.stripe.voided[0] != "in_open" || PlanOf(e.billing(ws), time.Now()) != "" {
		t.Fatalf("voided %v, billing %+v", e.stripe.voided, e.billing(ws))
	}
}

// While the endpoint's API version is switched, Stripe delivers each event to the old and the new endpoint, each
// signed with its own secret and with the same event id: both verify, the second delivery changes nothing.
func TestWebhookTakesEitherSecretAndAppliesAnEventOnce(t *testing.T) {
	e := newEnv(t, true)
	e.svc.cfg.WebhookSecret = whsec + ", whsec_old"
	ws := e.workspace().workspace
	e.stripe.put("sub_1", ws, "cus_1", "active", "price_bm")
	if code := e.eventSigned("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"}, "whsec_old"); code != http.StatusOK {
		t.Fatalf("old endpoint: %d", code)
	}
	e.stripe.put("sub_1", ws, "cus_1", "active", "price_pm")
	if code := e.eventSigned("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"}, whsec); code != http.StatusOK {
		t.Fatalf("new endpoint: %d", code)
	}
	if b := e.billing(ws); b.Plan != Basic {
		t.Fatalf("the second delivery was applied: %+v", b)
	}
	if code := e.eventSigned("evt_2", "customer.subscription.created", map[string]any{"id": "sub_1"}, "whsec_other"); code != http.StatusBadRequest {
		t.Fatalf("an unknown secret: %d", code)
	}
}

// A Checkout Session is read again from Stripe: an event whose payload carries only the id (or fields an older API
// version shaped otherwise) credits what Stripe has.
func TestCheckoutSessionIsReadAgainFromStripe(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_pm")
	if err := e.st.SetStripeCustomer(context.Background(), ws, "cus_"+ws, time.Now()); err != nil {
		t.Fatal(err)
	}
	e.stripe.session(map[string]any{"id": "cs_pack", "mode": "payment", "customer": "cus_" + ws, "payment_status": "paid",
		"metadata": map[string]string{"workspace_id": ws, AITokensKey: "1000000"}})
	if code := e.eventSigned("evt_pack", "checkout.session.completed", map[string]any{"id": "cs_pack"}, whsec); code != http.StatusOK {
		t.Fatalf("event: %d", code)
	}
	n, err := e.st.AITokenPacks(context.Background(), ws, time.Now().UTC().Format("2006-01"))
	if err != nil || n != 1_000_000 {
		t.Fatalf("packs %d, %v", n, err)
	}
}
