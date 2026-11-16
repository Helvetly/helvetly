// Package billing is subscription billing with Stripe and the plan limits (docs/billing-contract.md). A workspace
// is on Basic, Pro or Business while its subscription is active, trialing or past due and its paid end plus the
// billing grace has not passed, and locked (read-only) otherwise.
package billing

import (
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

// PlanDescription is what the Stripe product says about a plan; the limits themselves live in the offer (offer.go).
func PlanDescription(plan string) string { return planDescriptions[plan] }

var planDescriptions = map[string]string{
	Basic:    "For one person or a small team: invoices and quotes with Swiss QR bills.",
	Pro:      "For a growing team: Heidi, expenses, signatures, automations and VAT returns.",
	Business: "For larger teams: everything in Pro, the client portal, e-invoice XML and the most room.",
}

// Limit names one thing a plan caps.
type Limit string

const (
	Members     Limit = "members"                // members besides the owner who accepted; no cap on a per-seat subscription
	Clients     Limit = "clients"                // clients not deleted
	Invoices    Limit = "invoices_per_month"     // documents issued this quota month, linked corrections aside (usage_events)
	Expenses    Limit = "expenses_per_month"     // expenses first saved this quota month, deleted ones too (usage_events)
	Products    Limit = "products"               // catalogue entries not deleted (archived ones too)
	Engagements Limit = "engagements"            // engagements not cancelled and not ended
	Signatures  Limit = "signatures_per_month"   // signature packages sent this quota month (usage_events)
	Storage     Limit = "storage_bytes"          // bytes kept in storage (stored_objects)
	AITokens    Limit = "ai_tokens_per_month"    // model tokens Heidi and the AI import used this month (heidi_usage)
	AICost      Limit = "ai_cost_usd_micros"     // the internal model cost guard in micro-USD, never shown as a limit
	MaxSeats    Limit = "max_self_service_seats" // the seats a workspace can buy itself; the members cap on a flat price

	AutomationActions Limit = store.AutomationActions // automatic actions this quota month (usage_events)

	InvoiceDrafts  Limit = "invoice_drafts"  // invoice drafts that exist, of any kind
	QuotesRetained Limit = "quotes_retained" // quotes that exist, a revision being the same quote

	Downloads        Limit = "download_bytes_per_month"   // bytes of workspace files sent this quota month (usage_events)
	Emails           Limit = store.EmailRecipients        // business email recipients accepted this quota month (usage_events)
	EmailAttachments Limit = store.EmailAttachmentBytes   // attachment bytes times recipients this quota month (usage_events)
	MaxEmailAttach   Limit = "max_email_attachment_bytes" // one message's attachments, per recipient
)

// Unlimited: the plan has no cap on that limit.
const Unlimited int64 = -1

const gb = 1_000_000_000 // storage is sold in decimal gigabytes (offer v2)

var planNames = map[string]string{Basic: "Basic", Pro: "Pro", Business: "Business"}

// limitOrder is the order limits are listed in.
var limitOrder = []Limit{Members, Clients, Invoices, Expenses, Products, Engagements, Signatures, Storage, AITokens}

// quotaStart is when b's workspace's monthly counts start: now's quota month (UTC), or a trial's start, whose
// allowances last the whole trial and do not restart with a month.
func quotaStart(b store.Billing, now time.Time) time.Time {
	if b.Status == "trialing" && b.TrialStart != nil && b.TrialStart.Before(now) {
		return b.TrialStart.UTC()
	}
	return store.UsagePeriodStart(now)
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
	case InvoiceDrafts:
		return u.InvoiceDrafts
	case QuotesRetained:
		return u.QuotesRetained
	case AutomationActions:
		return u.AutomationsThisMonth
	case Downloads:
		return u.DownloadBytesThisMonth
	case Emails:
		return u.EmailsThisMonth
	case EmailAttachments:
		return u.EmailAttachmentBytesThisMonth
	}
	return 0
}

// fits reports whether adding add to used stays within max.
func fits(used, add, max int64) bool {
	return max == Unlimited || (add >= 0 && used <= max && add <= max-used)
}
