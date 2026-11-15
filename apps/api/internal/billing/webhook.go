package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// signatureTolerance: an older signed timestamp is a replay.
const signatureTolerance = 5 * time.Minute

var errBadSignature = auth.Error(http.StatusBadRequest, "invalid_signature", "The Stripe-Signature header does not match.", nil)

// verifySignature checks Stripe's "t=<unix>,v1=<hex HMAC-SHA256 of t.payload>" header (any v1 may match).
func verifySignature(payload []byte, header, secret string, now time.Time) bool {
	var ts string
	var sigs [][]byte
	for part := range strings.SplitSeq(header, ",") {
		k, v, _ := strings.Cut(strings.TrimSpace(part), "=")
		switch k {
		case "t":
			ts = v
		case "v1":
			if sig, err := hex.DecodeString(v); err == nil {
				sigs = append(sigs, sig)
			}
		}
	}
	unix, err := strconv.ParseInt(ts, 10, 64)
	if err != nil || len(sigs) == 0 {
		return false
	}
	if age := now.Sub(time.Unix(unix, 0)); age > signatureTolerance || age < -signatureTolerance {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "."))
	mac.Write(payload)
	want := mac.Sum(nil)
	for _, sig := range sigs {
		if hmac.Equal(sig, want) {
			return true
		}
	}
	return false
}

type event struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Data struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

// webhook applies Stripe's events. The subscription is read again from Stripe, so events arriving out of order or
// twice leave the latest state; each event id is applied once (stripe_events).
func (s *Service) webhook(w http.ResponseWriter, r *http.Request) {
	if !s.enabled {
		s.writeError(w, r, errDisabled)
		return
	}
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		s.writeError(w, r, auth.Error(http.StatusRequestEntityTooLarge, "too_large", "The event is too large.", nil))
		return
	}
	if !slices.ContainsFunc(s.cfg.WebhookSecrets(), func(secret string) bool {
		return verifySignature(payload, r.Header.Get("Stripe-Signature"), secret, s.now())
	}) {
		s.writeError(w, r, errBadSignature)
		return
	}
	var ev event
	if err := json.Unmarshal(payload, &ev); err != nil || ev.ID == "" {
		s.writeError(w, r, auth.Error(http.StatusBadRequest, "invalid_request", "The event is not valid JSON.", nil))
		return
	}
	if err := s.handleEvent(r.Context(), ev); err != nil {
		s.writeError(w, r, err) // a 5xx makes Stripe deliver it again
		return
	}
	auth.WriteJSON(w, http.StatusOK, map[string]bool{"received": true})
}

// handleEvent reads only what every API version's payload has alike (the event's id and type, and the object's id)
// and reads the object again from Stripe with the pinned version, so events from an endpoint on an older version
// apply the same while the endpoints are switched.
func (s *Service) handleEvent(ctx context.Context, ev event) error {
	var obj struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(ev.Data.Object, &obj); err != nil {
		return auth.Error(http.StatusBadRequest, "invalid_request", "The event's object is not valid.", nil)
	}
	if obj.ID == "" {
		return nil // nothing billing could read again
	}
	var subID string
	switch ev.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		var cs checkoutSession
		if err := s.stripe.Call(ctx, http.MethodGet, "/v1/checkout/sessions/"+url.PathEscape(obj.ID), nil, "", &cs); err != nil {
			return err
		}
		if cs.Mode == "payment" { // an AI token pack
			return s.creditAITokens(ctx, ev, cs.ID, cs.Customer, cs.Metadata["workspace_id"], cs.Metadata[AITokensKey], cs.PaymentStatus)
		}
		if cs.Mode == "subscription" {
			subID = cs.Subscription
		}
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
		"customer.subscription.paused", "customer.subscription.resumed", "customer.subscription.trial_will_end":
		subID = obj.ID
	case "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed":
		return s.dispute(ctx, ev, obj.ID)
	case "charge.refunded":
		return s.refund(ctx, ev, obj.ID)
	}
	if subID == "" {
		return nil // not an event billing follows
	}
	sub, err := s.getSubscription(ctx, subID)
	if err != nil {
		return err
	}
	return s.apply(ctx, sub, ev)
}

var errSeen = errors.New("event applied before")

// record notes the event (none for a zero ev) in the transaction that applies it: errSeen when it was applied before.
func (s *Service) record(ctx context.Context, q store.Q, ev event) error {
	if ev.ID == "" {
		return nil
	}
	fresh, err := q.RecordStripeEvent(ctx, ev.ID, ev.Type, s.now())
	if err == nil && !fresh {
		err = errSeen
	}
	return err
}

// apply records a subscription read from Stripe on the workspace in its metadata. ev, when set, is applied once. A
// subscription for another customer than the workspace's, or an older one ending while a newer one is stored,
// changes nothing; a second live subscription never replaces the live one on record (settleDuplicate). A per-seat
// one that bills another number than the workspace's people is then synced.
func (s *Service) apply(ctx context.Context, sub subscription, ev event) error {
	ws := sub.Metadata["workspace_id"]
	var resync bool
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := s.record(ctx, q, ev); err != nil {
			return err
		}
		if ws == "" {
			s.log.InfoContext(ctx, "ignoring a subscription without a workspace", "subscription", sub.ID)
			return nil
		}
		if _, err := q.WorkspaceName(ctx, ws); errors.Is(err, store.ErrNotFound) {
			s.log.WarnContext(ctx, "ignoring a subscription for an unknown workspace", "subscription", sub.ID, "workspace", ws)
			return nil
		} else if err != nil {
			return err
		}
		if err := q.LockBilling(ctx, ws); err != nil {
			return err
		}
		// A response fetched before this lock may already be older than another handler's commit.
		latest, err := s.getSubscription(ctx, sub.ID)
		if err != nil {
			return err
		}
		if latest.Metadata["workspace_id"] != ws {
			return errors.New("billing: subscription workspace changed during refresh")
		}
		sub = latest
		b, err := q.WorkspaceBilling(ctx, ws)
		if err != nil {
			return err
		}
		if b.CustomerID != "" && b.CustomerID != sub.Customer {
			s.log.WarnContext(ctx, "ignoring a subscription for another customer", "subscription", sub.ID, "workspace", ws)
			return nil
		}
		if b.SubscriptionID != "" && b.SubscriptionID != sub.ID && (!live(sub.Status) || live(b.Status)) {
			return nil // an older one ending, or a second live one (settleDuplicate), leaves the one on record
		}
		after := s.toStore(sub, b)
		if err := q.ApplySubscription(ctx, ws, sub.Customer, after, s.now()); err != nil {
			return err
		}
		if after.PerSeat && live(after.Status) {
			seats, err := q.Seats(ctx, ws)
			if err != nil {
				return err
			}
			resync = after.Seats != max(seats, 1)
		}
		if event, data := subscriptionNews(ev.Type, b, after); event != "" {
			return notifications.Notify(ctx, q, ws, event, data, store.NotifyTo{Roles: notifications.Owners}, s.now())
		}
		return nil
	})
	if err != nil && !errors.Is(err, errSeen) {
		return err
	}
	// Both read the state as it is, so a re-delivered event runs them again until they went through.
	if err := s.settleDuplicate(ctx, sub); err != nil {
		return err
	}
	s.voidUnpaidInvoices(ctx, sub)
	if resync {
		s.resyncSeats(ctx, ws)
	}
	return nil
}

// otherLive: the workspace has a live subscription on record and sub is another live one of its customer.
func otherLive(b store.Billing, sub subscription) bool {
	return b.SubscriptionID != "" && b.SubscriptionID != sub.ID && b.CustomerID == sub.Customer && live(b.Status) && live(sub.Status)
}

// settleDuplicate keeps one subscription per workspace. A live one arriving while another is live on record (two
// checkouts, both paid) is cancelled at Stripe, its unused time credited to the customer's balance (which pays the
// kept one's next invoices). When the one on record turns out to have ended at Stripe (its event lost), that is
// applied first and sub takes its place.
func (s *Service) settleDuplicate(ctx context.Context, sub subscription) error {
	ws := sub.Metadata["workspace_id"]
	if ws == "" || !live(sub.Status) {
		return nil
	}
	b, err := s.db.WorkspaceBilling(ctx, ws)
	if err != nil || !otherLive(b, sub) {
		return err
	}
	kept, err := s.getSubscription(ctx, b.SubscriptionID)
	if err != nil {
		return err
	}
	if !live(kept.Status) {
		if err := s.apply(ctx, kept, event{}); err != nil {
			return err
		}
		return s.apply(ctx, sub, event{})
	}
	s.log.WarnContext(ctx, "cancelling a second live subscription, unused time credited", "workspace", ws, "kept", kept.ID,
		"cancelled", sub.ID)
	return s.stripe.Call(ctx, http.MethodDelete, "/v1/subscriptions/"+url.PathEscape(sub.ID),
		url.Values{"prorate": {"true"}, "invoice_now": {"true"}}, "", nil)
}

// voidUnpaidInvoices: a subscription Stripe cancelled because a payment kept failing leaves its other open invoices
// to be collected, so a card added later would be charged for a plan that is over. They are voided. An unpaid (not
// cancelled) subscription keeps its invoices: paying them is what opens it again. Best effort, logged.
func (s *Service) voidUnpaidInvoices(ctx context.Context, sub subscription) {
	if sub.Status != "canceled" || sub.CancellationDetails.Reason != "payment_failed" || sub.Metadata["workspace_id"] == "" {
		return
	}
	// Only the subscription on record: another customer's, or one of a workspace this server doesn't have, is left.
	if b, err := s.db.WorkspaceBilling(ctx, sub.Metadata["workspace_id"]); err != nil || b.SubscriptionID != sub.ID || b.CustomerID != sub.Customer {
		return
	}
	var open list[invoice]
	form := url.Values{"subscription": {sub.ID}, "status": {"open"}, "limit": {"100"}}
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/invoices", form, "", &open); err != nil {
		s.log.WarnContext(ctx, "reading the open invoices of an ended subscription failed", "subscription", sub.ID, "error", err)
		return
	}
	for _, inv := range open.Data {
		// One paid or voided meanwhile is refused by Stripe: logged, and not listed as open the next time.
		if err := s.stripe.Call(ctx, http.MethodPost, "/v1/invoices/"+url.PathEscape(inv.ID)+"/void", nil, "", nil); err != nil {
			s.log.WarnContext(ctx, "voiding an open invoice of an ended subscription failed", "invoice", inv.ID, "error", err)
		}
	}
}

// subscriptionExpand reads a subscription's discounts with their coupon and promotion code, so the discount can name
// the code,
// and the latest invoice, which tells an unpaid renewal (planExpiry).
var subscriptionExpand = []string{"discounts.source.coupon", "discounts.promotion_code", "latest_invoice"}

func (s *Service) getSubscription(ctx context.Context, id string) (sub subscription, err error) {
	err = s.stripe.Call(ctx, http.MethodGet, "/v1/subscriptions/"+url.PathEscape(id), url.Values{"expand[]": subscriptionExpand}, "", &sub)
	return sub, err
}

// toStore maps the price to its plan and interval (an unknown price is no plan), keeps the discount and works out
// until when the plan works (planExpiry) from what before recorded.
func (s *Service) toStore(sub subscription, before store.Billing) store.Subscription {
	out := store.Subscription{ID: sub.ID, Status: sub.Status, CancelAtPeriodEnd: sub.CancelAtPeriodEnd || sub.CancelAt != nil}
	var prev *time.Time
	if before.SubscriptionID == sub.ID {
		prev = before.PlanExpiresAt
	}
	out.PlanExpiresAt = planExpiry(sub, prev, s.now())
	out.Plan, out.Interval = sub.price().planAndInterval()
	out.PerSeat, out.Seats = sub.price().perSeat(), sub.quantity()
	if out.Plan == "" {
		s.log.Warn("a subscription has a price that is not a Helvetly plan", "subscription", sub.ID, "price", sub.priceID())
	}
	if end := sub.periodEnd(); end > 0 {
		t := time.Unix(end, 0).UTC()
		out.CurrentPeriodEnd = &t
	}
	if sub.TrialEnd != nil {
		t := time.Unix(*sub.TrialEnd, 0).UTC()
		out.TrialEnd = &t
	}
	out.Discount = discountJSON(sub)
	return out
}

// discountJSON is the subscription's discount as the overview shows it, an amount off in the subscription's
// currency; nil when it has none (one discount at a time).
func discountJSON(sub subscription) json.RawMessage {
	if len(sub.Discounts) == 0 {
		return nil
	}
	d, cur := sub.Discounts[0], sub.Currency
	out := struct {
		Code             string     `json:"code"`
		PercentOff       *float64   `json:"percent_off"`
		AmountOff        *int64     `json:"amount_off"`
		Currency         *string    `json:"currency"`
		Duration         string     `json:"duration"`
		DurationInMonths *int       `json:"duration_in_months"`
		EndsAt           *time.Time `json:"ends_at"`
	}{PercentOff: d.Source.Coupon.PercentOff, Duration: d.Source.Coupon.Duration, DurationInMonths: d.Source.Coupon.DurationInMonths}
	if amount, _ := d.Source.Coupon.amountIn(cur); amount > 0 {
		out.AmountOff, out.Currency = &amount, &cur
	}
	var pc struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(d.PromotionCode, &pc) // a bare id (not expanded) leaves the code empty
	out.Code = pc.Code
	if d.End != nil {
		t := time.Unix(*d.End, 0).UTC()
		out.EndsAt = &t
	}
	raw, _ := json.Marshal(out) // plain fields: cannot fail
	return raw
}

func trialAvailable(b store.Billing) bool { return !b.TrialUsed && b.SubscriptionID == "" }
