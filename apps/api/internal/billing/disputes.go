package billing

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// Chargebacks (charge.dispute.*) and refunds (charge.refunded). Each event reads its dispute or charge again from
// Stripe, and every effect follows the state read, not the event: a lost dispute's subscription is cancelled while
// it still runs, and a pack's tokens are taken back in proportion to what was refunded, all of them on a lost
// dispute, never less than before (ai_token_packs.revoked). Replays and any order of delivery therefore end the same
// way; each event is also recorded (stripe_events) in the transaction that applies it.

type stripeCharge struct {
	ID             string `json:"id"`
	Customer       string `json:"customer"`
	PaymentIntent  string `json:"payment_intent"`
	Amount         int64  `json:"amount"`
	AmountRefunded int64  `json:"amount_refunded"`
}

// invoicePayment is an invoice's payment, with the invoice expanded: a subscription invoice names its subscription
// in parent.subscription_details (a pack's invoice has no parent).
type invoicePayment struct {
	Invoice struct {
		Parent *struct {
			SubscriptionDetails *struct {
				Subscription string `json:"subscription"`
			} `json:"subscription_details"`
		} `json:"parent"`
	} `json:"invoice"`
}

// subscriptionPaid is the subscription whose invoice the payment intent paid; "" for any other payment.
func (s *Service) subscriptionPaid(ctx context.Context, paymentIntent string) (string, error) {
	var found list[invoicePayment]
	form := url.Values{"payment[type]": {"payment_intent"}, "payment[payment_intent]": {paymentIntent}, "expand[]": {"data.invoice"}}
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/invoice_payments", form, "", &found); err != nil {
		return "", err
	}
	for _, p := range found.Data {
		if p.Invoice.Parent != nil && p.Invoice.Parent.SubscriptionDetails != nil {
			return p.Invoice.Parent.SubscriptionDetails.Subscription, nil
		}
	}
	return "", nil
}

type stripeDispute struct {
	ID     string       `json:"id"`
	Status string       `json:"status"`
	Charge stripeCharge `json:"charge"` // expanded
}

type checkoutSession struct {
	ID            string            `json:"id"`
	Mode          string            `json:"mode"`
	Customer      string            `json:"customer"`
	Subscription  string            `json:"subscription"`
	PaymentStatus string            `json:"payment_status"`
	Metadata      map[string]string `json:"metadata"`
}

// paidFor: what a charge paid for one of our workspaces — a subscription invoice (subID) or an AI token pack (pack).
// ws is "" for a charge billing does not know, for an unknown workspace, or for another customer than the workspace's
// (one not recorded yet is fine, as in apply: the dispute may arrive before the subscription).
func (s *Service) paidFor(ctx context.Context, ch stripeCharge) (ws, subID string, pack *checkoutSession, err error) {
	if ch.PaymentIntent == "" {
		return "", "", nil, nil
	}
	paid, err := s.subscriptionPaid(ctx, ch.PaymentIntent)
	if err != nil {
		return "", "", nil, err
	}
	switch {
	case paid != "":
		sub, err := s.getSubscription(ctx, paid)
		if err != nil {
			return "", "", nil, err
		}
		if sub.Customer == ch.Customer {
			ws, subID = sub.Metadata["workspace_id"], sub.ID
		}
	default:
		var found list[checkoutSession]
		form := url.Values{"payment_intent": {ch.PaymentIntent}, "limit": {"1"}}
		if err := s.stripe.Call(ctx, http.MethodGet, "/v1/checkout/sessions", form, "", &found); err != nil {
			return "", "", nil, err
		}
		if len(found.Data) == 1 && found.Data[0].Mode == "payment" && found.Data[0].Metadata[AITokensKey] != "" {
			pack = &found.Data[0]
			ws = pack.Metadata["workspace_id"]
		}
	}
	if ws == "" {
		return "", "", nil, nil
	}
	if _, err := s.db.WorkspaceName(ctx, ws); errors.Is(err, store.ErrNotFound) {
		s.log.WarnContext(ctx, "ignoring a charge for an unknown workspace", "charge", ch.ID, "workspace", ws)
		return "", "", nil, nil
	} else if err != nil {
		return "", "", nil, err
	}
	b, err := s.db.WorkspaceBilling(ctx, ws)
	if err != nil {
		return "", "", nil, err
	}
	if b.CustomerID != "" && b.CustomerID != ch.Customer {
		s.log.WarnContext(ctx, "ignoring a charge of another customer", "charge", ch.ID, "workspace", ws)
		return "", "", nil, nil
	}
	return ws, subID, pack, nil
}

func (s *Service) getDispute(ctx context.Context, id string) (d stripeDispute, err error) {
	err = s.stripe.Call(ctx, http.MethodGet, "/v1/disputes/"+url.PathEscape(id), url.Values{"expand[]": {"charge"}}, "", &d)
	return d, err
}

// dispute follows a chargeback. Opened: the owners and admins hear once and the billing alert shows; the plan keeps
// working. Lost: the subscription it paid ends now, or the pack's tokens are taken back. Won or lost: the alert goes.
func (s *Service) dispute(ctx context.Context, ev event, id string) error {
	d, err := s.getDispute(ctx, id)
	if err != nil {
		return err
	}
	ws, subID, pack, err := s.paidFor(ctx, d.Charge)
	if err != nil || ws == "" {
		return err
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockBilling(ctx, ws); err != nil {
			return err
		}
		if err := s.record(ctx, q, ev); err != nil {
			return err
		}
		// A dispute read before this lock may be older than another delivery's commit.
		if d, err = s.getDispute(ctx, id); err != nil {
			return err
		}
		fresh, err := q.SaveDispute(ctx, d.ID, ws, d.Status, s.now())
		if err != nil {
			return err
		}
		if fresh && disputeOpen(d.Status) {
			if err := notifications.Notify(ctx, q, ws, "billing.payment_disputed", map[string]any{"for": paidWhat(subID)},
				store.NotifyTo{Roles: notifications.Managers, Once: "billing.payment_disputed:" + d.ID}, s.now()); err != nil {
				return err
			}
		}
		if d.Status == "lost" && pack != nil {
			return s.revokePack(ctx, q, ws, *pack, 1, 1)
		}
		return nil
	})
	// A replay still cancels: a cancellation that failed after the commit is retried by Stripe's redelivery.
	if errors.Is(err, errSeen) {
		err = nil
	}
	if err != nil || d.Status != "lost" || subID == "" {
		return err
	}
	return s.cancelNow(ctx, subID)
}

func disputeOpen(status string) bool {
	return status != "won" && status != "lost" && status != "warning_closed"
}

func paidWhat(subID string) string {
	if subID != "" {
		return "subscription"
	}
	return "ai_tokens"
}

// cancelNow ends a subscription in Stripe at once, unless it has ended, and records it as the webhook would; a
// failure is returned, so Stripe delivers the dispute again and this runs again.
func (s *Service) cancelNow(ctx context.Context, subID string) error {
	sub, err := s.getSubscription(ctx, subID)
	if err != nil {
		return err
	}
	if sub.Status != "canceled" && sub.Status != "incomplete_expired" {
		s.log.WarnContext(ctx, "cancelling a subscription after a lost dispute", "subscription", subID)
		if err := s.stripe.Call(ctx, http.MethodDelete, "/v1/subscriptions/"+url.PathEscape(subID), nil, "", nil); err != nil {
			return err
		}
	}
	return s.apply(ctx, sub, event{})
}

// refund follows charge.refunded. A pack loses its tokens in proportion to the amount refunded so far (all on a
// full refund). A subscription payment is refunded by the operator, who also decides whether it ends: that is only
// logged.
func (s *Service) refund(ctx context.Context, ev event, chargeID string) error {
	var ch stripeCharge
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/charges/"+url.PathEscape(chargeID), nil, "", &ch); err != nil {
		return err
	}
	ws, subID, pack, err := s.paidFor(ctx, ch)
	if err != nil || ws == "" {
		return err
	}
	if pack == nil || ch.Amount <= 0 || ch.AmountRefunded <= 0 {
		s.log.InfoContext(ctx, "a payment was refunded; nothing changes", "charge", ch.ID, "workspace", ws,
			"subscription", subID, "refunded", ch.AmountRefunded, "amount", ch.Amount)
		return nil
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockBilling(ctx, ws); err != nil {
			return err
		}
		if err := s.record(ctx, q, ev); err != nil {
			return err
		}
		return s.revokePack(ctx, q, ws, *pack, min(ch.AmountRefunded, ch.Amount), ch.Amount)
	})
	if errors.Is(err, errSeen) {
		return nil
	}
	return err
}

// revokePack takes back share/of of a pack's tokens (rounded down, in the customer's favour) in total, on top of
// what was taken before and never less: never more than the workspace has left this month, never below 0.
func (s *Service) revokePack(ctx context.Context, q store.Q, ws string, pack checkoutSession, share, of int64) error {
	tokens, err := strconv.ParseInt(pack.Metadata[AITokensKey], 10, 64)
	if err != nil || tokens <= 0 {
		return nil
	}
	want := tokens * share / of
	now := s.now()
	period := store.UsagePeriod(now)
	b, err := q.WorkspaceBilling(ctx, ws)
	if err != nil {
		return err
	}
	var monthly int64 // without a plan only the packs are left to take from
	if PlanOf(b, s.now()) != "" {
		r, err := s.entitlementsOf(ctx, q, ws, b)
		if err != nil {
			return err
		}
		if monthly, err = r.Cap(AITokens); err != nil {
			return err
		}
	}
	left := tokens
	if monthly != Unlimited {
		bought, err := q.AITokenPacks(ctx, ws, period)
		if err != nil {
			return err
		}
		used, err := q.LockHeidiUsage(ctx, ws, aimodel.PoolHeidi, period, now) // packs add to Heidi's pool; no AI spend in between
		if err != nil {
			return err
		}
		left = monthly + bought - used.TokensUsed
	}
	revoked, ok, err := q.RevokeAITokenPack(ctx, pack.ID, ws, period, tokens, want, left, now)
	if ok {
		s.log.InfoContext(ctx, "AI token pack taken back", "workspace", ws, "session", pack.ID, "revoked", revoked, "of", tokens)
	}
	return err
}
