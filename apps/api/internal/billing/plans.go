// Package billing is subscription billing with Stripe and the plan limits (docs/billing-contract.md). A workspace
// is on Basic, Pro or Business while its subscription is active, trialing or past due and its paid end plus the
// billing grace has not passed, and locked (read-only) otherwise.
package billing

import (
	"context"
	"fmt"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

const (
	Basic    = "basic"
	Pro      = "pro"
	Business = "business"
)

// Currency is every price's own currency; EUR and USD are its currency options at the same figures (currency.go).
const Currency = "chf"

// PricingKey and PerSeat mark a price as per seat in its metadata: the subscription's quantity is the workspace's
// seats (Seats). A price without the mark is an earlier flat price per workspace (quantity 1), which subscriptions
// made before per-seat pricing keep until they change plan or interval.
const (
	PricingKey = "helvetly_pricing"
	PerSeat    = "per_seat"
)

// TaxBehavior of every price, in every currency: the amounts include VAT (or sales tax), so the price shown is the
// price paid. Stripe
// cannot change a price's tax behaviour, so the catalogue tool replaces a price with another behaviour.
const TaxBehavior = "inclusive"

// planOrder is the order plans are listed in.
var planOrder = []string{Basic, Pro, Business}

// monthly prices per seat in minor units; a year is twelve months less 20 %, rounded up to a whole franc.
var monthly = map[string]int64{Basic: 1900, Pro: 4900, Business: 9900}

// yearlyDiscountPercent is what paying a year at once saves against twelve monthly payments.
const yearlyDiscountPercent = 20

// Plans are the plan ids, cheapest first.
func Plans() []string { return planOrder }

// PlanName is the display name of a plan id.
func PlanName(plan string) string { return planNames[plan] }

// PlanAmount is what one seat of a plan costs in an interval ("month" or "year"), in minor units of any of the
// currencies: CHF, EUR and USD have the same figures.
func PlanAmount(plan, interval string) int64 {
	if interval == "year" {
		discounted := monthly[plan] * 12 * (100 - yearlyDiscountPercent) / 100
		return (discounted + 99) / 100 * 100 // up to the next whole franc when there are rappen
	}
	return monthly[plan]
}

// LookupKey is the Stripe lookup key of a plan's price in an interval; the catalogue tool creates the
// prices under these keys and billing finds them by them.
func LookupKey(plan, interval string) string { return "helvetly_" + plan + "_" + interval }

// planOfKey is the plan and interval a lookup key stands for.
func planOfKey(key string) (plan, interval string) {
	rest, ok := strings.CutPrefix(key, "helvetly_")
	if !ok {
		return "", ""
	}
	plan, interval, _ = strings.Cut(rest, "_")
	if planNames[plan] == "" || (interval != "month" && interval != "year") {
		return "", ""
	}
	return plan, interval
}

// PlanDescription is what the Stripe product says about a plan; the limits themselves live in plan_limits.
func PlanDescription(plan string) string { return planDescriptions[plan] }

var planDescriptions = map[string]string{
	Basic:    "For one person or a pair: invoices with QR bills, expenses, clients and documents.",
	Pro:      "For a growing team: room for many clients, engagements and signatures every month.",
	Business: "For larger teams: no ceilings, and the most storage.",
}

// Limit names one thing a plan caps.
type Limit string

const (
	Members     Limit = "members"              // members besides the owner who accepted; no cap on a per-seat subscription
	Clients     Limit = "clients"              // clients not deleted
	Invoices    Limit = "invoices_per_month"   // invoices (not credit notes) created this month
	Expenses    Limit = "expenses_per_month"   // expenses created this month
	Products    Limit = "products"             // catalogue entries not deleted (archived ones too)
	Engagements Limit = "engagements"          // engagements not cancelled and not ended
	Signatures  Limit = "signatures_per_month" // signature requests sent this month
	Storage     Limit = "storage_bytes"        // documents and expense receipts
	AITokens    Limit = "ai_tokens_per_month"  // model tokens Heidi and the AI import used this month (heidi_usage)
	Employees   Limit = "employees"            // employee records not archived; separate from member seats
)

// Unlimited: the plan has no cap on that limit.
const Unlimited int64 = -1

const gb = 1 << 30

var planNames = map[string]string{Basic: "Basic", Pro: "Pro", Business: "Business"}

// limitOrder is the order limits are listed in.
var limitOrder = []Limit{Members, Clients, Invoices, Expenses, Products, Engagements, Signatures, Storage, AITokens, Employees}

// stockLimits are counted on what exists, so a smaller plan must fit them; monthly ones restart each month.
var stockLimits = []Limit{Members, Clients, Products, Engagements, Storage, Employees}

// planLimits is what each plan allows, read once from plan_limits (seeded by migration) when the service starts.
type planLimits map[string]map[Limit]int64

// loadPlanLimits reads plan_limits and refuses a table that misses a plan or a limit, so a cap is never guessed.
func loadPlanLimits(ctx context.Context, db *store.Store) (planLimits, error) {
	rows, err := db.PlanLimits(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading plan limits: %w", err)
	}
	out := planLimits{}
	for _, r := range rows {
		if out[r.Plan] == nil {
			out[r.Plan] = map[Limit]int64{}
		}
		out[r.Plan][Limit(r.Limit)] = Unlimited
		if r.Max != nil {
			out[r.Plan][Limit(r.Limit)] = *r.Max
		}
	}
	for _, plan := range planOrder {
		for _, l := range limitOrder {
			if _, ok := out[plan][l]; !ok {
				return nil, fmt.Errorf("plan_limits has no %s limit for the %s plan", l, plan)
			}
		}
	}
	return out, nil
}

// forBilling is the cap on a limit for the workspace's subscription: a per-seat one is billed for every member, so
// it has no member cap; one on an earlier flat price keeps its plan's.
func (p planLimits) forBilling(b store.Billing, l Limit, now time.Time) int64 {
	if l == Members && b.PerSeat {
		return Unlimited
	}
	return p.of(PlanOf(b, now), l)
}

// of is a plan's cap on a limit; Unlimited when there is no plan to cap it (billing off, or nothing to count).
func (p planLimits) of(plan string, l Limit) int64 {
	if max, ok := p[plan][l]; ok {
		return max
	}
	return Unlimited
}

// TrialDays: the first subscription of a workspace, when it is to TrialPlan, starts with a trial (once per
// workspace, card required). The other plans are charged at once.
const (
	TrialDays = 7
	TrialPlan = Basic
)

// monthStart: monthly limits follow the calendar month in the workspace's time zone loc.
func monthStart(now time.Time, loc *time.Location) time.Time {
	t := now.In(loc)
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, loc)
}

// live: a subscription in one of these states gives its plan. Not incomplete (its first payment unpaid): it never
// grants its plan, nor replaces or ends a live one on record (apply), until it is paid.
func live(status string) bool {
	return status == "active" || status == "trialing" || status == "past_due"
}

// PlanOf is the plan the workspace is on at now; "" when it has none and is locked.
func PlanOf(b store.Billing, now time.Time) string {
	if live(b.Status) && planNames[b.Plan] != "" && (b.PlanExpiresAt == nil || now.Before(*b.PlanExpiresAt)) {
		return b.Plan
	}
	return ""
}

// lapsed: the subscription is still live at Stripe, but its payment is overdue past the billing grace.
func lapsed(b store.Billing, now time.Time) bool {
	return live(b.Status) && b.PlanExpiresAt != nil && !now.Before(*b.PlanExpiresAt)
}

// billingGrace keeps a plan working a little past its paid end, so a renewal Stripe retries doesn't lock at once.
const billingGrace = 3 * 24 * time.Hour

// planExpiry is until when a subscription's plan works; prev is the end recorded for the same subscription (nil when
// none). Active or trialing: the paid period's (or trial's) end plus the grace. Past due: the end stays where it was,
// and an open renewal invoice pulls it back to the period's start plus the grace (Stripe starts the new period
// before it charges); an unpaid mid-period extra (a seat) leaves the paid period alone. Anything else (unpaid,
// canceled, paused, incomplete, incomplete_expired): the plan ends now.
func planExpiry(sub subscription, prev *time.Time, now time.Time) *time.Time {
	graced := func(unix int64) *time.Time {
		t := time.Unix(unix, 0).UTC().Add(billingGrace)
		return &t
	}
	switch sub.Status {
	case "active", "trialing":
		end := sub.periodEnd()
		if sub.Status == "trialing" && sub.TrialEnd != nil {
			end = *sub.TrialEnd
		}
		if end == 0 {
			return nil
		}
		return graced(end)
	case "past_due":
		end := prev
		if end == nil && sub.periodEnd() > 0 {
			end = graced(sub.periodEnd())
		}
		if start := sub.periodStart(); sub.unpaidRenewal() && start > 0 && (end == nil || graced(start).Before(*end)) {
			end = graced(start)
		}
		return end
	}
	if prev != nil && prev.Before(now) {
		return prev
	}
	return &now
}

func used(u store.Usage, l Limit) int64 {
	switch l {
	case Members:
		return u.Members
	case Clients:
		return u.Clients
	case Invoices:
		return u.InvoicesThisMonth
	case Expenses:
		return u.ExpensesThisMonth
	case Products:
		return u.Products
	case Engagements:
		return u.Engagements
	case Signatures:
		return u.SignaturesThisMonth
	case Storage:
		return u.StorageBytes
	case AITokens:
		return u.AITokensThisMonth
	case Employees:
		return u.Employees
	}
	return 0
}

// fits reports whether adding add to used stays within max.
func fits(used, add, max int64) bool {
	return max == Unlimited || (add >= 0 && used <= max && add <= max-used)
}

// overage is a stock limit the workspace is over on a plan.
type overage struct {
	Limit Limit `json:"limit"`
	Used  int64 `json:"used"`
	Max   int64 `json:"max"`
}

// overages: what keeps the workspace from moving to plan; a per-seat price has room for every member.
func (p planLimits) overages(plan string, perSeat bool, u store.Usage) []overage {
	var out []overage
	for _, l := range stockLimits {
		if l == Members && perSeat {
			continue
		}
		if max := p.of(plan, l); !fits(used(u, l), 0, max) {
			out = append(out, overage{l, used(u, l), max})
		}
	}
	return out
}

var overageWords = map[Limit][3]string{
	Clients:     {"client", "clients", "Delete"},
	Products:    {"product or service", "products and services", "Delete"},
	Engagements: {"running engagement", "running engagements", "End or cancel"},
}

// overageMessage names what keeps the workspace from moving to plan and what to reduce, one sentence per limit:
// "Basic allows 2 members besides the owner; this workspace has 5. Remove 3 members first."
func overageMessage(plan string, over []overage) string {
	name := planNames[plan]
	parts := make([]string, 0, len(over))
	for _, o := range over {
		n := o.Used - o.Max
		switch o.Limit {
		case Storage:
			parts = append(parts, fmt.Sprintf("%s allows %s of storage; this workspace uses %s. Remove %s of files first.",
				name, bytesText(o.Max), bytesText(o.Used), bytesText(n)))
			continue
		case Members:
			parts = append(parts, fmt.Sprintf("%s allows %d %s besides the owner; this workspace has %d. Remove %d %s first.",
				name, o.Max, plural(o.Max, "member", "members"), o.Used, n, plural(n, "member", "members")))
			continue
		}
		w := overageWords[o.Limit] // one, many, what to do
		parts = append(parts, fmt.Sprintf("%s allows %d %s; this workspace has %d. %s %d %s first.",
			name, o.Max, plural(o.Max, w[0], w[1]), o.Used, w[2], n, plural(n, w[0], w[1])))
	}
	return strings.Join(parts, " ")
}
