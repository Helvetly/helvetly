package billing

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"helvetly.com/api/internal/auth"
)

func TestIncludes(t *testing.T) {
	e := newEnv(t, true)
	plans, err := loadPlanLimits(context.Background(), e.st)
	if err != nil {
		t.Fatal(err)
	}
	// Every plan and feature as the migrations seed limits and limit_plans: a change there has to change this too.
	want := map[string]map[Feature]bool{
		"":       {APIAccess: false},
		Basic:    {APIAccess: false},
		Pro:      {APIAccess: true},
		Business: {APIAccess: true},
	}
	for plan, features := range want {
		for _, f := range featureOrder {
			if got := plans.includes(plan, f); got != features[f] {
				t.Errorf("includes(%q, %s) = %v, want %v", plan, f, got, features[f])
			}
		}
	}
	for from, want := range map[string]string{"": Pro, Basic: Pro, Pro: Business, Business: ""} {
		if got := plans.cheapestWith(APIAccess, from); got != want {
			t.Errorf("cheapestWith(api_access, %q) = %q, want %q", from, got, want)
		}
	}
	// A plan without its own value takes the default.
	if err := e.st.ClearPlanLimit(context.Background(), string(APIAccess), Pro); err != nil {
		t.Fatal(err)
	}
	if plans, err = loadPlanLimits(context.Background(), e.st); err != nil || plans.includes(Pro, APIAccess) {
		t.Fatalf("pro without its own value: %v", err)
	}
}

func TestFeaturesAreNamed(t *testing.T) {
	for _, f := range featureOrder {
		if featureNames[f] == "" {
			t.Errorf("feature %s has no name", f)
		}
	}
}

func TestRequire(t *testing.T) {
	ctx := context.Background()
	t.Run("billing off allows every feature", func(t *testing.T) {
		e := newEnv(t, false)
		ws := e.workspace().workspace
		for _, f := range featureOrder {
			if err := e.svc.Require(ctx, e.st.Q, ws, f); err != nil {
				t.Fatalf("%s: %v", f, err)
			}
		}
	})
	e := newEnv(t, true)
	none, basic, pro := e.workspace().workspace, e.workspace().workspace, e.workspace().workspace
	e.subscribe(basic, "price_bm")
	e.subscribe(pro, "price_pm")
	if err := e.svc.Require(ctx, e.st.Q, none, APIAccess); !errors.Is(err, errPlanRequired) {
		t.Fatalf("no plan: %v", err)
	}
	if err := e.svc.Require(ctx, e.st.Q, pro, APIAccess); err != nil {
		t.Fatalf("pro: %v", err)
	}
	err := e.svc.Require(ctx, e.st.Q, basic, APIAccess)
	if status, code, _, ok := auth.Describe(err); !ok || status != http.StatusPaymentRequired || code != "plan_required" {
		t.Fatalf("basic: %v", err)
	}
	// limit_plans is the source of truth: switching a plan's value flips the answer at once.
	if err := e.st.SetPlanLimit(ctx, string(APIAccess), Pro, 0); err != nil {
		t.Fatal(err)
	}
	if err := e.st.SetPlanLimit(ctx, string(APIAccess), Basic, 1); err != nil {
		t.Fatal(err)
	}
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
		if own, _ := features(t, e, e.workspace()); len(own) != len(featureOrder) {
			t.Fatalf("features without billing: %v", own)
		}
	})
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	own, plans := features(t, e, b)
	if own == nil || len(own) != 0 {
		t.Fatalf("basic workspace features: %v", own)
	}
	if plans[Basic] == nil || len(plans[Basic]) != 0 || len(plans[Pro]) != 1 || plans[Pro][0] != string(APIAccess) {
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
	set := func(ws string, l Limit, v int64) {
		t.Helper()
		if err := e.st.SetWorkspaceLimit(ctx, ws, string(l), v, "test"); err != nil {
			t.Fatal(err)
		}
	}
	allowed := func(ws string) bool { return e.svc.Require(ctx, e.st.Q, ws, APIAccess) == nil }

	// A workspace's own value replaces its plan's, for a feature either way.
	set(basic.workspace, Limit(APIAccess), 1)
	set(pro.workspace, Limit(APIAccess), 0)
	if !allowed(basic.workspace) || allowed(pro.workspace) || allowed(other.workspace) {
		t.Fatalf("feature overrides: basic %v, pro %v, other basic %v", allowed(basic.workspace), allowed(pro.workspace), allowed(other.workspace))
	}
	if code, body := e.do(basic, http.MethodPost, "/api/v1/account/tokens", map[string]any{}); code != http.StatusUnprocessableEntity {
		t.Fatalf("guard ignored the override: %d %v", code, body)
	}

	// A numeric limit: Basic has 25 catalogue entries; an override of 1 refuses the second, and only here.
	set(basic.workspace, Products, 1)
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
	for _, l := range []Limit{Limit(APIAccess), Products} {
		if err := e.st.ClearWorkspaceLimit(ctx, basic.workspace, string(l)); err != nil {
			t.Fatal(err)
		}
	}
	if err := e.st.ClearWorkspaceLimit(ctx, pro.workspace, string(APIAccess)); err != nil {
		t.Fatal(err)
	}
	if allowed(basic.workspace) || !allowed(pro.workspace) {
		t.Fatal("clearing the overrides did not fall back to the plans")
	}
	if code, body := e.do(basic, http.MethodPost, "/api/v1/products", map[string]any{}); code != http.StatusCreated {
		t.Fatalf("after clearing: %d %v", code, body)
	}
}
