package billing

import (
	"context"
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/store"
)

func TestCheckoutHoldsNoBillingLockWhileStripeAnswers(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.stripe.mu.Lock()
	e.stripe.held, e.stripe.reached, e.stripe.resume = "POST /v1/checkout/sessions", make(chan struct{}), make(chan struct{})
	e.stripe.mu.Unlock()

	done := make(chan int, 1)
	go func() {
		code, _ := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"})
		done <- code
	}()
	select {
	case <-e.stripe.reached:
	case <-time.After(5 * time.Second):
		t.Fatal("checkout did not reach Stripe")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := e.st.Tx(ctx, func(q store.Q) error { return q.LockBilling(ctx, owner.workspace) })
	close(e.stripe.resume)
	if err != nil {
		t.Fatalf("billing lock held while Stripe created the Checkout session: %v", err)
	}
	if code := <-done; code != http.StatusOK {
		t.Fatalf("checkout: %d", code)
	}
}
