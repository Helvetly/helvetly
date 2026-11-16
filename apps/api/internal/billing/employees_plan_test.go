package billing

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// The Employees module is on the Business plan only, with no employee cap, and a Business trial includes it like
// Business's other features; Basic and Pro answer 403 feature_not_in_plan naming Business.
func TestEmployeesOnBusinessOnly(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	basic, pro, business, trial := e.workspace().workspace, e.workspace().workspace, e.workspace().workspace, e.workspace().workspace
	e.subscribe(basic, "price_bm")
	e.subscribe(pro, "price_pm")
	e.subscribe(business, "price_xm")
	e.trialing(trial, "fp_employees", time.Now())
	for _, c := range []struct {
		name, ws string
		allowed  bool
	}{{"basic", basic, false}, {"pro", pro, false}, {"business", business, true}, {"pro trial", trial, false}} {
		err := e.svc.Require(ctx, e.st.Q, c.ws, store.FeatureEmployees)
		if c.allowed {
			if err != nil {
				t.Errorf("%s: %v", c.name, err)
			}
			continue
		}
		status, code, msg, ok := auth.Describe(err)
		if !ok || status != http.StatusForbidden || code != "feature_not_in_plan" || !strings.Contains(msg, "Upgrade to Business") {
			t.Errorf("%s: %d %s %q", c.name, status, code, msg)
		}
		if !errors.Is(e.svc.RequireFeature(ctx, e.st.Q, c.ws, store.FeatureEmployees), store.ErrFeatureDenied) {
			t.Errorf("%s: the store gate does not report a denial", c.name)
		}
	}
	for key, l := range mustRights(t, e, business).Items {
		if l.Kind != KindAccess && strings.HasPrefix(key, "employee") {
			t.Fatalf("employees are capped by %s", key)
		}
	}
}
