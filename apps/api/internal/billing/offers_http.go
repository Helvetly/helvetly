package billing

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// ---- private: the workspace's entitlements in GET /api/v1/billing ----

type entitlementItem struct {
	Key       string     `json:"key"`
	Kind      string     `json:"kind"`
	Unit      string     `json:"unit"`
	Scope     string     `json:"scope"`
	Period    *string    `json:"period"`
	State     string     `json:"state"`
	Value     *int64     `json:"value"`    // the cap when limited, else null
	PerSeat   bool       `json:"per_seat"` // grows with every paid seat
	Source    string     `json:"source"`   // plan, workspace (an operator's value) or none (missing)
	ExpiresAt *time.Time `json:"expires_at"`
	Used      *int64     `json:"used"`     // null while the key is not metered
	ResetAt   *time.Time `json:"reset_at"` // when a monthly count starts again; null otherwise
}

// metered are the limits counted today (WorkspaceUsage), monthly ones in the UTC quota month.
var metered = []Limit{Clients, Invoices, Quotes, Expenses, Products, Engagements, Signatures, Storage, AITokens, AIAutomationTokens, InvoiceDrafts, QuotesRetained,
	AutomationActions, Emails}

// entitlementItems lists the workspace's entitlements for its panel, without the internal AI cost budget: the panel
// shows tokens. reset is when the monthly counts start again (nil in the trial, whose allowances last it whole).
func entitlementItems(r Rights, u store.Usage, reset *time.Time) []entitlementItem {
	out := make([]entitlementItem, 0, len(r.Order))
	for _, key := range r.Order {
		e := r.Items[key]
		if e.Kind == "cost_budget" {
			continue
		}
		item := entitlementItem{Key: key, Kind: e.Kind, Unit: e.Unit, Scope: e.Scope, State: e.State, PerSeat: e.PerSeat,
			Source: e.Source, ExpiresAt: e.ExpiresAt}
		if e.Period != "" {
			item.Period = &e.Period
		}
		if e.State == StateLimited {
			item.Value = &e.Value
		}
		if slices.Contains(metered, Limit(key)) {
			n := used(u, Limit(key))
			item.Used = &n
			if e.Period != "" {
				item.ResetAt = reset
			}
		}
		out = append(out, item)
	}
	return out
}

// ---- public: GET /api/v1/public/offers/current ----

// publicPrice is a plan's tiered price in minor units, VAT included: Month and Year for up to IncludedPeople, each
// further person ExtraPersonMonth or ExtraPersonYear. Free's is all zero, for one person.
type publicPrice struct {
	Month            int64 `json:"month"`
	Year             int64 `json:"year"`
	IncludedPeople   int64 `json:"included_people"`
	ExtraPersonMonth int64 `json:"extra_person_month"`
	ExtraPersonYear  int64 `json:"extra_person_year"`
}

type publicPlan struct {
	ID     string                 `json:"id"`
	Name   string                 `json:"name"`
	Prices map[string]publicPrice `json:"prices"` // by currency
}

type publicRow struct {
	Key       string          `json:"key"`
	Label     string          `json:"label"`
	Note      string          `json:"note,omitempty"`
	LimitKeys []string        `json:"limit_keys"`
	Plans     map[string]bool `json:"plans"` // included: every feature of the row enabled
}

type publicValue struct {
	Included bool   `json:"included"`
	Value    *int64 `json:"value"` // for one person, null when unlimited
}

type publicLimit struct {
	Unit      string                 `json:"unit"`
	Period    *string                `json:"period"`
	PerPerson bool                   `json:"per_person"` // grows by the value with every paid person; else per workspace
	Plans     map[string]publicValue `json:"plans"`
}

// currentOffer answers the offer on sale for the public pricing page: prices per person in every currency and the
// chosen comparison rows and customer allowances, never the whole catalogue, a workspace's values or internal costs.
// Published offers never change, so the ETag is the offer and its checksum.
func (s *Service) currentOffer(w http.ResponseWriter, r *http.Request) {
	v, err := s.db.CurrentOffer(r.Context())
	if errors.Is(err, store.ErrNotFound) {
		err = auth.Error(http.StatusServiceUnavailable, "pricing_unavailable", "Pricing is temporarily unavailable.", nil)
	}
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	o, err := LoadOffer(v)
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	etag := `"` + v.ID + ":" + v.Checksum + `"`
	h := w.Header()
	h.Set("ETag", etag)
	h.Set("Cache-Control", "public, max-age=60") // auth.WriteJSON would forbid caching
	h.Set("Access-Control-Allow-Origin", "*")    // public and without cookies: the website reads it from its own host
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"data": publicOffer(o, v)}) // a write error means the client left
}

func publicOffer(o Offer, v store.OfferVersion) map[string]any {
	plans := make([]publicPlan, 0, len(offerPlans))
	for _, id := range offerPlans {
		p := publicPlan{ID: id, Name: planNames[id], Prices: map[string]publicPrice{}}
		for _, cur := range o.Billing.Currencies {
			bp, price := o.Billing.Plans[id], publicPrice{IncludedPeople: 1} // Free: none, for one person
			if paid(id) {
				price = publicPrice{bp.MonthMinor, bp.YearMinor, bp.IncludedPeople, bp.ExtraPersonMonthMinor, bp.ExtraPersonYearMinor}
			}
			p.Prices[cur] = price
		}
		plans = append(plans, p)
	}
	rows := make([]publicRow, 0, len(o.PublicPricing.ComparisonRows))
	limits := map[string]publicLimit{}
	for _, row := range o.PublicPricing.ComparisonRows {
		pr := publicRow{Key: row.Key, Label: row.LabelEN, Note: row.NoteEN, LimitKeys: row.LimitKeys, Plans: map[string]bool{}}
		for _, plan := range offerPlans {
			pr.Plans[plan] = !slices.ContainsFunc(row.FeatureKeys, func(f string) bool { return !o.enabled(f, plan) })
		}
		rows = append(rows, pr)
		for _, key := range row.LimitKeys {
			limits[key] = o.publicLimit(key)
		}
	}
	for _, key := range o.PublicPricing.UsageDetailsKeys {
		limits[key] = o.publicLimit(key)
	}
	// The people a workspace can have without asking: a technical guard the site states, never a comparison row.
	seats := map[string]*int64{}
	r, _ := o.record(string(MaxSeats))
	for _, plan := range offerPlans {
		seats[plan] = nil // unlimited
		if v := r.Values[plan]; v.State == StateLimited {
			seats[plan] = v.Value
		}
	}
	// Every public feature's state on every plan: the website's comparison table is checked to name each one.
	features := map[string]map[string]bool{}
	for _, r := range o.Records {
		if r.Type == KindAccess && !slices.Contains(o.PublicPricing.InternalOnlyKeys, r.Key) {
			features[r.Key] = map[string]bool{}
			for _, plan := range offerPlans {
				features[r.Key][plan] = r.Values[plan].State == StateEnabled
			}
		}
	}
	return map[string]any{
		"offer_id": v.ID, "schema_version": v.SchemaVersion, "checksum": v.Checksum, "published_at": v.PublishedAt,
		"price_per": "plan", "tax_inclusive": true, "currencies": o.Billing.Currencies, "plans": plans,
		"comparison": rows, "usage_details": o.PublicPricing.UsageDetailsKeys, "limits": limits,
		"max_self_service_seats": seats, "features": features,
	}
}

func (o Offer) enabled(feature, plan string) bool {
	r, ok := o.record(feature)
	return ok && r.Values[plan].State == StateEnabled
}

// publicLimit is a limit's value on each plan for one person; not included where a feature it requires is off.
func (o Offer) publicLimit(key string) publicLimit {
	r, _ := o.record(key) // Validate checked that it exists
	l := publicLimit{Unit: r.Unit, Period: r.Period, Plans: map[string]publicValue{}}
	for _, plan := range offerPlans {
		v := r.Values[plan]
		l.PerPerson = l.PerPerson || r.PerAdditionalPaidSeat[plan] > 0
		included := !slices.ContainsFunc(r.RequiresFeatures, func(f string) bool { return !o.enabled(f, plan) })
		pv := publicValue{Included: included}
		if v.State == StateLimited {
			pv.Value = v.Value
		}
		l.Plans[plan] = pv
	}
	return l
}
