package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
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

// adminSubscriptionNews follows the accepted Stripe subscription across webhooks and direct syncs.
func adminSubscriptionNews(before store.Billing, after store.Subscription) []string {
	if !paid(after.Plan) {
		return nil
	}

	same := before.SubscriptionID == after.ID
	previouslyStarted := same && (live(before.Status) || before.Status == "unpaid" || before.Status == "paused")

	var titles []string
	switch {
	case previouslyStarted && after.Status == "canceled":
		titles = append(titles, "Subscription ended")
	case after.Status == "trialing" && !previouslyStarted:
		titles = append(titles, "New subscription (trial)")
	case after.Status == "active" && (!previouslyStarted || before.Status == "trialing"):
		titles = append(titles, "New active subscription")
	}

	if live(after.Status) && after.CancelAtPeriodEnd && (!same || !before.CancelAtPeriodEnd) {
		titles = append(titles, "Subscription set to cancel at period end")
	}

	return titles
}

// adminSubscriptionDetails: the plan with what it costs for the subscription's people and interval, and its
// discount, for the operator's alert. shortcut: the price is the current offer's list price, not the one an older
// offer's subscription keeps; read it from the subscription's price when alerts cover repricing.
func adminSubscriptionDetails(sub subscription, after store.Subscription) string {
	interval := map[string]string{"month": "monthly", "year": "yearly"}[after.Interval]
	people := max(after.Seats, 1)
	line := fmt.Sprintf("Plan: %s, %s, %s %s for %d %s", or(planNames[after.Plan], after.Plan), or(interval, after.Interval),
		strings.ToUpper(sub.Currency), money(PlanTotal(after.Plan, after.Interval, people)), people, plural(people, "person", "people"))
	if discount := discountText(sub); discount != "" {
		line += "\nDiscount: " + discount
	}
	return line
}

// discountText: "100 % off forever (code BIZ-LIFE)", "20 % off for 3 months, until 2027-02-25", or "" for none.
func discountText(sub subscription) string {
	if len(sub.Discounts) == 0 {
		return ""
	}
	d, c := sub.Discounts[0], sub.Discounts[0].Source.Coupon
	var out string
	if c.PercentOff != nil {
		out = strconv.FormatFloat(*c.PercentOff, 'f', -1, 64) + " % off"
	} else if amount, _ := c.amountIn(sub.Currency); amount > 0 {
		out = strings.ToUpper(sub.Currency) + " " + money(amount) + " off"
	} else {
		return ""
	}
	switch {
	case c.Duration == "forever":
		out += " forever"
	case c.Duration == "once":
		out += " on the first invoice"
	case c.Duration == "repeating" && c.DurationInMonths != nil:
		out += fmt.Sprintf(" for %d %s", *c.DurationInMonths, plural(int64(*c.DurationInMonths), "month", "months"))
	}
	if d.End != nil {
		out += ", until " + time.Unix(*d.End, 0).UTC().Format(time.DateOnly)
	}
	var pc struct {
		Code string `json:"code"`
	}
	if json.Unmarshal(d.PromotionCode, &pc) == nil && pc.Code != "" {
		out += " (code " + pc.Code + ")"
	}
	return out
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
