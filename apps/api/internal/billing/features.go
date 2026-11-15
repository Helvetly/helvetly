package billing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Feature names one capability a plan switches on or off (a record of kind access in the offer); what a plan caps
// by number is a Limit (plans.go). Every feature of the offer is a Feature; constants name those code checks.
type Feature string

const (
	APIAccess Feature = "api_access" // creating personal API tokens (the REST API and MCP)
)

// featureNames name features in messages; one without a name reads as its key.
var featureNames = map[Feature]string{APIAccess: "API tokens"}

func featureName(f Feature) string {
	if n, ok := featureNames[f]; ok {
		return n
	}
	return strings.ReplaceAll(string(f), "_", " ")
}

// catalogue is every plan's values in the current offer (one seat, no workspace's own values): what a new
// subscription or a plan change gets, for the plan list and upgrade hints.
type catalogue struct {
	offer  store.OfferVersion
	order  []string                              // keys in the offer's order
	values map[string]map[string]store.PlanValue // plan -> key -> value
}

// currentCatalogue reads the current offer's values; entitlements_unavailable when none is published.
func currentCatalogue(ctx context.Context, q store.Q) (catalogue, error) {
	v, err := q.CurrentOffer(ctx)
	if errors.Is(err, store.ErrNotFound) {
		return catalogue{}, errEntitlementsUnavailable
	}
	if err != nil {
		return catalogue{}, err
	}
	rows, err := q.OfferPlanValues(ctx, v.ID)
	if err != nil {
		return catalogue{}, err
	}
	c := catalogue{offer: v, values: map[string]map[string]store.PlanValue{}}
	for _, p := range rows {
		if c.values[p.Plan] == nil {
			c.values[p.Plan] = map[string]store.PlanValue{}
		}
		if !slices.Contains(c.order, p.Key) {
			c.order = append(c.order, p.Key)
		}
		c.values[p.Plan][p.Key] = p
	}
	return c, nil
}

func (c catalogue) includes(plan string, f Feature) bool {
	return c.values[plan][string(f)].State == StateEnabled
}

// featuresOf lists what plan includes, in order.
func (c catalogue) featuresOf(plan string) []Feature {
	out := []Feature{}
	for _, key := range c.order {
		if c.includes(plan, Feature(key)) {
			out = append(out, Feature(key))
		}
	}
	return out
}

// limitOf is a plan's cap for one seat: Unlimited, or 0 when the offer has no value (nothing new may be spent).
func (c catalogue) limitOf(plan string, l Limit) int64 {
	switch v := c.values[plan][string(l)]; {
	case v.State == StateUnlimited:
		return Unlimited
	case v.State == StateLimited && v.Value != nil:
		return *v.Value
	}
	return 0
}

// cheapestWith is the cheapest plan above from that includes the feature; "" when none does.
func (c catalogue) cheapestWith(f Feature, from string) string {
	for _, plan := range planOrder[slices.Index(planOrder, from)+1:] {
		if c.includes(plan, f) {
			return plan
		}
	}
	return ""
}

// allFeatures is every feature this binary knows, for a self-hosted server (billing off), where each is available.
func allFeatures(ctx context.Context, q store.Q) ([]Feature, error) {
	defs, err := q.LimitDefs(ctx)
	if err != nil {
		return nil, err
	}
	out := []Feature{}
	for _, d := range defs {
		if d.Kind == KindAccess {
			out = append(out, Feature(d.Key))
		}
	}
	return out, nil
}

// Require refuses, with plan_required, a feature the workspace's plan does not include. Self-hosted every feature
// is allowed; without a plan the workspace is read-only (errPlanRequired); an offer without the feature refuses with
// entitlements_unavailable.
func (s *Service) Require(ctx context.Context, q store.Q, workspaceID string, f Feature) error {
	r, err := s.Entitlements(ctx, q, workspaceID)
	switch {
	case err != nil:
		return err
	case r.Includes(f):
		return nil
	case r.Plan == "":
		return errPlanRequired
	case r.Items[string(f)].State != StateDisabled:
		return errEntitlementsUnavailable
	}
	c, err := currentCatalogue(ctx, q)
	if err != nil {
		return err
	}
	return featureError(r.Plan, f, c.cheapestWith(f, r.Plan))
}

func featureError(plan string, f Feature, need string) error {
	msg := fmt.Sprintf("The %s plan does not include %s. Upgrade the workspace to use them.", planNames[plan], featureName(f))
	if need != "" {
		msg = fmt.Sprintf("%s come with the %s plan. Upgrade the workspace to use them.", featureName(f), planNames[need])
	}
	return auth.Error(http.StatusPaymentRequired, "plan_required", msg,
		map[string]any{"feature": f, "plan": plan, "required_plan": need})
}
