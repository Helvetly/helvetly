package billing

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

// Offer billing: per-person prices, seats, checkout settlement, trial, pro-rata allowances, downgrades and grace.

func (e *env) ownerID(ws string) string {
	e.t.Helper()
	var id string
	if err := e.raw.QueryRow(context.Background(), `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'owner'`, ws).Scan(&id); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) cap(ws string, l Limit) int64 {
	e.t.Helper()
	n, err := mustRights(e.t, e, ws).Cap(l)
	if err != nil {
		e.t.Fatal(err)
	}
	return n
}

// midMonth fixes the service's clock in the middle of the current UTC month (before the fake subscriptions end).
func (e *env) midMonth() time.Time {
	start, end := utcMonth(time.Now())
	at := start.Add(end.Sub(start) / 2)
	e.svc.now = func() time.Time { return at }
	return at
}

func TestPricesPerPersonInEveryCurrencyAndInterval(t *testing.T) {
	perPerson := map[string]map[string]int64{Basic: {"month": 1900, "year": 18300}, Pro: {"month": 4900, "year": 47100},
		Business: {"month": 9900, "year": 95100}}
	for plan, want := range perPerson {
		for interval, amount := range want {
			if got := PlanAmount(plan, interval); got != amount {
				t.Fatalf("%s %s per person: %d, want %d", plan, interval, got, amount)
			}
		}
	}
	// A year is rounded up per person before multiplying: two Basic people pay 2 × 183, not 2 × 182.40 rounded up.
	if 2*PlanAmount(Basic, "year") != 36600 {
		t.Fatalf("2 Basic yearly: %d", 2*PlanAmount(Basic, "year"))
	}
	for _, zone := range []struct{ tz, cur string }{{"Europe/Zurich", Currency}, {"Europe/Berlin", EUR}, {"America/New_York", USD}} {
		t.Run(zone.cur, func(t *testing.T) { checkoutPrices(t, zone.tz, zone.cur, perPerson) })
	}
}

// checkoutPrices checks Checkout's price, currency and quantity for 1, 2, 5 and 10 people in a workspace in tz.
func checkoutPrices(t *testing.T, tz, cur string, perPerson map[string]map[string]int64) {
	zone := struct{ tz, cur string }{tz, cur}
	{
		e := newEnv(t, true)
		e.stripe.setPerSeat()
		for _, people := range []int64{1, 2, 5, 10} {
			owner := e.workspaceIn(zone.tz)
			for range people - 1 {
				e.join(owner.workspace, "member")
			}
			for plan, want := range perPerson {
				for interval, amount := range want {
					code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": plan, "interval": interval})
					if errBody, _ := body["error"].(map[string]any); plan == Basic && people > 5 { // Basic's people limit
						if code != http.StatusConflict || errBody["code"] != "too_many_seats" {
							t.Fatalf("%s: %d × basic %s: %d %v", zone.cur, people, interval, code, body)
						}
						continue
					}
					f := e.stripe.form("POST /v1/checkout/sessions")
					id := f.Get("line_items[0][price]")
					unit, ok := e.stripe.catalog[LookupKey(plan, interval)]["currency_options"].(map[string]any)[zone.cur].(map[string]any)
					if zone.cur == Currency {
						unit, ok = map[string]any{"unit_amount": e.stripe.catalog[LookupKey(plan, interval)]["unit_amount"]}, true
					}
					// One price per plan and interval whatever the people (no cheaper extra seat), every person at full price.
					if code != http.StatusOK || id != priceIDs[LookupKey(plan, interval)] || f.Get("currency") != zone.cur ||
						f.Get("line_items[0][quantity]") != strconv.FormatInt(people, 10) || !ok || unit["unit_amount"].(int64)*people != amount*people {
						t.Fatalf("%s: %d × %s %s: %d %v %v", zone.cur, people, plan, interval, code, body, f)
					}
				}
			}
		}
	}
}

func TestPooledAllowancesForEveryPaidSeat(t *testing.T) {
	for _, tc := range []struct {
		plan, price               string
		seats, month              int64
		storage, tokens, cost, ai int64
		clients                   int64
	}{
		{Pro, "price_pm", 2, 9800, 10 * gb, 10_000_000, 6_000_000, 0, 300},
		{Business, "price_xm", 5, 49500, 100 * gb, 100_000_000, 60_000_000, 0, Unlimited},
	} {
		t.Run(tc.plan, func(t *testing.T) {
			e := newEnv(t, true)
			e.stripe.setPerSeat()
			owner := e.workspace()
			for range tc.seats - 1 {
				e.join(owner.workspace, "member")
			}
			e.subscribe(owner.workspace, tc.price) // the webhook syncs the quantity to every member
			if seatsOf(e, owner.workspace) != tc.seats || PlanAmount(tc.plan, "month")*tc.seats != tc.month {
				t.Fatalf("seats %d, %d a month", seatsOf(e, owner.workspace), PlanAmount(tc.plan, "month")*tc.seats)
			}
			for l, want := range map[Limit]int64{Storage: tc.storage, AITokens: tc.tokens, AICost: tc.cost, Clients: tc.clients} {
				if got := e.cap(owner.workspace, l); got != want {
					t.Errorf("%s: %d, want %d", l, got, want)
				}
			}
		})
	}
}

func TestGrantedProRata(t *testing.T) {
	start := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC) // 30 days
	at := func(days float64) time.Time { return start.Add(time.Duration(days * 24 * float64(time.Hour))) }
	rights := func(plan string, trial bool, tokens, cost int64) Rights {
		return Rights{Plan: plan, Trial: trial, Items: map[string]Entitlement{
			string(AITokens): {State: StateLimited, Value: tokens}, string(AICost): {State: StateLimited, Value: cost}}}
	}
	for _, tc := range []struct {
		name         string
		before       Rights
		earlier      map[string]int64
		after        Rights
		now          time.Time
		tokens, cost int64 // 0: nothing granted (nil)
	}{
		{"a new subscription mid-month", Rights{}, nil, rights(Pro, false, 5_000_000, 3_000_000), at(15), 2_500_000, 1_500_000},
		{"at the month's start: in full", Rights{}, nil, rights(Pro, false, 5_000_000, 3_000_000), start, 5_000_000, 3_000_000},
		{"a second seat with a quarter left", rights(Pro, false, 5_000_000, 3_000_000), nil, rights(Pro, false, 10_000_000, 6_000_000), at(22.5), 6_250_000, 3_750_000},
		{"a second seat after a mid-month start", rights(Pro, false, 5_000_000, 3_000_000), map[string]int64{string(AITokens): 2_500_000, string(AICost): 1_500_000},
			rights(Pro, false, 10_000_000, 6_000_000), at(22.5), 3_750_000, 2_250_000},
		{"a converted trial: no full month on top", rights(Business, true, 250_000, 200_000), nil, rights(Basic, false, 250_000, 200_000), at(15), 125_000, 100_000},
		{"no growth", rights(Pro, false, 5_000_000, 3_000_000), nil, rights(Basic, false, 250_000, 200_000), at(15), 0, 0},
		{"the same again", rights(Pro, false, 5_000_000, 3_000_000), map[string]int64{string(AITokens): 2_500_000}, rights(Pro, false, 5_000_000, 3_000_000), at(20), 0, 0},
	} {
		g := granted(tc.before, tc.earlier, tc.after, tc.now)
		if (g == nil) != (tc.tokens == 0) || g[string(AITokens)] != tc.tokens || g[string(AICost)] != tc.cost {
			t.Errorf("%s: %v", tc.name, g)
		}
	}
	if share(1<<62, 1, 3) != (1<<62)/3 {
		t.Fatal("share overflows")
	}
}

func TestNewSubscriptionMidMonthGetsCostlyAllowancesProRata(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	now := e.midMonth()
	e.stripe.put("sub_1", owner.workspace, "cus_1", "active", "price_pm")
	e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"})
	start, end := utcMonth(now)
	left, total := int64(end.Sub(now)/time.Second), int64(end.Sub(start)/time.Second)
	if got := e.cap(owner.workspace, AITokens); got != share(5_000_000, left, total) {
		t.Fatalf("AI tokens mid-month: %d", got)
	}
	if got := e.cap(owner.workspace, "emails_per_month"); got != share(500, left, total) {
		t.Fatalf("emails mid-month: %d", got)
	}
	if got := e.cap(owner.workspace, Invoices); got != 100 { // not a costly allowance: whole at once
		t.Fatalf("invoices: %d", got)
	}
	// A duplicate delivery grants nothing more; the next month is whole.
	e.event("evt_1b", "customer.subscription.updated", map[string]any{"id": "sub_1"})
	if got := e.cap(owner.workspace, AITokens); got != share(5_000_000, left, total) {
		t.Fatalf("after a second event: %d", got)
	}
	e.svc.now = func() time.Time { return end.Add(time.Hour) }
	if got := e.cap(owner.workspace, AITokens); got != 5_000_000 {
		t.Fatalf("next month: %d", got)
	}
}

func TestSeatsArePaidBeforeTheyCountAndReducedAtTheRenewal(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	ws := owner.workspace
	sub := "sub_" + ws
	e.subscribe(ws, "price_pm")
	path := "POST /v1/subscriptions/" + sub

	// A second person whose seat is not paid yet adds nothing to the pool.
	e.join(ws, "member")
	e.stripe.mu.Lock()
	e.stripe.declines = true
	e.stripe.mu.Unlock()
	e.svc.SyncSeats(ctx, ws)
	if f := e.stripe.form(path); f.Get("payment_behavior") != "pending_if_incomplete" || f.Get("proration_behavior") != "always_invoice" {
		t.Fatalf("seat form %v", f)
	}
	if seatsOf(e, ws) != 1 || e.cap(ws, Storage) != 5*gb {
		t.Fatalf("an unpaid seat counts: seats %d, storage %d", seatsOf(e, ws), e.cap(ws, Storage))
	}
	// While Stripe holds the change for its payment, nothing is asked again.
	e.stripe.set(sub, map[string]any{"pending_update": map[string]any{"expires_at": time.Now().Add(time.Hour).Unix()}})
	calls := e.stripe.called(path)
	if err := e.svc.SeatsTick(ctx); err != nil || e.stripe.called(path) != calls {
		t.Fatalf("asked again while pending: %v", err)
	}
	// Paid: the seat counts.
	e.stripe.set(sub, map[string]any{"pending_update": nil})
	e.stripe.mu.Lock()
	e.stripe.declines = false
	e.stripe.mu.Unlock()
	e.svc.SyncSeats(ctx, ws)
	if seatsOf(e, ws) != 2 || e.cap(ws, Storage) != 10*gb {
		t.Fatalf("a paid seat: seats %d, storage %d", seatsOf(e, ws), e.cap(ws, Storage))
	}

	// A person leaving: billed from the renewal, nothing credited, the seat stays paid until then.
	e.exec(`DELETE FROM workspace_members WHERE workspace_id = $1 AND role = 'member'`, ws)
	e.svc.SyncSeats(ctx, ws)
	if f := e.stripe.form(path); f.Get("proration_behavior") != "none" || f.Get("items[0][quantity]") != "1" || f.Has("payment_behavior") {
		t.Fatalf("reduction form %v", f)
	}
	if b := e.billing(ws); seatsOf(e, ws) != 1 || paidSeats(b) != 2 || e.cap(ws, Storage) != 10*gb {
		t.Fatalf("after a reduction: %+v, storage %d", b, e.cap(ws, Storage))
	}
	// Someone taking the paid seat is charged nothing.
	e.join(ws, "member")
	e.svc.SyncSeats(ctx, ws)
	if f := e.stripe.form(path); f.Get("proration_behavior") != "none" || f.Get("items[0][quantity]") != "2" || f.Has("payment_behavior") {
		t.Fatalf("replacement form %v", f)
	}
	// Reduced again, then renewed: one seat paid.
	e.exec(`DELETE FROM workspace_members WHERE workspace_id = $1 AND role = 'member'`, ws)
	e.svc.SyncSeats(ctx, ws)
	e.stripe.set(sub, map[string]any{"current_period_end": time.Now().Add(60 * 24 * time.Hour).Unix()})
	e.event("evt_renewal", "customer.subscription.updated", map[string]any{"id": sub})
	if b := e.billing(ws); paidSeats(b) != 1 || e.cap(ws, Storage) != 5*gb {
		t.Fatalf("after the renewal: %+v", b)
	}
}

func TestMembersUpToTheSelfServiceSeats(t *testing.T) {
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	e.subscribe(owner.workspace, "price_pm")
	if got, err := mustRights(t, e, owner.workspace).capFor(Members); err != nil || got != 24 {
		t.Fatalf("members besides the owner: %d %v", got, err)
	}
	e.setPlanValue(Pro, MaxSeats, StateLimited, n64(2))
	e.join(owner.workspace, "member")
	code, body := e.do(owner, http.MethodPost, "/api/v1/members/invitations", map[string]string{"email": "x@example.com"})
	if errBody, _ := body["error"].(map[string]any); code != http.StatusPaymentRequired || errBody["code"] != "limit_reached" {
		t.Fatalf("a third person on 2 seats: %d %v", code, body)
	}
}

func TestDowngradeAtThePeriodEndKeepsTheData(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_pm")
	e.setPlanValue(Basic, Clients, StateLimited, n64(1))
	for _, id := range []string{"c1", "c2"} {
		if err := e.st.CreateClient(ctx, ws, id, map[string]any{"name": id}, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Basic, "interval": "month"}); code != http.StatusOK {
		t.Fatalf("downgrade: %d %v", code, body)
	}
	if b := e.billing(ws); b.Plan != Pro || b.PendingPlan != Basic {
		t.Fatalf("scheduled: %+v", b)
	}
	if err := e.svc.AllowResource(ctx, e.st.Q, ws, string(Clients), 1); err != nil {
		t.Fatalf("Pro until the period's end: %v", err)
	}
	// The period ends: Stripe moves the subscription to Basic and releases the schedule.
	e.stripe.set("sub_"+ws, map[string]any{"items": items("price_bm", true, 1), "schedule": nil,
		"current_period_end": time.Now().Add(60 * 24 * time.Hour).Unix()})
	e.event("evt_phase", "customer.subscription.updated", map[string]any{"id": "sub_" + ws})
	b := e.billing(ws)
	if b.Plan != Basic || b.PendingPlan != "" {
		t.Fatalf("after the period: %+v", b)
	}
	var clients int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM clients WHERE workspace_id = $1 AND deleted_at IS NULL`, ws).Scan(&clients); err != nil || clients != 2 {
		t.Fatalf("clients kept: %d %v", clients, err)
	}
	if err := e.svc.AllowResource(ctx, e.st.Q, ws, string(Clients), 1); !errors.Is(err, store.ErrAdmissionDenied) {
		t.Fatalf("a new client beyond Basic: %v", err)
	}
}

func TestCheckoutIsSettledOnTheOfferItWasSoldOn(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	sold := e.currentOffer().ID
	if code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
		t.Fatalf("checkout: %d %v", code, body)
	}
	f := e.stripe.form("POST /v1/checkout/sessions")
	checkout, cur := f.Get("subscription_data[metadata][checkout_id]"), f.Get("currency")
	if checkout == "" || f.Get("subscription_data[metadata][offer_id]") != sold {
		t.Fatalf("checkout metadata %v", f)
	}
	// A newer offer goes on sale before the payment: the subscription keeps what it was sold.
	e.setPlanValue(Basic, Clients, StateLimited, n64(31))
	e.exec(`UPDATE workspace_billing SET offer_id = NULL WHERE workspace_id = $1`, owner.workspace)

	paid := func(id, ws, price, offer string) {
		e.stripe.put(id, ws, "cus_1", "active", price)
		e.stripe.set(id, map[string]any{"currency": cur, "metadata": map[string]string{"workspace_id": ws, "checkout_id": checkout, "offer_id": offer}})
	}
	// Tampered: another price than the checkout's is not recorded.
	paid("sub_bad", owner.workspace, "price_xm", sold)
	if code := e.event("evt_bad", "customer.subscription.created", map[string]any{"id": "sub_bad"}); code != http.StatusOK || e.billing(owner.workspace).Status != "" {
		t.Fatalf("tampered subscription: %d %+v", code, e.billing(owner.workspace))
	}
	paid("sub_ok", owner.workspace, "price_pm", sold)
	if code := e.event("evt_ok", "customer.subscription.created", map[string]any{"id": "sub_ok"}); code != http.StatusOK {
		t.Fatalf("event: %d", code)
	}
	offer, err := e.st.WorkspaceOffer(ctx, owner.workspace)
	if b := e.billing(owner.workspace); err != nil || b.Plan != Pro || offer != sold {
		t.Fatalf("settled: %+v on %s %v", b, offer, err)
	}
	// The same event again with another payload, and an older event arriving late, leave what Stripe says.
	if code := e.event("evt_ok", "customer.subscription.deleted", map[string]any{"id": "sub_bad"}); code != http.StatusOK {
		t.Fatalf("replay: %d", code)
	}
	if code := e.event("evt_older", "customer.subscription.created", map[string]any{"id": "sub_ok"}); code != http.StatusOK || e.billing(owner.workspace).Status != "active" {
		t.Fatalf("out of order: %d %+v", code, e.billing(owner.workspace))
	}
	// An operator moving the workspace later is not undone by another delivery of the settled checkout.
	e.setPlanValue(Basic, Clients, StateLimited, n64(32))
	newer := e.currentOffer().ID
	e.event("evt_ok_again", "customer.subscription.updated", map[string]any{"id": "sub_ok"})
	if offer, _ := e.st.WorkspaceOffer(ctx, owner.workspace); offer != newer {
		t.Fatalf("offer after a redelivery: %s", offer)
	}
	// Another workspace's subscription claiming the settled checkout is not recorded.
	other := e.workspace()
	paid("sub_copy", other.workspace, "price_pm", sold)
	e.stripe.set("sub_copy", map[string]any{"customer": "cus_other"})
	e.event("evt_copy", "customer.subscription.created", map[string]any{"id": "sub_copy"})
	if b := e.billing(other.workspace); b.Status != "" {
		t.Fatalf("a copied checkout: %+v", b)
	}
}

// trialing puts the workspace on a trialing Pro subscription started by its owner with card fp, as Checkout
// makes it, since start.
func (e *env) trialing(ws, fp string, start time.Time) string {
	e.t.Helper()
	id, customer := "sub_"+ws, e.billing(ws).CustomerID
	if customer == "" {
		customer = "cus_" + ws
	}
	e.stripe.put(id, ws, customer, "trialing", "price_pm")
	e.stripe.set(id, map[string]any{"trial_start": start.Unix(), "default_payment_method": map[string]any{"card": map[string]any{"fingerprint": fp}},
		"metadata": map[string]string{"workspace_id": ws, "trial_user": e.ownerID(ws)}})
	if code := e.event("evt_"+id, "customer.subscription.created", map[string]any{"id": id}); code != http.StatusOK {
		e.t.Fatalf("trial: %d", code)
	}
	return id
}

// TestTrialGivesTheFullLimitsOfPro: a trial has Pro's own limits (the offer has no trial overrides), for two people.
func TestTrialGivesTheFullLimitsOfPro(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.join(owner.workspace, "member")
	e.trialing(owner.workspace, "fp_1", time.Now().Add(-time.Hour))
	r := mustRights(t, e, owner.workspace)
	if !r.Trial || r.Plan != Pro || !r.Includes(Feature("expenses")) || !r.Includes(Feature("heidi")) {
		t.Fatalf("trial rights %+v", r)
	}
	for l, want := range map[Limit]int64{Clients: 300, Invoices: 100, Quotes: 100, Expenses: 300, Signatures: 50, Storage: 5_000_000_000,
		AITokens: 5_000_000, AICost: 3_000_000, "automation_actions_per_month": 1500, MaxSeats: 2} {
		if got := e.cap(owner.workspace, l); got != want { // two people, not pooled
			t.Errorf("%s: %d, want %d", l, got, want)
		}
	}
	code, body := e.do(owner, http.MethodPost, "/api/v1/members/invitations", map[string]string{"email": "x@example.com"})
	if errBody, _ := body["error"].(map[string]any); code != http.StatusPaymentRequired || errBody["code"] != "limit_reached" {
		t.Fatalf("a third person in the trial: %d %v", code, body)
	}
	_, body = e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	for _, it := range body["data"].(map[string]any)["entitlements"].([]any) {
		if it := it.(map[string]any); it["key"] == string(Invoices) && (it["reset_at"] != nil || it["source"] != "plan") {
			t.Fatalf("trial invoices %v", it)
		}
	}
}

func TestTrialAllowancesLastAcrossTheMonth(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	owner := e.workspace()
	now := time.Now().UTC()
	month := store.UsagePeriodStart(now)
	e.trialing(owner.workspace, "fp_1", month.Add(-48*time.Hour)) // began in the previous month
	e.exec(`INSERT INTO heidi_usage (workspace_id, period, tokens_used, cost_micros, updated_at) VALUES ($1, $2, 200000, 150000, now())`,
		owner.workspace, month.AddDate(0, 0, -1).Format("2006-01"))
	tokens, err := e.svc.AITokens(ctx, e.st.Q, owner.workspace)
	if err != nil || tokens != 4_800_000 {
		t.Fatalf("trial tokens left this month: %d %v", tokens, err)
	}
	cost, err := e.svc.AICost(ctx, e.st.Q, owner.workspace)
	if err != nil || cost != 2_850_000 {
		t.Fatalf("trial cost left this month: %d %v", cost, err)
	}
	_, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	for _, u := range body["data"].(map[string]any)["usage"].([]any) {
		if u := u.(map[string]any); u["limit"] == string(AITokens) && u["used"] != 200_000.0 {
			t.Fatalf("trial AI usage %v", u)
		}
	}
}

func TestTrialIsOncePerCustomer(t *testing.T) {
	e := newEnv(t, true)
	first := e.workspace()
	e.trialing(first.workspace, "fp_1", time.Now().Add(-time.Hour))
	var email string
	if err := e.raw.QueryRow(context.Background(), `SELECT email FROM users WHERE id = $1`, e.ownerID(first.workspace)).Scan(&email); err != nil {
		t.Fatal(err)
	}
	trialIn := func(b *browser) bool {
		t.Helper()
		_, body := e.do(b, http.MethodGet, "/api/v1/billing", nil)
		offered := body["data"].(map[string]any)["trial_available"] == true
		if code, _ := e.do(b, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
			t.Fatalf("checkout: %d", code)
		}
		if got := e.stripe.form("POST /v1/checkout/sessions").Get("subscription_data[trial_period_days]") == "7"; got != offered {
			t.Fatalf("overview says %v, checkout %v", offered, got)
		}
		return offered
	}
	// The same email with a +tag in a new workspace: no second trial.
	tagged := e.workspace()
	local, domain, _ := strings.Cut(email, "@")
	e.exec(`UPDATE users SET email = $2 WHERE id = $1`, e.ownerID(tagged.workspace), local+"+again@"+domain)
	if trialIn(tagged) {
		t.Fatal("a second trial for the same email")
	}
	// Three people are more than the trial's two.
	team := e.workspace()
	e.join(team.workspace, "member")
	e.join(team.workspace, "member")
	if trialIn(team) {
		t.Fatal("a trial for three people")
	}
	// Someone new with the same card: Checkout offers it, the webhook ends it at once.
	card := e.workspace()
	if !trialIn(card) {
		t.Fatal("no trial for a new customer")
	}
	id := e.trialing(card.workspace, "fp_1", time.Now().Add(-time.Hour))
	if f := e.stripe.form("POST /v1/subscriptions/" + id); f.Get("trial_end") != "now" {
		t.Fatalf("second trial not ended: %v", f)
	}
	if b := e.billing(card.workspace); b.Status != "active" || mustRights(t, e, card.workspace).Trial {
		t.Fatalf("after ending it: %+v", b)
	}
}

func TestTrialConvertsToBasicWithoutABonus(t *testing.T) {
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	e.join(owner.workspace, "member")
	now := e.midMonth()
	id := e.trialing(owner.workspace, "fp_1", now.Add(-time.Hour))
	e.exec(`INSERT INTO heidi_usage (workspace_id, period, tokens_used, updated_at) VALUES ($1, $2, 100000, now())`,
		owner.workspace, now.Format("2006-01"))
	// The trial ends into Basic for both people.
	e.stripe.set(id, map[string]any{"status": "active", "trial_end": nil, "items": items("price_bm", true, 2)})
	e.event("evt_converted", "customer.subscription.updated", map[string]any{"id": id})
	r := mustRights(t, e, owner.workspace)
	if r.Trial || r.Plan != Basic || r.Includes(Feature("expenses")) || r.Includes(Feature("heidi")) || seatsOf(e, owner.workspace) != 2 {
		t.Fatalf("after the trial: %+v", r)
	}
	// Basic has neither Heidi nor the AI import, so no AI tokens: none carry over from the trial either.
	if got := e.cap(owner.workspace, AITokens); got != 0 {
		t.Fatalf("AI tokens of the first month: %d, want 0", got)
	}
	_, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	for _, u := range body["data"].(map[string]any)["usage"].([]any) {
		if u := u.(map[string]any); u["limit"] == string(AITokens) && u["used"] != 100_000.0 { // the trial's use counts
			t.Fatalf("AI usage after the trial %v", u)
		}
	}
}

func TestTrialAICostStaysWithinTheDailyTrialBudget(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	owner := e.workspace()
	e.trialing(owner.workspace, "fp_1", time.Now().Add(-time.Hour))
	other := e.workspace()
	e.trialing(other.workspace, "fp_2", time.Now().Add(-time.Hour))
	spend := func(id string, micros int64) {
		e.exec(`INSERT INTO ai_calls (id, workspace_id, period, kind, operation, step, status, rate_card, model, tier, region,
				reserved_tokens, reserved_micros, cost_micros, created_at)
			VALUES ($1, $2, to_char(now(), 'YYYY-MM'), 'heidi', 'op', 'step', 'settled', 'card', 'm', 't', 'r', 0, $3, $3, now())`,
			id, other.workspace, micros)
	}
	spend("call_1", TrialAIDailyCap-100_000)
	if cost, err := e.svc.AICost(ctx, e.st.Q, owner.workspace); err != nil || cost != 100_000 {
		t.Fatalf("cost with USD 0.10 of the day's trial budget left: %d %v", cost, err)
	}
	spend("call_2", 200_000)
	if cost, err := e.svc.AICost(ctx, e.st.Q, owner.workspace); err != nil || cost != 0 {
		t.Fatalf("cost with the day's trial budget spent: %d %v", cost, err)
	}
}

func TestOverduePaymentFreezesModelCostWithinTheGrace(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_pm")
	e.stripe.set("sub_"+ws, map[string]any{"status": "past_due"})
	e.event("evt_due", "customer.subscription.updated", map[string]any{"id": "sub_" + ws})
	expires := e.billing(ws).PlanExpiresAt
	tokens, errT := e.svc.AITokens(ctx, e.st.Q, ws)
	cost, errC := e.svc.AICost(ctx, e.st.Q, ws)
	if errT != nil || errC != nil || tokens != 0 || cost != 0 {
		t.Fatalf("model while overdue: %d %d %v %v", tokens, cost, errT, errC)
	}
	if err := e.svc.AllowResource(ctx, e.st.Q, ws, string(Clients), 1); err != nil {
		t.Fatalf("other work within the grace: %v", err)
	}
	// Stripe delivering again, a day later, does not move the grace.
	e.svc.now = func() time.Time { return time.Now().UTC().Add(24 * time.Hour) }
	e.event("evt_due_again", "customer.subscription.updated", map[string]any{"id": "sub_" + ws})
	if b := e.billing(ws); b.PlanExpiresAt == nil || expires == nil || !b.PlanExpiresAt.Equal(*expires) {
		t.Fatalf("grace moved: %v → %v", expires, b.PlanExpiresAt)
	}
}
