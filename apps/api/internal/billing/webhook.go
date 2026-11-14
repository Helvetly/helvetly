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
	if !verifySignature(payload, r.Header.Get("Stripe-Signature"), s.cfg.WebhookSecret, s.now()) {
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

func (s *Service) handleEvent(ctx context.Context, ev event) error {
	var obj struct {
		ID           string `json:"id"`
		Mode         string `json:"mode"`
		Subscription string `json:"subscription"`
	}
	if err := json.Unmarshal(ev.Data.Object, &obj); err != nil {
		return auth.Error(http.StatusBadRequest, "invalid_request", "The event's object is not valid.", nil)
	}
	var subID string
	switch ev.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		if obj.Mode == "subscription" {
			subID = obj.Subscription
		}
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
		"customer.subscription.paused", "customer.subscription.resumed", "customer.subscription.trial_will_end":
		subID = obj.ID
	}
	if subID == "" {
		return nil // not an event billing follows
	}
	sub, err := s.getSubscription(ctx, subID)
	if err != nil {
		return err
	}
	return s.apply(ctx, sub, ev.ID, ev.Type)
}

var errSeen = errors.New("event applied before")

// apply records a subscription read from Stripe on the workspace in its metadata. eventID, when set, is applied
// once. A subscription for another customer than the workspace's, or an older one ending while a newer one is
// stored, changes nothing; a second live subscription replaces the stored one, which is then cancelled.
func (s *Service) apply(ctx context.Context, sub subscription, eventID, eventType string) error {
	ws := sub.Metadata["workspace_id"]
	var replaced string
	err := s.db.Tx(ctx, func(q store.Q) error {
		if eventID != "" {
			fresh, err := q.RecordStripeEvent(ctx, eventID, eventType, s.now())
			if err != nil {
				return err
			}
			if !fresh {
				return errSeen
			}
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
		if b.SubscriptionID != "" && b.SubscriptionID != sub.ID {
			if !live(sub.Status) {
				return nil
			}
			if live(b.Status) {
				replaced = b.SubscriptionID
			}
		}
		after := s.toStore(sub)
		if err := q.ApplySubscription(ctx, ws, sub.Customer, after, s.now()); err != nil {
			return err
		}
		if event, data := subscriptionNews(eventType, b, after); event != "" {
			return notifications.Notify(ctx, q, ws, event, data, store.NotifyTo{Roles: notifications.Owners}, s.now())
		}
		return nil
	})
	if errors.Is(err, errSeen) {
		return nil
	}
	if err == nil && replaced != "" {
		s.log.WarnContext(ctx, "cancelling a replaced subscription", "subscription", replaced, "workspace", ws)
		// The event is recorded, so a retry would not get here again: a failure is for a person to follow up.
		if err := s.stripe.Call(ctx, http.MethodDelete, "/v1/subscriptions/"+url.PathEscape(replaced), nil, "", nil); err != nil {
			s.log.ErrorContext(ctx, "cancelling a replaced subscription failed", "subscription", replaced, "error", err)
		}
	}
	return err
}

// getSubscription reads a subscription with its promotion code, so the discount can name the code.
func (s *Service) getSubscription(ctx context.Context, id string) (sub subscription, err error) {
	err = s.stripe.Call(ctx, http.MethodGet, "/v1/subscriptions/"+url.PathEscape(id), url.Values{"expand[]": {"discount.promotion_code"}}, "", &sub)
	return sub, err
}

// toStore maps the price to its plan and interval (an unknown price is no plan) and keeps the discount.
func (s *Service) toStore(sub subscription) store.Subscription {
	out := store.Subscription{ID: sub.ID, Status: sub.Status, CancelAtPeriodEnd: sub.CancelAtPeriodEnd || sub.CancelAt != nil}
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
	out.Discount = discountJSON(sub.Discount)
	return out
}

// discountJSON is the discount as the overview shows it; nil when the subscription has none.
func discountJSON(d *stripeDiscount) json.RawMessage {
	if d == nil {
		return nil
	}
	out := struct {
		Code             string     `json:"code"`
		PercentOff       *float64   `json:"percent_off"`
		AmountOff        *int64     `json:"amount_off"`
		Currency         *string    `json:"currency"`
		Duration         string     `json:"duration"`
		DurationInMonths *int       `json:"duration_in_months"`
		EndsAt           *time.Time `json:"ends_at"`
	}{PercentOff: d.Coupon.PercentOff, AmountOff: d.Coupon.AmountOff, Currency: d.Coupon.Currency,
		Duration: d.Coupon.Duration, DurationInMonths: d.Coupon.DurationInMonths}
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
