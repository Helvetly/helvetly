package billing

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"testing"

	"helvetly.com/api/internal/auth"
)

func TestIncludes(t *testing.T) {
	// Every plan and feature, spelled out: a change to planFeatures has to change this table too.
	want := map[string]map[Feature]bool{
		"":       {APIAccess: false, EmployeesModule: false},
		Basic:    {APIAccess: false, EmployeesModule: true},
		Pro:      {APIAccess: true, EmployeesModule: true},
		Business: {APIAccess: true, EmployeesModule: true},
	}
	for plan, features := range want {
		for _, f := range featureOrder {
			if got := Includes(plan, f); got != features[f] {
				t.Errorf("Includes(%q, %s) = %v, want %v", plan, f, got, features[f])
			}
		}
	}
	if got := cheapestWith(APIAccess); got != Pro {
		t.Fatalf("cheapestWith(api_access) = %q, want pro", got)
	}
}

func TestFeaturesAreDeclared(t *testing.T) {
	for _, plan := range planOrder {
		if _, ok := planFeatures[plan]; !ok {
			t.Errorf("plan %s has no feature list", plan)
		}
		for _, f := range planFeatures[plan] {
			if !slices.Contains(featureOrder, f) {
				t.Errorf("plan %s lists %s, which featureOrder misses", plan, f)
			}
		}
	}
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
	if len(own) != 1 || own[0] != string(EmployeesModule) {
		t.Fatalf("basic workspace features: %v", own)
	}
	if len(plans[Basic]) != 1 || len(plans[Pro]) != 2 || plans[Pro][0] != string(APIAccess) {
		t.Fatalf("plan features: %v", plans)
	}
}
