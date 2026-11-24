package billing

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"helvetly.com/api/internal/auth"
)

func TestIncludes(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	cat, err := currentCatalogue(ctx, e.st.Q)
	if err != nil {
		t.Fatal(err)
	}
	// api_access as the offer gives it: a change there has to change this too.
	for plan, want := range map[string]bool{"": false, Basic: false, Pro: true, Business: true} {
		if got := cat.includes(plan, APIAccess); got != want {
			t.Errorf("includes(%q, api_access) = %v, want %v", plan, got, want)
		}
	}
	for from, want := range map[string]string{"": Pro, Basic: Pro, Pro: Business, Business: ""} {
		if got := cat.cheapestWith(APIAccess, from); got != want {
			t.Errorf("cheapestWith(api_access, %q) = %q, want %q", from, got, want)
		}
	}
	// A newly published offer is the catalogue at once.
	e.setPlanValue(Pro, Limit(APIAccess), StateDisabled, nil)
	if cat, err = currentCatalogue(ctx, e.st.Q); err != nil || cat.includes(Pro, APIAccess) || cat.cheapestWith(APIAccess, Basic) != Business {
		t.Fatalf("pro without api_access in the new offer: %v", err)
	}
}

func TestRequire(t *testing.T) {
	ctx := context.Background()
	t.Run("billing off allows every feature", func(t *testing.T) {
		e := newEnv(t, false)
		ws := e.workspace().workspace
		all, err := allFeatures(ctx, e.st.Q)
		if err != nil || len(all) != 43 {
			t.Fatalf("features: %v %v", all, err)
		}
		for _, f := range all {
			if err := e.svc.Require(ctx, e.st.Q, ws, f); err != nil {
				t.Fatalf("%s: %v", f, err)
			}
		}
	})
	e := newEnv(t, true)
	none, basic, pro := e.workspace().workspace, e.workspace().workspace, e.workspace().workspace
	e.subscribe(basic, "price_bm")
	e.subscribe(pro, "price_pm")
	if _, code, _, _ := auth.Describe(e.svc.Require(ctx, e.st.Q, none, APIAccess)); code != "plan_required" { // Free: no API tokens
		t.Fatalf("no plan: %v", code)
	}
	if err := e.svc.Require(ctx, e.st.Q, pro, APIAccess); err != nil {
		t.Fatalf("pro: %v", err)
	}
	err := e.svc.Require(ctx, e.st.Q, basic, APIAccess)
	if status, code, _, ok := auth.Describe(err); !ok || status != http.StatusPaymentRequired || code != "plan_required" {
		t.Fatalf("basic: %v", err)
	}
	// The workspace's offer is the source of truth: on an offer that switches the values the answer flips at once.
	e.setPlanValue(Pro, Limit(APIAccess), StateDisabled, nil)
	e.setPlanValue(Basic, Limit(APIAccess), StateEnabled, nil)
	if status, _, _, ok := auth.Describe(e.svc.Require(ctx, e.st.Q, pro, APIAccess)); !ok || status != http.StatusPaymentRequired {
		t.Fatal("pro still has api_access after its value was switched off")
	}
	if err := e.svc.Require(ctx, e.st.Q, basic, APIAccess); err != nil {
		t.Fatalf("basic after its value was switched on: %v", err)
	}
}

func TestGuardFeatures(t *testing.T) {
	refused := func(t *testing.T, e *env, b *browser) map[string]any {
		t.Helper()
		code, body := e.do(b, http.MethodPost, "/api/v1/account/tokens", map[string]any{})
		if code == http.StatusPaymentRequired {
			errBody, _ := body["error"].(map[string]any)
			return errBody
		}
		if code != http.StatusUnprocessableEntity { // past the guard: the real handler refuses the empty body
			t.Fatalf("token create: %d %v", code, body)
		}
		return nil
	}
	t.Run("billing off", func(t *testing.T) {
		e := newEnv(t, false)
		if got := refused(t, e, e.workspace()); got != nil {
			t.Fatalf("refused without billing: %v", got)
		}
	})
	e := newEnv(t, true)
	basic, pro := e.workspace(), e.workspace()
	e.subscribe(basic.workspace, "price_bm")
	e.subscribe(pro.workspace, "price_pm")
	got := refused(t, e, basic)
	details, _ := got["details"].(map[string]any)
	if got["code"] != "plan_required" || details["feature"] != string(APIAccess) || details["required_plan"] != Pro || details["plan"] != Basic {
		t.Fatalf("basic: %v", got)
	}
	if got := refused(t, e, pro); got != nil {
		t.Fatalf("pro refused: %v", got)
	}
}

func TestOverviewFeatures(t *testing.T) {
	features := func(t *testing.T, e *env, b *browser) (own []any, plans map[string][]any) {
		t.Helper()
		code, body := e.do(b, http.MethodGet, "/api/v1/billing", nil)
		data, _ := body["data"].(map[string]any)
		if code != http.StatusOK || data == nil {
			t.Fatalf("overview: %d %v", code, body)
		}
		own, _ = data["features"].([]any)
		list, _ := data["plans"].([]any)
		plans = map[string][]any{}
		for _, p := range list {
			p, _ := p.(map[string]any)
			id, _ := p["id"].(string)
			plans[id], _ = p["features"].([]any)
		}
		return own, plans
	}
	t.Run("billing off", func(t *testing.T) {
		e := newEnv(t, false)
		if own, _ := features(t, e, e.workspace()); len(own) != 43 {
			t.Fatalf("features without billing: %v", own)
		}
	})
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	own, plans := features(t, e, b)
	cat, err := currentCatalogue(context.Background(), e.st.Q)
	if err != nil {
		t.Fatal(err)
	}
	if len(own) != len(cat.featuresOf(Basic)) || slices.Contains(own, any(string(APIAccess))) || !slices.Contains(own, any("swiss_qr")) {
		t.Fatalf("basic workspace features: %v", own)
	}
	if slices.Contains(plans[Basic], any(string(APIAccess))) || !slices.Contains(plans[Pro], any(string(APIAccess))) ||
		slices.Contains(plans[Pro], any("client_portal")) || !slices.Contains(plans[Business], any("client_portal")) {
		t.Fatalf("plan features: %v", plans)
	}
}

func TestWorkspaceLimits(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	basic, pro, other := e.workspace(), e.workspace(), e.workspace()
	e.subscribe(basic.workspace, "price_bm")
	e.subscribe(pro.workspace, "price_pm")
	e.subscribe(other.workspace, "price_bm")
	allowed := func(ws string) bool { return e.svc.Require(ctx, e.st.Q, ws, APIAccess) == nil }

	// A workspace's own value replaces its plan's, for a feature either way.
	e.override(basic.workspace, Limit(APIAccess), StateEnabled, nil, nil)
	e.override(pro.workspace, Limit(APIAccess), StateDisabled, nil, nil)
	if !allowed(basic.workspace) || allowed(pro.workspace) || allowed(other.workspace) {
		t.Fatalf("feature overrides: basic %v, pro %v, other basic %v", allowed(basic.workspace), allowed(pro.workspace), allowed(other.workspace))
	}
	if code, body := e.do(basic, http.MethodPost, "/api/v1/account/tokens", map[string]any{}); code != http.StatusUnprocessableEntity {
		t.Fatalf("guard ignored the override: %d %v", code, body)
	}

	// A numeric limit: Basic has 25 catalogue entries; an override of 1 refuses the second, and only here.
	e.override(basic.workspace, Products, StateLimited, n64(1), nil)
	e.exec(`INSERT INTO products (id, workspace_id, type, name, price_basis, unit_price, currency, vat_category, vat_rate,
		created_at, updated_at) VALUES ('prd_w', $1, 'service', 'S', 'net', 100, 'CHF', 'S', 810, now(), now())`, basic.workspace)
	if code, body := e.do(basic, http.MethodPost, "/api/v1/products", map[string]any{}); code != http.StatusPaymentRequired {
		t.Fatalf("numeric override: %d %v", code, body)
	}
	e.exec(`INSERT INTO products (id, workspace_id, type, name, price_basis, unit_price, currency, vat_category, vat_rate,
		created_at, updated_at) VALUES ('prd_o', $1, 'service', 'S', 'net', 100, 'CHF', 'S', 810, now(), now())`, other.workspace)
	if code, body := e.do(other, http.MethodPost, "/api/v1/products", map[string]any{}); code != http.StatusCreated {
		t.Fatalf("another workspace got the override: %d %v", code, body)
	}

	// Cleared, the plan's value applies again.
	e.clearOverride(basic.workspace, Limit(APIAccess))
	e.clearOverride(basic.workspace, Products)
	e.clearOverride(pro.workspace, Limit(APIAccess))
	if allowed(basic.workspace) || !allowed(pro.workspace) {
		t.Fatal("clearing the overrides did not fall back to the plans")
	}
	if code, body := e.do(basic, http.MethodPost, "/api/v1/products", map[string]any{}); code != http.StatusCreated {
		t.Fatalf("after clearing: %d %v", code, body)
	}
}
