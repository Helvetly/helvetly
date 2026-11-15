package billing

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// Chargebacks (charge.dispute.*) and refunds (charge.refunded). Each event reads its dispute or charge again from
// Stripe, and every effect follows the state read, not the event: a lost dispute's subscription is cancelled while
// it still runs, and a pack's tokens are taken back once (ai_token_packs.revoked_at). Replays and any order of
// delivery therefore end the same way.

type stripeCharge struct {
	ID             string `json:"id"`
	Customer       string `json:"customer"`
	PaymentIntent  string `json:"payment_intent"`
	Amount         int64  `json:"amount"`
	AmountRefunded int64  `json:"amount_refunded"`
	Invoice        *struct {
		Subscription string `json:"subscription"`
	} `json:"invoice"` // expanded; null for a payment without an invoice
}

type stripeDispute struct {
	ID     string       `json:"id"`
	Status string       `json:"status"`
	Charge stripeCharge `json:"charge"` // expanded
}

type checkoutSession struct {
	ID       string            `json:"id"`
	Mode     string            `json:"mode"`
	Metadata map[string]string `json:"metadata"`
}

// paidFor: what a charge paid for one of our workspaces — a subscription invoice (subID) or an AI token pack (pack).
// ws is "" for a charge billing does not know, for an unknown workspace, or for another customer than the workspace's
// (one not recorded yet is fine, as in apply: the dispute may arrive before the subscription).
func (s *Service) paidFor(ctx context.Context, ch stripeCharge) (ws, subID string, pack *checkoutSession, err error) {
	switch {
	case ch.Invoice != nil && ch.Invoice.Subscription != "":
		sub, err := s.getSubscription(ctx, ch.Invoice.Subscription)
		if err != nil {
			return "", "", nil, err
		}
		if sub.Customer == ch.Customer {
			ws, subID = sub.Metadata["workspace_id"], sub.ID
		}
	case ch.PaymentIntent != "":
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
	err = s.stripe.Call(ctx, http.MethodGet, "/v1/disputes/"+url.PathEscape(id), url.Values{"expand[]": {"charge.invoice"}}, "", &d)
	return d, err
}

// dispute follows a chargeback. Opened: the owners and admins hear once and the billing alert shows; the plan keeps
// working. Lost: the subscription it paid ends now, or the pack's tokens are taken back. Won or lost: the alert goes.
func (s *Service) dispute(ctx context.Context, id string) error {
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
			return s.revokePack(ctx, q, ws, *pack)
		}
		return nil
	})
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
	return s.apply(ctx, sub, "", "")
}

// refund follows charge.refunded. A pack refunded in full loses its tokens. A subscription payment is refunded by
// the operator, who also decides whether it ends: that, and any partial refund, is only logged.
func (s *Service) refund(ctx context.Context, chargeID string) error {
	var ch stripeCharge
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/charges/"+url.PathEscape(chargeID), url.Values{"expand[]": {"invoice"}}, "", &ch); err != nil {
		return err
	}
	ws, subID, pack, err := s.paidFor(ctx, ch)
	if err != nil || ws == "" {
		return err
	}
	full := ch.AmountRefunded >= ch.Amount
	if !full || pack == nil {
		s.log.InfoContext(ctx, "a payment was refunded; nothing changes", "charge", ch.ID, "workspace", ws,
			"subscription", subID, "full", full, "refunded", ch.AmountRefunded, "amount", ch.Amount)
		return nil
	}
	return s.db.Tx(ctx, func(q store.Q) error {
		if err := q.LockBilling(ctx, ws); err != nil {
			return err
		}
		return s.revokePack(ctx, q, ws, *pack)
	})
}

// revokePack takes back a pack's tokens, once: never more than the workspace has left this month, never below 0.
func (s *Service) revokePack(ctx context.Context, q store.Q, ws string, pack checkoutSession) error {
	tokens, err := strconv.ParseInt(pack.Metadata[AITokensKey], 10, 64)
	if err != nil || tokens <= 0 {
		return nil
	}
	w, err := q.AdmissionWorkspace(ctx, ws)
	if err != nil {
		return err
	}
	now := s.now()
	period := now.In(w.Location()).Format("2006-01")
	b, err := q.WorkspaceBilling(ctx, ws)
	if err != nil {
		return err
	}
	var monthly int64 // without a plan only the packs are left to take from
	if plan := PlanOf(b); plan != "" {
		monthly = s.plans.of(plan, AITokens)
	}
	left := tokens
	if monthly != Unlimited {
		bought, err := q.AITokenPacks(ctx, ws, period)
		if err != nil {
			return err
		}
		used, err := q.LockHeidiUsage(ctx, ws, period, now) // no AI spend in between
		if err != nil {
			return err
		}
		left = monthly + bought - used.TokensUsed
	}
	taken, ok, err := q.RevokeAITokenPack(ctx, pack.ID, ws, period, tokens, left, now)
	if ok {
		s.log.InfoContext(ctx, "AI token pack taken back", "workspace", ws, "session", pack.ID, "tokens", taken, "of", tokens)
	}
	return err
}
