package billing

import (
	"context"
	"fmt"
	"net/http"
	"slices"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Feature names one capability a plan switches on or off; what a plan caps by number is a Limit (plans.go).
type Feature string

const (
	APIAccess       Feature = "api_access" // creating personal API tokens (the REST API and MCP)
	EmployeesModule Feature = "employees"  // employee records, pay terms, employee documents and the payroll register
)

// featureOrder is the order features are listed in.
var featureOrder = []Feature{APIAccess, EmployeesModule}

// planFeatures is what each plan includes; a feature no plan lists is off on every plan while billing is on.
var planFeatures = map[string][]Feature{
	Basic:    {EmployeesModule},
	Pro:      {APIAccess, EmployeesModule},
	Business: {APIAccess, EmployeesModule},
}

var featureNames = map[Feature]string{APIAccess: "API tokens", EmployeesModule: "Employees and payroll register"}

// Includes reports whether plan includes the feature; no plan ("") includes none.
func Includes(plan string, f Feature) bool { return slices.Contains(planFeatures[plan], f) }

// featuresOf lists what plan includes, in order.
func featuresOf(plan string) []Feature {
	out := []Feature{}
	for _, f := range featureOrder {
		if Includes(plan, f) {
			out = append(out, f)
		}
	}
	return out
}

// workspaceFeatures is what a workspace on plan may use: every feature when billing is off.
func (s *Service) workspaceFeatures(plan string) []Feature {
	if !s.enabled {
		return slices.Clone(featureOrder)
	}
	return featuresOf(plan)
}

// cheapestWith is the cheapest plan that includes the feature; "" when none does.
func cheapestWith(f Feature) string {
	for _, plan := range planOrder {
		if Includes(plan, f) {
			return plan
		}
	}
	return ""
}

// Require refuses, with plan_required, a feature the workspace's plan does not include. Without billing every
// feature is allowed; without a plan the workspace is read-only (errPlanRequired).
func (s *Service) Require(ctx context.Context, q store.Q, workspaceID string, f Feature) error {
	if !s.enabled {
		return nil
	}
	b, err := q.WorkspaceBilling(ctx, workspaceID)
	if err != nil {
		return err
	}
	plan := PlanOf(b, s.now())
	if plan == "" {
		return errPlanRequired
	}
	if Includes(plan, f) {
		return nil
	}
	return featureError(plan, f)
}

func featureError(plan string, f Feature) error {
	need := cheapestWith(f)
	msg := fmt.Sprintf("The %s plan does not include %s. Upgrade the workspace to use them.", planNames[plan], featureNames[f])
	if need != "" {
		msg = fmt.Sprintf("%s come with the %s plan. Upgrade the workspace to use them.", featureNames[f], planNames[need])
	}
	return auth.Error(http.StatusPaymentRequired, "plan_required", msg,
		map[string]any{"feature": f, "plan": plan, "required_plan": need})
}
