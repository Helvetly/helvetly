package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// stripeVersion pins the shape of every answer (current_period_end on the subscription, among others).
const stripeVersion = "2024-06-20"

// managedPaymentsVersion is the oldest version Stripe accepts Managed Payments on; only those Checkout calls use it,
// and billing reads nothing but the session's url from their answer.
const managedPaymentsVersion = "2025-03-31.basil"

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
}

func (e *StripeError) Error() string {
	return fmt.Sprintf("stripe %d %s/%s: %s", e.Status, e.Type, e.Code, e.Message)
}

// call sends one request; idempotencyKey may be empty. A 2xx answer is decoded into out (when non-nil).
func (c *StripeClient) Call(ctx context.Context, method, path string, form url.Values, idempotencyKey string, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
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
		return fmt.Errorf("stripe: %w", err)
	}
	req.SetBasicAuth(c.key, "")
	version := stripeVersion
	if form.Get("managed_payments[enabled]") == "true" {
		version = managedPaymentsVersion
	}
	req.Header.Set("Stripe-Version", version)
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("stripe %s %s: %w", method, path, err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return fmt.Errorf("stripe %s %s: %w", method, path, err)
	}
	if res.StatusCode >= 300 {
		var e struct {
			Error struct{ Type, Code, Message, Param string } `json:"error"`
		}
		_ = json.Unmarshal(raw, &e) // a body that isn't Stripe's error shape still fails with its status
		return &StripeError{Status: res.StatusCode, Type: e.Error.Type, Code: e.Error.Code, Message: e.Error.Message, Param: e.Error.Param}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("stripe %s %s: %w", method, path, err)
	}
	return nil
}

// subscription is the part of a Stripe subscription billing reads.
type subscription struct {
	ID                string            `json:"id"`
	Status            string            `json:"status"`
	Customer          string            `json:"customer"`
	CurrentPeriodEnd  int64             `json:"current_period_end"`
	TrialEnd          *int64            `json:"trial_end"`
	CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
	CancelAt          *int64            `json:"cancel_at"`
	Metadata          map[string]string `json:"metadata"`
	Discount          *stripeDiscount   `json:"discount"`
	Items             struct {
		Data []struct {
			ID               string `json:"id"`
			CurrentPeriodEnd int64  `json:"current_period_end"` // where newer API versions keep it
			Price            price  `json:"price"`
			Quantity         int64  `json:"quantity"`
		} `json:"data"`
	} `json:"items"`
}

type stripeDiscount struct {
	Coupon        stripeCoupon    `json:"coupon"`
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
}

type promotionCode struct {
	ID             string       `json:"id"`
	Code           string       `json:"code"`
	Active         bool         `json:"active"`
	ExpiresAt      *int64       `json:"expires_at"`
	MaxRedemptions int          `json:"max_redemptions"`
	TimesRedeemed  int          `json:"times_redeemed"`
	Coupon         stripeCoupon `json:"coupon"`
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
