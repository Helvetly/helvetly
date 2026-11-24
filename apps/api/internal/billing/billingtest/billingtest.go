// Package billingtest wires a test store to billing as main does, with billing on: the plan features and quota
// admission of the offer the migrations seed, for tests of the packages whose writes, imports and jobs they gate.
package billingtest

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"helvetly.com/api/internal/billing"
	"helvetly.com/api/internal/config"
	"helvetly.com/api/internal/store"
)

// Wire gives st billing's feature gate and quota admission; a workspace without a paid plan (On) is on Free.
func Wire(t testing.TB, st *store.Store) *billing.Service {
	t.Helper()
	cfg := config.Config{Stripe: config.Stripe{SecretKey: "sk_test_billingtest"}} // never called: no checkout here
	svc, err := billing.New(context.Background(), st, nil, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	st.SetAdmission(svc.AllowResource)
	st.SetFeatureGate(svc.RequireFeature)
	st.SetAutomationWait(svc.AutomationWaits)
	return svc
}

// On puts the workspace on plan (billing.Basic, Pro or Business) of the current offer, paid for a month, with one
// seat; called again it changes the plan, as a downgrade or an upgrade that took effect.
func On(t testing.TB, st *store.Store, workspaceID, plan string) {
	t.Helper()
	end := time.Now().Add(30 * 24 * time.Hour)
	sub := store.Subscription{ID: "sub_" + workspaceID, Status: "active", Plan: plan, Interval: "month", CurrentPeriodEnd: &end,
		PerSeat: true, Seats: 1, PlanExpiresAt: &end}
	if err := st.ApplySubscription(context.Background(), workspaceID, "cus_"+workspaceID, sub, time.Now()); err != nil {
		t.Fatal(err)
	}
}

// Without takes feature away from the workspace (an operator's override), for a test of what a plan without it does
// now that every plan has it (scheduling).
func Without(t testing.TB, st *store.Store, workspaceID, feature string) {
	t.Helper()
	w := store.WorkspaceLimit{WorkspaceID: workspaceID, Key: feature, State: billing.StateDisabled, Reason: "test: a plan without " + feature}
	if err := billing.SetWorkspaceOverride(context.Background(), st, w, "test", time.Now()); err != nil {
		t.Fatal(err)
	}
}
