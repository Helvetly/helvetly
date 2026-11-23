package billing

import (
	"context"
	"fmt"
	"time"

	"helvetly.com/api/internal/notifications"
	"helvetly.com/api/internal/store"
)

// subscriptionNews: what the owners hear about a subscription Stripe changed from before to after ("" for nothing).
// A first subscription is the owner's own checkout, and an unchanged plan and status is a re-delivery: neither is news.
func subscriptionNews(eventType string, before store.Billing, after store.Subscription) (string, map[string]any) {
	data := map[string]any{"plan": or(planNames[after.Plan], after.Plan), "status": after.Status}
	failing := func(status string) bool { return status == "past_due" || status == "unpaid" }
	switch {
	case eventType == "customer.subscription.trial_will_end" && after.TrialEnd != nil:
		data["trial_end"] = after.TrialEnd.Format(time.DateOnly)
		return "billing.trial_ending", data
	case failing(after.Status) && !failing(before.Status):
		return "billing.payment_failed", data
	case before.SubscriptionID == "" || before.Plan == after.Plan && before.Status == after.Status:
		return "", nil
	}
	return "billing.subscription_changed", data
}

func or(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// monthly: limits counted per quota month (UTC), so nearing one is news again next month.
var monthlyLimits = map[Limit]bool{Invoices: true, Quotes: true, Expenses: true, Signatures: true, AITokens: true, AutomationActions: true,
	Emails: true, ScheduledEvents: true}

var limitNouns = map[Limit]string{Members: "member seats", Clients: "clients", Invoices: "invoices this month", Quotes: "quotes this month",
	Expenses: "expenses this month", Products: "products and services", Engagements: "running engagements",
	Signatures: "signature requests this month", Storage: "storage", AITokens: "AI tokens this month",
	InvoiceDrafts: "invoice drafts", QuotesRetained: "quotes", AutomationActions: "automatic actions this month",
	Emails: "business emails this month", ScheduledEvents: "scheduled sessions this month"}

// notifyNear tells the owners and admins once when an admitted write brings a limit to 90 % or more: once a month
// for a monthly limit, once per cap for the others (a new plan's cap is news again).
func notifyNear(ctx context.Context, q store.Q, workspaceID, plan string, limit Limit, now time.Time, period string, n, max int64) error {
	if max <= 0 || n*10 < max*9 {
		return nil
	}
	key := fmt.Sprintf("billing.limit_near:%s:%d", limit, max)
	if monthlyLimits[limit] {
		key += ":" + period
	}
	used, cap := fmt.Sprint(n), fmt.Sprint(max)
	if limit == Storage {
		used, cap = bytesText(n), bytesText(max)
	}
	return notifications.Notify(ctx, q, workspaceID, "billing.limit_near", map[string]any{"limit": limitNouns[limit],
		"used": used, "max": cap, "plan": planNames[plan]}, store.NotifyTo{Roles: notifications.Managers, Once: key}, now)
}
