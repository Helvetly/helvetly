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
	APIAccess Feature = "api_access" // creating personal API tokens (the REST API and MCP)
)

// featureOrder is the order features are listed in.
var featureOrder = []Feature{APIAccess}

var featureNames = map[Feature]string{APIAccess: "API tokens"}

// includes reports whether plan includes the feature: its value is not 0 (as Staqly reads data_export); no value or
// no plan ("") is off.
func (p planLimits) includes(plan string, f Feature) bool {
	v, ok := p[plan][Limit(f)]
	return ok && v != 0
}

// featuresOf lists what plan includes, in order.
func (p planLimits) featuresOf(plan string) []Feature {
	out := []Feature{}
	for _, f := range featureOrder {
		if p.includes(plan, f) {
			out = append(out, f)
		}
	}
	return out
}

// workspaceFeatures is what a workspace with these limits (limitsOf) on plan may use: every feature when billing is
// off.
func (s *Service) workspaceFeatures(limits planLimits, plan string) []Feature {
	if !s.enabled {
		return slices.Clone(featureOrder)
	}
	return limits.featuresOf(plan)
}

// cheapestWith is the cheapest plan above from that includes the feature; "" when none does.
func (p planLimits) cheapestWith(f Feature, from string) string {
	for _, plan := range planOrder[slices.Index(planOrder, from)+1:] {
		if p.includes(plan, f) {
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
	limits, err := limitsOf(ctx, q, workspaceID, plan)
	if err != nil {
		return err
	}
	if limits.includes(plan, f) {
		return nil
	}
	return featureError(plan, f, s.plans.cheapestWith(f, plan))
}

func featureError(plan string, f Feature, need string) error {
	msg := fmt.Sprintf("The %s plan does not include %s. Upgrade the workspace to use them.", planNames[plan], featureNames[f])
	if need != "" {
		msg = fmt.Sprintf("%s come with the %s plan. Upgrade the workspace to use them.", featureNames[f], planNames[need])
	}
	return auth.Error(http.StatusPaymentRequired, "plan_required", msg,
		map[string]any{"feature": f, "plan": plan, "required_plan": need})
}
