package billing

import (
	"context"
	"net/http"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// TestFeatureOverrides: an operator's value of a feature or limit counts like the plan that has it, at every gate
// (Require, the store's feature gate the jobs and portal read, the billing payload the platform locks by), with the
// features it requires, and ends when it expires or is cleared.
func TestFeatureOverrides(t *testing.T) {
	ctx := context.Background()
	hour := time.Hour
	domain, portal := Limit(store.FeatureCustomPortalDomain), Limit(store.FeatureClientPortal)
	for _, tt := range []struct {
		name    string
		price   string                  // the plan first subscribed to
		set     func(e *env, ws string) // the operator's values, and any later change of plan or clock
		feature Feature
		allowed bool
	}{
		{"plan without it: refused", "price_pm", func(*env, string) {}, store.FeatureCustomPortalDomain, false},
		{"override on: allowed", "price_pm", func(e *env, ws string) {
			e.override(ws, domain, StateEnabled, nil, nil)
		}, store.FeatureCustomPortalDomain, true},
		{"override on: the portal it requires opens too", "price_pm", func(e *env, ws string) {
			e.override(ws, domain, StateEnabled, nil, nil)
		}, store.FeatureClientPortal, true},
		{"override until later: allowed", "price_pm", func(e *env, ws string) {
			end := e.svc.now().Add(hour)
			e.override(ws, domain, StateEnabled, nil, &end)
		}, store.FeatureCustomPortalDomain, true},
		{"override expired: refused", "price_pm", func(e *env, ws string) {
			end, now := e.svc.now().Add(hour), e.svc.now()
			e.override(ws, domain, StateEnabled, nil, &end)
			e.svc.now = func() time.Time { return now.Add(2 * hour) }
		}, store.FeatureCustomPortalDomain, false},
		{"override expired: the portal it opened closes", "price_pm", func(e *env, ws string) {
			end, now := e.svc.now().Add(hour), e.svc.now()
			e.override(ws, domain, StateEnabled, nil, &end)
			e.svc.now = func() time.Time { return now.Add(2 * hour) }
		}, store.FeatureClientPortal, false},
		{"override cleared: refused", "price_pm", func(e *env, ws string) {
			e.override(ws, domain, StateEnabled, nil, nil)
			e.clearOverride(ws, domain)
		}, store.FeatureCustomPortalDomain, false},
		{"downgrade with the override: still allowed", "price_xm", func(e *env, ws string) {
			e.override(ws, domain, StateEnabled, nil, nil)
			e.subscribe(ws, "price_pm")
		}, store.FeatureCustomPortalDomain, true},
		{"downgrade without one: refused", "price_xm", func(e *env, ws string) {
			e.subscribe(ws, "price_pm")
		}, store.FeatureCustomPortalDomain, false},
		{"the required feature turned off by its own override: refused", "price_pm", func(e *env, ws string) {
			e.override(ws, domain, StateEnabled, nil, nil)
			e.override(ws, portal, StateDisabled, nil, nil)
		}, store.FeatureCustomPortalDomain, false},
		{"override off on a plan with it: refused", "price_xm", func(e *env, ws string) {
			e.override(ws, domain, StateDisabled, nil, nil)
		}, store.FeatureCustomPortalDomain, false},
		{"employees on Pro by override", "price_pm", func(e *env, ws string) {
			e.override(ws, Limit(store.FeatureEmployees), StateEnabled, nil, nil)
		}, store.FeatureEmployees, true},
		{"document approvals on Pro by override", "price_pm", func(e *env, ws string) {
			e.override(ws, Limit(store.FeatureDocumentApprovals), StateEnabled, nil, nil)
		}, store.FeatureDocumentApprovals, true},
		{"invoice corrections on Basic by override", "price_bm", func(e *env, ws string) {
			e.override(ws, Limit(store.FeatureInvoiceCorrections), StateEnabled, nil, nil)
		}, store.FeatureInvoiceCorrections, true},
		{"an allowance alone opens no feature", "price_bm", func(e *env, ws string) {
			e.override(ws, Signatures, StateLimited, n64(20), nil)
		}, store.FeatureSimpleSignatures, false},
		{"signatures on Basic by override", "price_bm", func(e *env, ws string) {
			e.override(ws, Limit(store.FeatureSimpleSignatures), StateEnabled, nil, nil)
		}, store.FeatureSimpleSignatures, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			e := newEnv(t, true)
			e.st.SetFeatureGate(e.svc.RequireFeature)
			b := e.workspace()
			e.subscribe(b.workspace, tt.price)
			tt.set(e, b.workspace)

			err := e.svc.Require(ctx, e.st.Q, b.workspace, tt.feature)
			if status, code, _, _ := auth.Describe(err); tt.allowed != (err == nil) || !tt.allowed && (status != http.StatusForbidden || code != "feature_not_in_plan") {
				t.Fatalf("Require: %v, want allowed %v", err, tt.allowed)
			}
			if ok, err := e.st.FeatureAllowed(ctx, b.workspace, string(tt.feature)); err != nil || ok != tt.allowed {
				t.Fatalf("FeatureAllowed: %v %v, want %v", ok, err, tt.allowed)
			}
			_, body := e.do(b, http.MethodGet, "/api/v1/billing", nil)
			features, _ := body["data"].(map[string]any)["features"].([]any)
			if slices.Contains(features, any(string(tt.feature))) != tt.allowed {
				t.Fatalf("payload features %v, want %s allowed %v", features, tt.feature, tt.allowed)
			}
		})
	}
}

// TestLimitOverrides: an operator's value of a limit replaces the plan's at the caps admission and the payload read,
// and ends with it.
func TestLimitOverrides(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_pm")
	plan := mustRights(t, e, b.workspace).Items[string(Invoices)].Value

	e.override(b.workspace, Invoices, StateLimited, n64(plan+500), nil)
	if r := mustRights(t, e, b.workspace); r.Items[string(Invoices)].Value != plan+500 {
		t.Fatalf("raised: %+v", r.Items[string(Invoices)])
	}
	if err := e.svc.AllowResource(context.Background(), e.st.Q, b.workspace, string(Invoices), plan+1); err != nil {
		t.Fatalf("admission above the plan's cap with the override: %v", err)
	}
	_, body := e.do(b, http.MethodGet, "/api/v1/billing", nil)
	for _, u := range body["data"].(map[string]any)["entitlements"].([]any) {
		if u := u.(map[string]any); u["key"] == string(Invoices) && u["value"] != float64(plan+500) {
			t.Fatalf("payload: %v", u)
		}
	}

	e.clearOverride(b.workspace, Invoices)
	if err := e.svc.AllowResource(context.Background(), e.st.Q, b.workspace, string(Invoices), plan+1); err == nil {
		t.Fatal("admission above the plan's cap after the override was cleared")
	}
}
