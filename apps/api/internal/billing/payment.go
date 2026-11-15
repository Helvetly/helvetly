package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Why a plan change that is charged at once (leaving the trial, an upgrade, monthly to yearly) hasn't been paid.
// Stripe keeps such a change as the subscription's pending update until the invoice it made is paid; the person pays
// or confirms on Stripe's own pages (the hosted invoice page, the billing portal), never in Helvetly.
const (
	// PaymentAuthRequired: the bank asks the customer to confirm the payment (3-D Secure); pay_url lets them.
	PaymentAuthRequired = "authentication_required"
	// PaymentDeclined and the more precise declines below: the card was refused; another card is needed.
	PaymentDeclined          = "card_declined"
	PaymentInsufficientFunds = "insufficient_funds"
	PaymentExpiredCard       = "expired_card"
	PaymentIncorrectDetails  = "incorrect_card_details"
	// PaymentProcessing: the payment is under way (or paid and not applied yet); nothing to do but wait.
	PaymentProcessing = "processing"
	// PaymentUnknown: Stripe's answer couldn't be read; the change still waits for its payment.
	PaymentUnknown = "unknown"
)

// PendingPayment is a plan change waiting for its payment, and why that payment hasn't gone through.
type PendingPayment struct {
	Pending     bool   `json:"pending"`                // false when nothing waits (nothing else is set then)
	Reason      string `json:"reason,omitempty"`       // one of the Payment* constants
	DeclineCode string `json:"decline_code,omitempty"` // Stripe's decline or error code, as Stripe gives it
	PayURL      string `json:"pay_url,omitempty"`      // Stripe's hosted invoice page (https, a Stripe host)
	Plan        string `json:"plan,omitempty"`         // the plan waiting for the payment, when it can be told
	ExpiresAt   string `json:"expires_at,omitempty"`   // when Stripe drops the waiting change if still unpaid
}

// pendingUpdate is a subscription's pending_update (null when nothing waits).
type pendingUpdate struct {
	ExpiresAt         int64 `json:"expires_at"`
	SubscriptionItems []struct {
		Price price `json:"price"`
	} `json:"subscription_items"`
}

// error is the 402 a plan change answers when its payment didn't go through, the PendingPayment as details. keeps:
// what goes on unchanged meanwhile ("the trial", "your current plan").
func (pp PendingPayment) error(keeps string) error {
	msg := "The payment for the new plan didn't go through, so " + keeps + " stays as it was. Check the card and try again."
	switch pp.Reason {
	case PaymentAuthRequired:
		msg = "Your bank asks you to confirm the payment for the new plan; until then " + keeps + " stays as it was."
	case PaymentDeclined, PaymentInsufficientFunds, PaymentExpiredCard, PaymentIncorrectDetails:
		msg = "The card was declined, so " + keeps + " stays as it was. Pay with another card or update it, then try again."
	case PaymentProcessing:
		msg = "The payment for the new plan is still being processed; the plan changes once it goes through."
	}
	details := map[string]any{"reason": pp.Reason}
	for k, v := range map[string]string{"pay_url": pp.PayURL, "decline_code": pp.DeclineCode, "plan": pp.Plan, "expires_at": pp.ExpiresAt} {
		if v != "" {
			details[k] = v
		}
	}
	return auth.Error(http.StatusPaymentRequired, "payment_failed", msg, details)
}

// pendingPayment answers whether a plan change waits for its payment and why it hasn't been paid (GET).
func (s *Service) pendingPayment(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx := r.Context()
	b, err := s.db.WorkspaceBilling(ctx, sess.Workspace.ID)
	if err != nil {
		return err
	}
	pp := PendingPayment{}
	if b.SubscriptionID != "" {
		var sub subscription
		form := url.Values{"expand[]": {"latest_invoice"}}
		if err := s.stripe.Call(ctx, http.MethodGet, "/v1/subscriptions/"+url.PathEscape(b.SubscriptionID), form, "", &sub); err != nil {
			return err
		}
		if sub.PendingUpdate != nil {
			pp = s.paymentOf(ctx, *sub.PendingUpdate, sub.LatestInvoice, "")
		}
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": pp})
	return nil
}

// paymentOf reads why the invoice of a pending update hasn't been paid: the invoice (expanded, or its id), then its
// default payment's intent. A read that fails leaves the reason unknown (logged), never an error: the change still
// waits either way.
func (s *Service) paymentOf(ctx context.Context, pu pendingUpdate, rawInvoice json.RawMessage, plan string) PendingPayment {
	pp := PendingPayment{Pending: true, Reason: PaymentUnknown, Plan: plan}
	if pu.ExpiresAt > 0 {
		pp.ExpiresAt = time.Unix(pu.ExpiresAt, 0).UTC().Format(time.RFC3339)
	}
	for _, it := range pu.SubscriptionItems {
		if p, _ := it.Price.planAndInterval(); pp.Plan == "" && p != "" {
			pp.Plan = p
		}
	}
	var inv struct {
		ID               string `json:"id"`
		Status           string `json:"status"`
		HostedInvoiceURL string `json:"hosted_invoice_url"`
	}
	var invoiceID string
	if json.Unmarshal(rawInvoice, &invoiceID) == nil && invoiceID != "" {
		if err := s.stripe.Call(ctx, http.MethodGet, "/v1/invoices/"+url.PathEscape(invoiceID), nil, "", &inv); err != nil {
			s.log.WarnContext(ctx, "reading a pending update's invoice failed", "error", err)
			return pp
		}
	} else if json.Unmarshal(rawInvoice, &inv) != nil || inv.ID == "" {
		s.log.WarnContext(ctx, "a pending update without a readable invoice")
		return pp
	}
	if inv.Status == "open" && safeStripeURL(inv.HostedInvoiceURL) {
		pp.PayURL = inv.HostedInvoiceURL
	}
	if inv.Status == "paid" { // paid, the change not applied yet
		pp.Reason = PaymentProcessing
		return pp
	}
	piID := s.invoicePaymentIntent(ctx, inv.ID)
	if piID == "" {
		return pp
	}
	var pi struct {
		Status           string `json:"status"`
		LastPaymentError *struct {
			Code        string `json:"code"`
			DeclineCode string `json:"decline_code"`
		} `json:"last_payment_error"`
	}
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/payment_intents/"+url.PathEscape(piID), nil, "", &pi); err != nil {
		s.log.WarnContext(ctx, "reading a pending update's payment failed", "error", err)
		return pp
	}
	code, decline := "", ""
	if e := pi.LastPaymentError; e != nil {
		code, decline = e.Code, e.DeclineCode
	}
	pp.DeclineCode = or(decline, code)
	pp.Reason = paymentReason(pi.Status, code, decline)
	return pp
}

// invoicePaymentIntent is the payment intent of an invoice's default payment, "" if none (or unreadable).
func (s *Service) invoicePaymentIntent(ctx context.Context, invoiceID string) string {
	var payments list[struct {
		IsDefault bool `json:"is_default"`
		Payment   struct {
			Type          string `json:"type"`
			PaymentIntent string `json:"payment_intent"`
		} `json:"payment"`
	}]
	form := url.Values{"invoice": {invoiceID}, "limit": {"10"}}
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/invoice_payments", form, "", &payments); err != nil {
		s.log.WarnContext(ctx, "reading an invoice's payments failed", "error", err)
		return ""
	}
	id := ""
	for _, p := range payments.Data {
		if p.Payment.Type != "payment_intent" || p.Payment.PaymentIntent == "" {
			continue
		}
		if p.IsDefault {
			return p.Payment.PaymentIntent
		}
		if id == "" {
			id = p.Payment.PaymentIntent
		}
	}
	return id
}

// paymentReason maps a payment intent's status and last error onto a PendingPayment reason.
func paymentReason(status, code, decline string) string {
	is := func(v ...string) bool {
		for _, x := range v {
			if code == x || decline == x {
				return true
			}
		}
		return false
	}
	switch {
	case status == "succeeded" || status == "processing":
		return PaymentProcessing
	case status == "requires_action" || status == "requires_confirmation" || is("authentication_required"):
		return PaymentAuthRequired
	case decline == "insufficient_funds":
		return PaymentInsufficientFunds
	case is("expired_card"):
		return PaymentExpiredCard
	case is("incorrect_cvc", "incorrect_number", "invalid_cvc", "invalid_expiry_month", "invalid_expiry_year", "incorrect_zip"):
		return PaymentIncorrectDetails
	case status == "requires_payment_method" || code == "card_declined" || decline != "":
		return PaymentDeclined
	}
	return PaymentUnknown
}

// safeStripeURL: an https link on a Stripe host, so the app only ever sends people to Stripe's own pages from it.
func safeStripeURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return false
	}
	h := u.Hostname()
	return h == "stripe.com" || strings.HasSuffix(h, ".stripe.com")
}
