package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// stripeVersion pins the shape of every answer: the subscription's discounts, the promotion code's
// promotion.coupon, the invoice's parent.subscription_details, the item's current_period_end.
const stripeVersion = "2026-09-30.endive"

// stripeRetries: how often a request Stripe asks to repeat is sent again (see Call), and the pause before each
// attempt, doubled every time.
const (
	stripeRetries    = 3
	stripeRetryPause = 300 * time.Millisecond
)

// StripeClient is the few Stripe API calls billing needs, form-encoded over net/http: no SDK for a handful
// of endpoints (docs/billing-contract.md).
type StripeClient struct {
	key, base string
	http      *http.Client
}

func NewStripeClient(key, base string) *StripeClient {
	return &StripeClient{key: key, base: base, http: &http.Client{}}
}

// StripeError is Stripe's answer to a refused call.
type StripeError struct {
	Status                     int
	Type, Code, Message, Param string
	retry                      bool // Stripe says the request may be sent again
}

func (e *StripeError) Error() string {
	return fmt.Sprintf("stripe %d %s/%s: %s", e.Status, e.Type, e.Code, e.Message)
}

// Call sends one request; idempotencyKey may be empty. A 2xx answer is decoded into out (when non-nil). A request
// Stripe did not process and says may be sent again is retried, within the call's 20 s: Stripe-Should-Retry: true,
// else a 429 (rate limit, or lock_timeout), and a 409 idempotency_key_in_use (the same key still in flight). Never a
// network error or another 5xx: Stripe may have done it.
func (c *StripeClient) Call(ctx context.Context, method, path string, form url.Values, idempotencyKey string, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	for attempt := 0; ; attempt++ {
		raw, err := c.once(ctx, method, path, form, idempotencyKey)
		var se *StripeError
		if errors.As(err, &se) && se.retry && attempt < stripeRetries {
			select {
			case <-ctx.Done():
			case <-time.After(stripeRetryPause << attempt):
				continue
			}
		}
		if err != nil || out == nil {
			return err
		}
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("stripe %s %s: %w", method, path, err)
		}
		return nil
	}
}

// once sends one request: the body of a 2xx answer, else a *StripeError that says whether it may be sent again.
func (c *StripeClient) once(ctx context.Context, method, path string, form url.Values, idempotencyKey string) ([]byte, error) {
	target := c.base + path
	var body io.Reader
	if method == http.MethodGet || method == http.MethodDelete {
		if len(form) > 0 {
			target += "?" + form.Encode()
		}
	} else {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, fmt.Errorf("stripe: %w", err)
	}
	req.SetBasicAuth(c.key, "")
	req.Header.Set("Stripe-Version", stripeVersion)
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("stripe %s %s: %w", method, path, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("stripe %s %s: %w", method, path, err)
	}
	if res.StatusCode < 300 {
		return raw, nil
	}
	var e struct {
		Error struct{ Type, Code, Message, Param string } `json:"error"`
	}
	_ = json.Unmarshal(raw, &e) // a body that isn't Stripe's error shape still fails with its status
	se := &StripeError{Status: res.StatusCode, Type: e.Error.Type, Code: e.Error.Code, Message: e.Error.Message, Param: e.Error.Param}
	se.retry = res.StatusCode == http.StatusTooManyRequests
	if h := res.Header.Get("Stripe-Should-Retry"); h != "" {
		se.retry = h == "true"
	}
	se.retry = se.retry || (res.StatusCode == http.StatusConflict && se.Code == "idempotency_key_in_use")
	return nil, se
}

// subscription is the part of a Stripe subscription billing reads.
type subscription struct {
	ID                string            `json:"id"`
	Status            string            `json:"status"`
	Customer          string            `json:"customer"`
	CurrentPeriodEnd  int64             `json:"current_period_end"`
	TrialStart        *int64            `json:"trial_start"`
	TrialEnd          *int64            `json:"trial_end"`
	CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
	CancelAt          *int64            `json:"cancel_at"`
	Currency          string            `json:"currency"`
	Metadata          map[string]string `json:"metadata"`
	Discounts         []stripeDiscount  `json:"discounts"` // expanded (subscriptionExpand)
	// LatestInvoice: an id, or the invoice when expanded (subscriptionExpand), which tells an unpaid renewal.
	LatestInvoice       json.RawMessage `json:"latest_invoice"`
	CancellationDetails struct {
		Reason string `json:"reason"` // cancellation_requested, payment_disputed, payment_failed
	} `json:"cancellation_details"`
	PendingUpdate *pendingUpdate `json:"pending_update"` // a change waiting for its payment; nil when none
	Schedule      *string        `json:"schedule"`       // the subscription schedule holding a change for the period's end
	// DefaultPaymentMethod: an id, or the payment method when expanded (subscriptionExpand), whose card fingerprint
	// recognises a customer starting a second trial.
	DefaultPaymentMethod json.RawMessage `json:"default_payment_method"`
	Items                struct {
		Data []struct {
			ID                 string `json:"id"`
			CurrentPeriodStart int64  `json:"current_period_start"`
			CurrentPeriodEnd   int64  `json:"current_period_end"` // where newer API versions keep it
			Price              price  `json:"price"`
			Quantity           int64  `json:"quantity"`
		} `json:"data"`
	} `json:"items"`
}

type stripeDiscount struct {
	Source struct {
		Coupon stripeCoupon `json:"coupon"` // expanded
	} `json:"source"`
	PromotionCode json.RawMessage `json:"promotion_code"` // an id, or the object when expanded
	End           *int64          `json:"end"`
}

type stripeCoupon struct {
	ID               string    `json:"id"`
	PercentOff       *float64  `json:"percent_off"`
	AmountOff        *int64    `json:"amount_off"`
	Currency         *string   `json:"currency"`
	Duration         string    `json:"duration"`
	DurationInMonths *int      `json:"duration_in_months"`
	Valid            *bool     `json:"valid"`
	AppliesTo        *struct { // only when expanded
		Products []string `json:"products"`
	} `json:"applies_to"`
	// CurrencyOptions are an amount-off coupon's amounts in its other currencies (when expanded).
	CurrencyOptions map[string]struct {
		AmountOff int64 `json:"amount_off"`
	} `json:"currency_options"`
}

// amountIn is what the coupon takes off in cur (0 for a percent-off coupon), and whether it can be used there at
// all: Stripe refuses an amount-off coupon on a payment in a currency it has no amount for.
func (c stripeCoupon) amountIn(cur string) (int64, bool) {
	switch {
	case c.AmountOff == nil || *c.AmountOff == 0:
		return 0, true
	case c.Currency != nil && *c.Currency == cur:
		return *c.AmountOff, true
	}
	o, ok := c.CurrencyOptions[cur]
	return o.AmountOff, ok && o.AmountOff > 0
}

type promotionCode struct {
	ID             string `json:"id"`
	Code           string `json:"code"`
	Active         bool   `json:"active"`
	ExpiresAt      *int64 `json:"expires_at"`
	MaxRedemptions int    `json:"max_redemptions"`
	TimesRedeemed  int    `json:"times_redeemed"`
	Promotion      struct {
		Coupon string `json:"coupon"` // the coupon's id
	} `json:"promotion"`
}

func (s subscription) priceID() string {
	if len(s.Items.Data) == 0 {
		return ""
	}
	return s.Items.Data[0].Price.ID
}

func (s subscription) price() price {
	if len(s.Items.Data) == 0 {
		return price{}
	}
	return s.Items.Data[0].Price
}

// schedule is the id of the subscription's schedule, "" when it has none.
func (s subscription) schedule() string {
	if s.Schedule == nil {
		return ""
	}
	return *s.Schedule
}

// cardFingerprint is the fingerprint Stripe gives the default payment method's card (expanded), "" when unknown.
func (s subscription) cardFingerprint() string {
	var pm struct {
		Card struct {
			Fingerprint string `json:"fingerprint"`
		} `json:"card"`
	}
	_ = json.Unmarshal(s.DefaultPaymentMethod, &pm) // an id (not expanded) or null leaves it empty
	return pm.Card.Fingerprint
}

func (s subscription) quantity() int64 {
	if len(s.Items.Data) == 0 {
		return 0
	}
	return s.Items.Data[0].Quantity
}

func (s subscription) periodEnd() int64 {
	if s.CurrentPeriodEnd == 0 && len(s.Items.Data) > 0 {
		return s.Items.Data[0].CurrentPeriodEnd
	}
	return s.CurrentPeriodEnd
}

// periodStart: when the current period began, kept on the item (0 when Stripe didn't say).
func (s subscription) periodStart() int64 {
	if len(s.Items.Data) == 0 {
		return 0
	}
	return s.Items.Data[0].CurrentPeriodStart
}

// unpaidRenewal: the latest invoice (expanded) is a renewal's and still open, so the current period isn't paid for.
func (s subscription) unpaidRenewal() bool {
	var inv struct {
		Status        string `json:"status"`
		BillingReason string `json:"billing_reason"`
	}
	return json.Unmarshal(s.LatestInvoice, &inv) == nil && inv.BillingReason == "subscription_cycle" && inv.Status == "open"
}

type price struct {
	ID         string            `json:"id"`
	Currency   string            `json:"currency"`
	UnitAmount int64             `json:"unit_amount"`
	LookupKey  string            `json:"lookup_key"`
	Product    string            `json:"product"`
	Metadata   map[string]string `json:"metadata"`
	// CurrencyOptions are the price in other currencies (EUR, USD), when read with expand[]=data.currency_options.
	CurrencyOptions map[string]struct {
		UnitAmount int64 `json:"unit_amount"`
	} `json:"currency_options"`
}

// perSeat: the price is billed per seat (its metadata says so); else it is an earlier flat price.
func (p price) perSeat() bool { return p.Metadata[PricingKey] == PerSeat }

// planAndInterval is the plan and interval a price was made for: its metadata (kept after the catalogue tool moves
// the lookup key to a newer price), else its lookup key.
func (p price) planAndInterval() (plan, interval string) {
	if plan, interval = p.Metadata["helvetly_plan"], p.Metadata["helvetly_interval"]; planNames[plan] != "" && (interval == "month" || interval == "year") {
		return plan, interval
	}
	return planOfKey(p.LookupKey)
}

type invoice struct {
	ID               string `json:"id"`
	Number           string `json:"number"`
	Created          int64  `json:"created"`
	Total            int64  `json:"total"`
	Currency         string `json:"currency"`
	Status           string `json:"status"`
	HostedInvoiceURL string `json:"hosted_invoice_url"`
	InvoicePDF       string `json:"invoice_pdf"`
}

type paymentMethod struct {
	Card struct {
		Brand    string `json:"brand"`
		Last4    string `json:"last4"`
		ExpMonth int    `json:"exp_month"`
		ExpYear  int    `json:"exp_year"`
	} `json:"card"`
}

type list[T any] struct {
	Data    []T  `json:"data"`
	HasMore bool `json:"has_more"`
}
