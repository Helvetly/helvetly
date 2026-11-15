package vatreturn

import (
	"context"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

// TestTickWaitsForAPlanWithVATReturns: on Basic the period's reminder is not raised; on Pro the next tick raises it.
func TestTickWaitsForAPlanWithVATReturns(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	owner := e.workspace()
	if err := e.st.SaveVATReturnSettings(ctx, owner.workspace, e.userOf(owner), store.DefaultVATReturnSettings, time.Now()); err != nil {
		t.Fatal(err)
	}
	billingtest.Wire(t, e.st)
	billingtest.On(t, e.st, owner.workspace, billing.Basic)
	svc := New(e.st, nil)
	day := time.Date(2026, 10, 2, 9, 0, 0, 0, time.UTC)
	count := func() int {
		t.Helper()
		got, err := e.st.Notifications(ctx, owner.workspace, e.userOf(owner), store.NotificationFilter{Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		return len(got)
	}
	if err := svc.Tick(ctx, day); err != nil {
		t.Fatal(err)
	}
	if n := count(); n != 0 {
		t.Fatalf("Basic: %d notifications, want 0", n)
	}
	billingtest.On(t, e.st, owner.workspace, billing.Pro)
	if err := svc.Tick(ctx, day.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if n := count(); n != 1 {
		t.Fatalf("Pro: %d notifications, want 1", n)
	}
}
