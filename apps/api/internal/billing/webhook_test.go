package billing

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestDelayedSubscriptionReadCannotRestoreAnOldPlan(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	ctx := context.Background()
	e.stripe.put("sub_1", b.workspace, "cus_1", "active", "price_pm")
	var delayed subscription
	if err := e.svc.stripe.Call(ctx, http.MethodGet, "/v1/subscriptions/sub_1", nil, "", &delayed); err != nil {
		t.Fatal(err)
	}
	// A second delivery observes cancellation while the first handler still holds the old response.
	e.stripe.put("sub_1", b.workspace, "cus_1", "canceled", "price_pm")
	e.event("evt_canceled", "customer.subscription.deleted", map[string]any{"id": "sub_1"})
	if err := e.svc.apply(ctx, delayed, event{ID: "evt_delayed", Type: "customer.subscription.updated"}); err != nil {
		t.Fatal(err)
	}
	got, err := e.st.WorkspaceBilling(ctx, b.workspace)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "canceled" || PlanOf(got, time.Now()) != "" {
		t.Fatalf("stale delivery restored canceled plan: %+v", got)
	}
}
