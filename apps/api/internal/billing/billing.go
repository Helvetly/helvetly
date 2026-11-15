package billing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/members"
	"helvetly.com/api/internal/store"
)

// Auth is what the handlers use of internal/auth: the session, and its error and JSON conventions.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

type Service struct {
	db        *store.Store
	auth      Auth
	cfg       config.Stripe
	enabled   bool
	publicURL string
	stripe    *StripeClient
	plans     planLimits
	log       *slog.Logger
	now       func() time.Time

	pricesMu sync.Mutex
	prices   map[string]price // by plan_interval key, read from Stripe by lookup key
	pricedAt time.Time

	packsMu  sync.Mutex
	packs    []aiPack // the AI token packs on sale, read from Stripe
	packedAt time.Time

	customerCurrency sync.Map // Stripe customer id -> the currency Stripe fixed for it
}

// New reads the plan limits seeded in plan_limits; the server does not start without them.
func New(ctx context.Context, db *store.Store, a Auth, cfg config.Config, log *slog.Logger) (*Service, error) {
	plans, err := loadPlanLimits(ctx, db)
	if err != nil {
		return nil, err
	}
	return &Service{db: db, auth: a, cfg: cfg.Stripe, enabled: cfg.BillingEnabled(), publicURL: cfg.PublicURL, log: log,
		plans:  plans,
		now:    func() time.Time { return time.Now().UTC() },
		stripe: NewStripeClient(cfg.Stripe.SecretKey, cfg.Stripe.APIBase)}, nil
}

type handler func(http.ResponseWriter, *http.Request, store.Session) error

func (s *Service) Register(mux *http.ServeMux) {
	handle := func(pattern string, manage bool, h handler) {
		mux.HandleFunc(pattern, s.auth.SignedIn(func(w http.ResponseWriter, r *http.Request, sess store.Session) {
			err := errDisabled
			switch {
			case manage && !members.CanManage(sess.Role):
				err = errForbidden
			case s.enabled || pattern == "GET /api/v1/billing":
				err = h(w, r, sess)
			}
			if err != nil {
				s.writeError(w, r, err)
			}
		}))
	}
	handle("GET /api/v1/billing", false, s.overview)
	handle("GET /api/v1/billing/details", true, s.details)
	handle("POST /api/v1/billing/promotion-code", true, s.promotionCode)
	handle("POST /api/v1/billing/checkout", true, s.checkout)
	handle("POST /api/v1/billing/ai-tokens", true, s.buyAITokens)
	handle("POST /api/v1/billing/portal", true, s.portal)
	handle("POST /api/v1/billing/sync", true, s.sync)
	mux.HandleFunc("POST /api/webhooks/stripe", s.webhook)
}

var (
	errDisabled   = auth.Error(http.StatusServiceUnavailable, "billing_disabled", "Billing is not set up on this server.", nil)
	errForbidden  = auth.Error(http.StatusForbidden, "forbidden", "Only an owner or admin can manage billing.", nil)
	errNoCustomer = auth.Error(http.StatusConflict, "no_customer",
		"This workspace has no billing account yet: choose a plan first.", nil)
	errPlanRequired = auth.Error(http.StatusPaymentRequired, "plan_required",
		"This workspace has no active plan. Choose a plan to keep working.", map[string]any{})
	errUnavailable = auth.Error(http.StatusConflict, "plan_unavailable", "This plan is not available right now: try again later.", nil)
	errBadCode     = badCode("invalid", "This code isn't valid.")
	errDiscounted  = badCode("has_discount", "This workspace already has a discount; another code can be added once it ends.")
)

// badCode refuses a promotion code; reason is invalid, currency, plan or has_discount, message what the person reads.
func badCode(reason, message string) error {
	return auth.Error(http.StatusUnprocessableEntity, "promotion_code_invalid", message,
		map[string]any{"fields": map[string]string{"code": "invalid"}, "reason": reason})
}

// writeError answers a refused Stripe call with 502 and logs it; everything else goes to auth.
func (s *Service) writeError(w http.ResponseWriter, r *http.Request, err error) {
	var se *StripeError
	if errors.As(err, &se) {
		s.log.ErrorContext(r.Context(), "stripe refused a call", "path", r.URL.Path, "error", err)
		err = auth.Error(http.StatusBadGateway, "payment_provider_error", "Stripe could not complete this: try again.",
			map[string]any{"provider_code": se.Code, "provider_param": se.Param})
	}
	s.auth.WriteError(w, r, err)
}

// ---- overview ----

type usageItem struct {
	Limit Limit  `json:"limit"`
	Used  int64  `json:"used"`
	Max   *int64 `json:"max"` // null: unlimited
}

type planPrice struct {
	Amount   int64  `json:"amount"` // minor units, VAT included
	Currency string `json:"currency"`
}

type planItem struct {
	ID     string                `json:"id"`
	Name   string                `json:"name"`
	Limits map[Limit]*int64      `json:"limits"` // null: unlimited
	Prices map[string]*planPrice `json:"prices"` // month, year; null when Stripe could not be read
}

func maxOf(v int64) *int64 {
	if v == Unlimited {
		return nil
	}
	return &v
}

func (s *Service) overview(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	b, err := s.db.WorkspaceBilling(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	now := s.now()
	u, err := s.db.WorkspaceUsage(r.Context(), sess.Workspace.ID, monthStart(now, sess.Workspace.Location()), now)
	if err != nil {
		return err
	}
	plan := PlanOf(b)
	bought, err := s.db.AITokenPacks(r.Context(), sess.Workspace.ID, now.In(sess.Workspace.Location()).Format("2006-01"))
	if err != nil {
		return err
	}
	disputed, err := s.db.Disputed(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	usage := make([]usageItem, 0, len(limitOrder))
	for _, l := range limitOrder {
		max := s.plans.forBilling(b, l)
		if l == AITokens && max != Unlimited && plan != "" {
			max += bought // the packs bought this month count on top of the plan's allowance
		}
		usage = append(usage, usageItem{l, used(u, l), maxOf(max)})
	}
	prices := s.planPrices(r.Context())
	cur, err := s.requestCurrency(r, sess, b.CustomerID)
	if err != nil {
		s.log.WarnContext(r.Context(), "reading the Stripe customer's currency failed", "error", err)
		cur = CurrencyOf(auth.Country(r), sess.Workspace.Timezone, pageZone(r))
	}
	list := make([]planItem, 0, len(planOrder))
	for _, id := range planOrder {
		p := planItem{ID: id, Name: planNames[id], Limits: map[Limit]*int64{}, Prices: map[string]*planPrice{}}
		for _, l := range limitOrder {
			p.Limits[l] = maxOf(s.plans.of(id, l))
		}
		if prices[id+"_month"].perSeat() { // what a new subscription or a plan change gets
			p.Limits[Members] = nil
		}
		for _, interval := range []string{"month", "year"} {
			if amount, ok := prices[id+"_"+interval].amountIn(cur); ok {
				p.Prices[interval] = &planPrice{amount, cur}
			} else {
				p.Prices[interval] = nil
			}
		}
		list = append(list, p)
	}
	out := map[string]any{
		"enabled": s.enabled, "locked": s.enabled && plan == "", "plan": plan, "status": b.Status, "interval": b.Interval,
		"current_period_end": b.CurrentPeriodEnd, "cancel_at_period_end": b.CancelAtPeriodEnd, "trial_end": b.TrialEnd,
		"trial_days": TrialDays, "trial_plan": TrialPlan, "trial_available": trialAvailable(b), "has_customer": b.CustomerID != "",
		"can_manage": members.CanManage(sess.Role), "period_start": monthStart(now, sess.Workspace.Location()).Format(time.DateOnly),
		"usage": usage, "plans": list, "currency": cur, "discount": nil, "pricing": "", "seats": u.Members + 1,
		"ai_tokens_bought": bought, "ai_packs": []aiPack{}, "disputed": disputed,
	}
	if plan != "" && members.CanManage(sess.Role) { // packs add to a plan; only a manager can buy
		out["ai_packs"] = packsIn(s.aiPacks(r.Context()), cur)
	}
	if !live(b.Status) {
		out["interval"] = ""
	} else {
		out["pricing"] = "flat"
		if b.PerSeat {
			out["pricing"] = PerSeat
		}
		if len(b.Discount) > 0 {
			out["discount"] = b.Discount
		}
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out})
	return nil
}

// planPrices reads the plans' prices from Stripe by lookup key, cached for ten minutes; a failure leaves them out.
func (s *Service) planPrices(ctx context.Context) map[string]price {
	if !s.enabled {
		return nil
	}
	s.pricesMu.Lock()
	defer s.pricesMu.Unlock()
	if s.prices != nil && s.now().Sub(s.pricedAt) < 10*time.Minute {
		return s.prices
	}
	form := url.Values{"active": {"true"}, "limit": {"100"}, "expand[]": {"data.currency_options"}}
	for _, plan := range planOrder {
		for _, interval := range intervals {
			form.Add("lookup_keys[]", LookupKey(plan, interval))
		}
	}
	var found list[price]
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/prices", form, "", &found); err != nil {
		s.log.WarnContext(ctx, "reading the Stripe prices failed", "error", err)
		return map[string]price{} // not cached: the next read tries again
	}
	out := map[string]price{}
	for _, p := range found.Data {
		if plan, interval := planOfKey(p.LookupKey); plan != "" {
			out[plan+"_"+interval] = p
		}
	}
	s.prices, s.pricedAt = out, s.now()
	return out
}

var intervals = []string{"month", "year"}

// ---- promotion codes ----

// Promotion is what a promotion code takes off and the plans it is good for (nil: every plan).
type Promotion struct {
	Code             string     `json:"code"`
	PercentOff       *float64   `json:"percent_off"`
	AmountOff        *int64     `json:"amount_off"`
	Currency         *string    `json:"currency"`
	Duration         string     `json:"duration"`
	DurationInMonths *int       `json:"duration_in_months"`
	Plans            []string   `json:"plans"`
	ExpiresAt        *time.Time `json:"expires_at"`
}

// promotionFor finds a usable promotion code as typed (upper-cased: the CLI makes them so) for a workspace paying
// in cur, and the plans it fits. An amount off is given in cur: a code without an amount in cur is refused.
func (s *Service) promotionFor(ctx context.Context, code, cur string) (id string, p Promotion, err error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" || len(code) > 100 {
		return "", p, errBadCode
	}
	var found list[promotionCode]
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/promotion_codes", url.Values{"code": {code}, "active": {"true"}, "limit": {"1"}}, "", &found); err != nil {
		return "", p, err
	}
	// Stripe matches codes case-insensitively; only the code as made is taken.
	if len(found.Data) == 0 || found.Data[0].Code != code || found.Data[0].Promotion.Coupon == "" {
		return "", p, errBadCode
	}
	pc := found.Data[0]
	exhausted := pc.MaxRedemptions > 0 && pc.TimesRedeemed >= pc.MaxRedemptions
	expired := pc.ExpiresAt != nil && !time.Unix(*pc.ExpiresAt, 0).After(s.now())
	if !pc.Active || exhausted || expired {
		return "", p, errBadCode
	}
	var coupon stripeCoupon
	form := url.Values{"expand[]": {"applies_to", "currency_options"}}
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/coupons/"+url.PathEscape(pc.Promotion.Coupon), form, "", &coupon); err != nil {
		return "", p, err
	}
	if coupon.Valid != nil && !*coupon.Valid {
		return "", p, errBadCode
	}
	amount, ok := coupon.amountIn(cur)
	if !ok {
		other := "another currency"
		if coupon.Currency != nil {
			other = strings.ToUpper(*coupon.Currency)
		}
		return "", p, badCode("currency", "This code is for payments in "+other+".")
	}
	p = Promotion{Code: code, PercentOff: coupon.PercentOff, Duration: coupon.Duration, DurationInMonths: coupon.DurationInMonths}
	if amount > 0 {
		p.AmountOff, p.Currency = &amount, &cur
	}
	if pc.ExpiresAt != nil {
		t := time.Unix(*pc.ExpiresAt, 0).UTC()
		p.ExpiresAt = &t
	}
	if coupon.AppliesTo != nil && len(coupon.AppliesTo.Products) > 0 {
		prices := s.planPrices(ctx)
		p.Plans = []string{}
		for _, plan := range planOrder {
			for _, interval := range intervals {
				if slices.Contains(coupon.AppliesTo.Products, prices[plan+"_"+interval].Product) && !slices.Contains(p.Plans, plan) {
					p.Plans = append(p.Plans, plan)
				}
			}
		}
		if len(p.Plans) == 0 {
			return "", p, badCode("plan", "This code doesn't apply to any plan.")
		}
	}
	return pc.ID, p, nil
}

// errPlanCode refuses a code limited to other plans than plan.
func errPlanCode(plan string) error {
	return badCode("plan", "This code doesn't apply to the "+planNames[plan]+" plan.")
}

func (s *Service) promotionCode(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in struct {
		Code string `json:"code"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	ctx := r.Context()
	b, err := s.db.WorkspaceBilling(ctx, sess.Workspace.ID)
	if err != nil {
		return err
	}
	// One discount at a time: Stripe drops it from the subscription when it ends; until then no other code is taken.
	if live(b.Status) && b.SubscriptionID != "" {
		sub, err := s.getSubscription(ctx, b.SubscriptionID)
		if err != nil {
			return err
		}
		if len(sub.Discounts) > 0 {
			return errDiscounted
		}
	}
	cur, err := s.requestCurrency(r, sess, b.CustomerID)
	if err != nil {
		return err
	}
	_, p, err := s.promotionFor(ctx, in.Code, cur)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": p})
	return nil
}

// ---- checkout and plan changes ----

func (s *Service) checkout(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in struct {
		Plan          string `json:"plan"`
		Interval      string `json:"interval"`
		PromotionCode string `json:"promotion_code"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if planNames[in.Plan] == "" || !slices.Contains(intervals, in.Interval) {
		return auth.Error(http.StatusBadRequest, "invalid_request", "Choose the Basic, Pro or Business plan, monthly or yearly.",
			map[string]any{"fields": map[string]string{"plan": "invalid"}})
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	target := s.planPrices(ctx)[in.Plan+"_"+in.Interval]
	if target.ID == "" {
		return errUnavailable
	}
	// The customer's currency is fixed by Stripe once set, so it is read before the lock.
	before, err := s.db.WorkspaceBilling(ctx, ws)
	if err != nil {
		return err
	}
	cur, err := s.requestCurrency(r, sess, before.CustomerID)
	if err != nil {
		return err
	}
	if _, ok := target.amountIn(cur); !ok {
		return errUnavailable // a price is sold only in the currencies it carries
	}
	var promoID string
	if strings.TrimSpace(in.PromotionCode) != "" {
		id, p, err := s.promotionFor(ctx, in.PromotionCode, cur)
		if err != nil {
			return err
		}
		if p.Plans != nil && !slices.Contains(p.Plans, in.Plan) {
			return errPlanCode(in.Plan)
		}
		promoID = id
	}
	var next string
	var checkout *store.Billing
	var seats int64
	var known bool // the customer existed before this checkout
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockBilling(ctx, ws); err != nil {
			return err
		}
		b, err := q.WorkspaceBilling(ctx, ws)
		if err != nil {
			return err
		}
		if live(b.Status) && b.SubscriptionID != "" {
			next, err = s.changePlan(ctx, q, sess.Workspace, b, in.Plan, in.Interval, target, promoID)
			return err
		}
		if err := s.fits(ctx, q, sess.Workspace, in.Plan, target.perSeat()); err != nil {
			return err
		}
		if seats, err = quantity(ctx, q, ws, target); err != nil {
			return err
		}
		known = b.CustomerID != ""
		if !known {
			if b.CustomerID, err = s.createCustomer(ctx, q, sess); err != nil {
				return err
			}
		}
		checkout = &b
		return nil
	})
	if err != nil {
		return err
	}
	// a Checkout session writes nothing of ours, so Stripe is called after the lock is released
	if checkout != nil {
		if known {
			// Another tab's open Checkout could be paid too: one plan Checkout at a time (best effort).
			if err := s.expireOpenCheckouts(ctx, checkout.CustomerID); err != nil {
				s.log.WarnContext(ctx, "expiring open Checkout sessions failed", "workspace", ws, "error", err)
			}
		}
		if next, err = s.checkoutSession(ctx, *checkout, ws, in.Plan, in.Interval, target.ID, cur, seats, promoID); err != nil {
			return err
		}
	}
	auth.WriteJSON(w, http.StatusOK, map[string]string{"url": next})
	return nil
}

func (s *Service) createCustomer(ctx context.Context, q store.Q, sess store.Session) (string, error) {
	var c struct {
		ID string `json:"id"`
	}
	form := url.Values{"email": {sess.User.Email}, "name": {sess.Workspace.Name},
		"description": {"Helvetly workspace " + sess.Workspace.Name}, "metadata[workspace_id]": {sess.Workspace.ID}}
	// The key makes a retried request return the same customer instead of a second one; it covers the parameters, as
	// Stripe refuses a key reused with others (a renamed workspace, another email).
	sum := sha256.Sum256([]byte(form.Encode()))
	key := "helvetly-customer-" + sess.Workspace.ID + "-" + hex.EncodeToString(sum[:8])
	if err := s.stripe.Call(ctx, http.MethodPost, "/v1/customers", form, key, &c); err != nil {
		return "", err
	}
	return c.ID, q.SetStripeCustomer(ctx, sess.Workspace.ID, c.ID, s.now())
}

// quantity is what a subscription on the price is billed for: the workspace's seats on a per-seat price (one at
// least), 1 on a flat one.
func quantity(ctx context.Context, q store.Q, workspaceID string, p price) (int64, error) {
	if !p.perSeat() {
		return 1, nil
	}
	n, err := q.Seats(ctx, workspaceID)
	return max(n, 1), err
}

// managedPayments turns a Checkout Session into a Managed Payments one: Stripe then collects the name, address and
// tax itself and refuses the parameters for doing that ourselves, so they go.
func managedPayments(form url.Values) {
	for _, k := range []string{"automatic_tax[enabled]", "tax_id_collection[enabled]", "customer_update[name]",
		"customer_update[address]", "invoice_creation[enabled]"} {
		form.Del(k)
	}
	form.Set("managed_payments[enabled]", "true")
}

func (s *Service) checkoutSession(ctx context.Context, b store.Billing, ws, plan, interval, priceID, cur string, seats int64, promoID string) (string, error) {
	back := s.publicURL + "/settings/billing?checkout="
	// Checkout runs only without a live plan, so leaving it goes back to the plan picker to choose again.
	canceled := s.publicURL + "/choose-plan?checkout=canceled"
	form := url.Values{
		"mode": {"subscription"}, "customer": {b.CustomerID}, "client_reference_id": {ws}, "currency": {cur},
		"line_items[0][price]": {priceID}, "line_items[0][quantity]": {strconv.FormatInt(seats, 10)},
		"subscription_data[metadata][workspace_id]": {ws}, "subscription_data[metadata][plan]": {plan},
		"subscription_data[metadata][interval]": {interval},
		"payment_method_collection":             {"always"},
		"billing_address_collection":            {"required"}, "tax_id_collection[enabled]": {"true"},
		"customer_update[name]": {"auto"}, "customer_update[address]": {"auto"},
		"success_url": {back + "success"}, "cancel_url": {canceled},
	}
	if s.cfg.AutomaticTax {
		form.Set("automatic_tax[enabled]", "true")
	}
	if s.cfg.ManagedPayments {
		managedPayments(form)
	}
	if promoID != "" { // Checkout takes a typed code or its own code box, not both
		form.Set("discounts[0][promotion_code]", promoID)
	} else {
		form.Set("allow_promotion_codes", "true")
	}
	if plan == TrialPlan && trialAvailable(b) {
		form.Set("subscription_data[trial_period_days]", strconv.Itoa(TrialDays))
		form.Set("subscription_data[trial_settings][end_behavior][missing_payment_method]", "cancel")
	}
	var cs struct {
		URL string `json:"url"`
	}
	if err := s.stripe.Call(ctx, http.MethodPost, "/v1/checkout/sessions", form, "", &cs); err != nil {
		return "", err
	}
	return cs.URL, nil
}

// fits refuses a plan smaller than what the workspace already has, for a new subscription as for a change.
func (s *Service) fits(ctx context.Context, q store.Q, ws store.Workspace, plan string, perSeat bool) error {
	now := s.now()
	u, err := q.WorkspaceUsage(ctx, ws.ID, monthStart(now, ws.Location()), now)
	if err != nil {
		return err
	}
	if over := s.plans.overages(plan, perSeat, u); len(over) > 0 {
		return auth.Error(http.StatusConflict, "plan_limits_exceeded",
			"The workspace has more than the "+planNames[plan]+" plan allows: remove some first.",
			map[string]any{"plan": plan, "overages": over})
	}
	return nil
}

// changePlan moves a live subscription to another price at once, prorated; a smaller plan must fit what exists. A
// per-seat price bills the workspace's seats, so a subscription on an earlier flat price moves to per seat here.
// With a promotion code on the same plan and interval, only the code is applied; one discount at a time.
func (s *Service) changePlan(ctx context.Context, q store.Q, ws store.Workspace, b store.Billing, plan, interval string, target price, promoID string) (string, error) {
	same := b.Plan == plan && b.Interval == interval
	if same && promoID == "" {
		return "", auth.Error(http.StatusConflict, "same_plan", "The workspace is on this plan already.", nil)
	}
	now := s.now()
	sub, err := s.getSubscription(ctx, b.SubscriptionID)
	if err != nil {
		return "", err
	}
	if promoID != "" && len(sub.Discounts) > 0 {
		return "", errDiscounted
	}
	if len(sub.Items.Data) == 0 {
		return "", errors.New("billing: subscription " + sub.ID + " has no items")
	}
	form := url.Values{"expand[]": subscriptionExpand}
	if promoID != "" {
		form.Set("discounts[0][promotion_code]", promoID)
	}
	if !same {
		if err := s.fits(ctx, q, ws, plan, target.perSeat()); err != nil {
			return "", err
		}
		seats, err := quantity(ctx, q, ws.ID, target)
		if err != nil {
			return "", err
		}
		form.Set("items[0][id]", sub.Items.Data[0].ID)
		form.Set("items[0][price]", target.ID)
		form.Set("items[0][quantity]", strconv.FormatInt(seats, 10))
		form.Set("proration_behavior", "create_prorations")
		form.Set("metadata[plan]", plan)
		form.Set("metadata[interval]", interval)
		if b.Status == "trialing" && plan != TrialPlan {
			form.Set("trial_end", "now") // the other plans are charged at once
		}
	}
	if err := s.stripe.Call(ctx, http.MethodPost, "/v1/subscriptions/"+url.PathEscape(sub.ID), form, "", &sub); err != nil {
		return "", err
	}
	if err := q.ApplySubscription(ctx, ws.ID, sub.Customer, s.toStore(sub), now); err != nil {
		return "", err
	}
	return s.publicURL + "/settings/billing?checkout=switched", nil
}

// ---- portal, sync and details ----

func (s *Service) portal(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	b, err := s.db.WorkspaceBilling(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	if b.CustomerID == "" {
		return errNoCustomer
	}
	var ps struct {
		URL string `json:"url"`
	}
	form := url.Values{"customer": {b.CustomerID}, "return_url": {s.publicURL + "/settings/billing"}}
	if err := s.stripe.Call(r.Context(), http.MethodPost, "/v1/billing_portal/sessions", form, "", &ps); err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]string{"url": ps.URL})
	return nil
}

// sync reads the workspace's subscriptions from Stripe, for the return from Checkout and missed webhooks.
func (s *Service) sync(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	b, err := s.db.WorkspaceBilling(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	if b.CustomerID != "" {
		var subs list[subscription]
		form := url.Values{"customer": {b.CustomerID}, "status": {"all"}, "limit": {"10"},
			"expand[]": {"data.discounts.source.coupon", "data.discounts.promotion_code"}}
		if err := s.stripe.Call(r.Context(), http.MethodGet, "/v1/subscriptions", form, "", &subs); err != nil {
			return err
		}
		if sub, ok := current(subs.Data); ok {
			if err := s.apply(r.Context(), sub, event{}); err != nil {
				return err
			}
		}
	}
	return s.overview(w, r, sess)
}

// current is the live subscription, else the newest (Stripe lists newest first).
func current(subs []subscription) (subscription, bool) {
	for _, sub := range subs {
		if live(sub.Status) {
			return sub, true
		}
	}
	if len(subs) > 0 {
		return subs[0], true
	}
	return subscription{}, false
}

func (s *Service) details(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	b, err := s.db.WorkspaceBilling(r.Context(), sess.Workspace.ID)
	if err != nil {
		return err
	}
	type invoiceItem struct {
		ID       string    `json:"id"`
		Number   string    `json:"number"`
		Date     time.Time `json:"date"`
		Total    int64     `json:"total"`
		Currency string    `json:"currency"`
		Status   string    `json:"status"`
		URL      string    `json:"url"`
		PDF      string    `json:"pdf"`
	}
	type card struct {
		Brand    string `json:"brand"`
		Last4    string `json:"last4"`
		ExpMonth int    `json:"exp_month"`
		ExpYear  int    `json:"exp_year"`
	}
	out := map[string]any{"payment_method": nil, "invoices": []invoiceItem{}}
	if b.CustomerID != "" {
		ctx := r.Context()
		var invs list[invoice]
		if err := s.stripe.Call(ctx, http.MethodGet, "/v1/invoices", url.Values{"customer": {b.CustomerID}, "limit": {"24"}}, "", &invs); err != nil {
			return err
		}
		items := make([]invoiceItem, 0, len(invs.Data))
		for _, inv := range invs.Data {
			if inv.Status == "draft" {
				continue
			}
			items = append(items, invoiceItem{inv.ID, inv.Number, time.Unix(inv.Created, 0).UTC(), inv.Total, inv.Currency,
				inv.Status, inv.HostedInvoiceURL, inv.InvoicePDF})
		}
		out["invoices"] = items
		var pms list[paymentMethod]
		form := url.Values{"customer": {b.CustomerID}, "type": {"card"}, "limit": {"1"}}
		if err := s.stripe.Call(ctx, http.MethodGet, "/v1/payment_methods", form, "", &pms); err != nil {
			return err
		}
		if len(pms.Data) > 0 {
			c := pms.Data[0].Card
			out["payment_method"] = card{c.Brand, c.Last4, c.ExpMonth, c.ExpYear}
		}
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": out})
	return nil
}

// ---- for internal/workspaces ----

// EndSubscription ends billing for a workspace being deleted: its open plan Checkouts expire (one paid afterwards
// would start a subscription nobody can reach) and every subscription of its customer Stripe could still bill or
// resume is cancelled at once.
func (s *Service) EndSubscription(ctx context.Context, workspaceID string) error {
	if !s.enabled {
		return nil
	}
	b, err := s.db.WorkspaceBilling(ctx, workspaceID)
	if err != nil || b.CustomerID == "" {
		return err
	}
	if err := s.expireOpenCheckouts(ctx, b.CustomerID); err != nil {
		return err
	}
	var subs list[subscription] // Stripe lists the ones not cancelled
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/subscriptions", url.Values{"customer": {b.CustomerID}, "limit": {"100"}}, "", &subs); err != nil {
		return err
	}
	for _, sub := range subs.Data {
		if sub.Status == "canceled" || sub.Status == "incomplete_expired" {
			continue
		}
		if err := s.stripe.Call(ctx, http.MethodDelete, "/v1/subscriptions/"+url.PathEscape(sub.ID), nil, "", &sub); err != nil {
			return err
		}
		if sub.ID == b.SubscriptionID {
			if err := s.db.ApplySubscription(ctx, workspaceID, b.CustomerID, s.toStore(sub), s.now()); err != nil {
				return err
			}
		}
	}
	return nil
}

// expireOpenCheckouts expires the customer's open plan Checkout sessions (a pack's are left alone).
func (s *Service) expireOpenCheckouts(ctx context.Context, customerID string) error {
	var open list[checkoutSession]
	form := url.Values{"customer": {customerID}, "status": {"open"}, "limit": {"100"}}
	err := s.stripe.Call(ctx, http.MethodGet, "/v1/checkout/sessions", form, "", &open)
	for _, cs := range open.Data {
		if cs.Mode != "subscription" {
			continue
		}
		if e := s.stripe.Call(ctx, http.MethodPost, "/v1/checkout/sessions/"+url.PathEscape(cs.ID)+"/expire", nil, "", nil); e != nil {
			err = e
		}
	}
	return err
}

// WriteError answers like the billing handlers do (a refused Stripe call is a 502).
func (s *Service) WriteError(w http.ResponseWriter, r *http.Request, err error) {
	s.writeError(w, r, err)
}
