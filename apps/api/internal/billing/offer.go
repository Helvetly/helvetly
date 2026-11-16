package billing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"regexp"
	"slices"
	"strings"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/store"
)

// Offer is one version of what Helvetly sells: the per-person prices, every plan's value of every feature and limit
// (records), the trial and the public pricing projection. The operator reads it from the offer contract's JSON file
// (fields this binary does not use, such as rationale, are ignored) and publishes it once; offer_versions keeps it
// unchanged from then on, and limit_plans holds its values for the resolver.
type Offer struct {
	SchemaVersion int           `json:"schema_version"`
	ID            string        `json:"offer_id"`
	Billing       OfferBilling  `json:"billing"`
	Records       []OfferRecord `json:"records"`
	UsagePolicy   struct {
		Pooled []string `json:"pooled_by_paid_seat_keys"` // grow by their full base value with every paid seat
	} `json:"usage_policy"`
	Trial         OfferTrial    `json:"trial"`
	PublicPricing PublicPricing `json:"public_pricing"`
}

// OfferBilling is the prices: per person, the same figures in every currency.
type OfferBilling struct {
	Currencies []string             `json:"currencies"`
	Plans      map[string]PlanPrice `json:"plans"`
}

// PlanPrice is one person's price of a plan in minor units, VAT included.
type PlanPrice struct {
	MonthMinor int64 `json:"month_minor"`
	YearMinor  int64 `json:"year_minor"`
}

// OfferRecord is one feature or limit with its value on each plan. Values grow by PerAdditionalPaidSeat for every
// paid seat after the first.
type OfferRecord struct {
	Key                   string                `json:"key"`
	Type                  string                `json:"type"`
	Unit                  string                `json:"unit"`
	Scope                 string                `json:"scope"`
	Period                *string               `json:"period"`
	Values                map[string]OfferValue `json:"values"`
	PerAdditionalPaidSeat map[string]int64      `json:"per_additional_paid_seat,omitempty"`
	RequiresFeatures      []string              `json:"requires_features,omitempty"`
}

// OfferValue is a feature's state (enabled, disabled) or a limit's: limited to Value (0 grants none) or unlimited.
type OfferValue struct {
	State string `json:"state"`
	Value *int64 `json:"value,omitempty"`
}

// OfferTrial is the trial a new customer may start: a plan's features for Days days with small lifetime allowances
// (Overrides) that do not grow with seats.
type OfferTrial struct {
	Days       int              `json:"days"`
	AccessPlan string           `json:"access_plan"`
	Seats      int              `json:"seats"`
	Overrides  map[string]int64 `json:"overrides"`
}

// PublicPricing is what the public pricing page shows: chosen business rows and customer allowances, never the whole
// catalogue.
type PublicPricing struct {
	ComparisonRows   []ComparisonRow `json:"comparison_rows"`
	UsageDetailsKeys []string        `json:"usage_details_keys"`
	InternalOnlyKeys []string        `json:"internal_only_keys"`
}

// ComparisonRow is one row of the public plan comparison: included on a plan when all its features are enabled there.
type ComparisonRow struct {
	Key         string   `json:"key"`
	LabelEN     string   `json:"label_en"`
	NoteEN      string   `json:"note_en,omitempty"`
	FeatureKeys []string `json:"feature_keys"`
	LimitKeys   []string `json:"limit_keys"`
}

// Record kinds (limits.kind) and value states.
const (
	KindAccess = "access"
	KindGuard  = "technical_guard"

	StateEnabled   = "enabled"
	StateDisabled  = "disabled"
	StateLimited   = "limited"
	StateUnlimited = "unlimited"
	StateMissing   = "missing" // the offer has no value: nothing new may be spent, never unlimited
)

// ParseOffer reads an offer file.
func ParseOffer(r io.Reader) (Offer, error) {
	var o Offer
	if err := json.NewDecoder(r).Decode(&o); err != nil {
		return Offer{}, fmt.Errorf("reading the offer: %w", err)
	}
	return o, nil
}

// Checksum identifies the offer's terms: the same terms under another id have the same checksum.
func (o Offer) Checksum() string {
	o.ID = ""
	b, _ := json.Marshal(o) // only strings, numbers, slices and maps: cannot fail
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func (o Offer) record(key string) (OfferRecord, bool) {
	i := slices.IndexFunc(o.Records, func(r OfferRecord) bool { return r.Key == key })
	if i < 0 {
		return OfferRecord{}, false
	}
	return o.Records[i], true
}

// saleCurrencies are the currencies every price is sold in, sorted.
var saleCurrencies = []string{Currency, EUR, USD}

var offerID = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,63}$`)

// Validate checks a complete offer against the definitions this binary knows (limits): every defined key once with
// its kind, unit, scope and period, nothing unknown, a valid value on every plan, the prices of plans.go in CHF, EUR
// and USD, and a public projection that names only business features and customer allowances.
func (o Offer) Validate(defs []store.LimitDef) error {
	var errs []error
	fail := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }
	if o.SchemaVersion != 1 {
		fail("schema_version %d is not supported (1)", o.SchemaVersion)
	}
	if !offerID.MatchString(o.ID) {
		fail("offer_id %q must be lower-case letters, digits, dots and dashes, at most 64", o.ID)
	}
	o.validatePrices(fail)
	byKey := map[string]store.LimitDef{}
	for _, d := range defs {
		byKey[d.Key] = d
	}
	seen := map[string]bool{}
	for _, r := range o.Records {
		def, ok := byKey[r.Key]
		switch {
		case seen[r.Key]:
			fail("%s: listed twice", r.Key)
			continue
		case !ok:
			fail("%s: unknown key; a new feature or limit needs code and a migration first", r.Key)
			continue
		}
		seen[r.Key] = true
		o.validateRecord(r, def, fail)
	}
	for _, d := range defs {
		if !seen[d.Key] {
			fail("%s: missing; a published offer must give every key a value", d.Key)
		}
	}
	for _, key := range o.UsagePolicy.Pooled {
		r, ok := o.record(key)
		if !ok || r.Type == KindAccess {
			fail("usage_policy.pooled_by_paid_seat_keys: %s is not a limit", key)
			continue
		}
		for _, plan := range planOrder {
			v := r.Values[plan]
			if v.State == StateUnlimited { // nothing to grow; validateRecord checks it has no per-seat growth
				continue
			}
			if v.State != StateLimited || v.Value == nil || r.PerAdditionalPaidSeat[plan] != *v.Value {
				fail("%s on %s: a pooled limit grows by its full value with every paid seat", key, plan)
			}
		}
	}
	o.validateTrial(fail)
	o.validateAIFunding(fail)
	o.validatePublic(fail)
	return errors.Join(errs...)
}

func (o Offer) validatePrices(fail func(string, ...any)) {
	if got := slices.Sorted(maps.Keys(o.Billing.Plans)); !slices.Equal(got, slices.Sorted(slices.Values(planOrder))) {
		fail("billing.plans must be exactly %v, got %v", planOrder, got)
	}
	for _, plan := range planOrder {
		p := o.Billing.Plans[plan]
		if p.MonthMinor != PlanAmount(plan, "month") || p.YearMinor != PlanAmount(plan, "year") {
			fail("billing.plans.%s: %d a month and %d a year, but plans.go charges %d and %d", plan, p.MonthMinor,
				p.YearMinor, PlanAmount(plan, "month"), PlanAmount(plan, "year"))
		}
	}
	cur := make([]string, 0, len(o.Billing.Currencies))
	for _, c := range o.Billing.Currencies {
		cur = append(cur, strings.ToLower(c))
	}
	if slices.Sort(cur); !slices.Equal(cur, saleCurrencies) {
		fail("billing.currencies must be %v, got %v", saleCurrencies, o.Billing.Currencies)
	}
}

func (o Offer) validateRecord(r OfferRecord, def store.LimitDef, fail func(string, ...any)) {
	period := ""
	if r.Period != nil {
		period = *r.Period
	}
	if r.Type != def.Kind || r.Unit != def.Unit || r.Scope != def.Scope || period != def.Period ||
		!slices.Equal(r.RequiresFeatures, def.RequiresFeatures) {
		fail("%s: type, unit, scope, period or requires_features differ from its definition (%s, %s, %s, %q, %v)",
			r.Key, def.Kind, def.Unit, def.Scope, def.Period, def.RequiresFeatures)
	}
	if got := slices.Sorted(maps.Keys(r.Values)); !slices.Equal(got, slices.Sorted(slices.Values(planOrder))) {
		fail("%s: values must be given for exactly %v, got %v", r.Key, planOrder, got)
	}
	for _, plan := range planOrder {
		v := r.Values[plan]
		inc, hasInc := r.PerAdditionalPaidSeat[plan]
		for _, f := range r.RequiresFeatures {
			fr, ok := o.record(f)
			switch {
			case !ok || fr.Type != KindAccess:
				fail("%s: requires_features names %s, which is not a feature", r.Key, f)
			case fr.Values[plan].State == StateEnabled:
			case r.Type == KindAccess && v.State != StateDisabled:
				fail("%s on %s: %s is disabled there, so it must be disabled too", r.Key, plan, f)
			case r.Type != KindAccess && (v.State != StateLimited || v.Value == nil || *v.Value != 0 || inc != 0):
				fail("%s on %s: %s is disabled there, so it must be limited to 0 with no per-seat growth", r.Key, plan, f)
			}
		}
		if r.Type == KindAccess {
			if (v.State != StateEnabled && v.State != StateDisabled) || v.Value != nil || len(r.PerAdditionalPaidSeat) > 0 {
				fail("%s on %s: a feature is enabled or disabled, with no value and no per-seat growth", r.Key, plan)
			}
			continue
		}
		switch {
		case !hasInc || inc < 0:
			fail("%s on %s: per_additional_paid_seat must be 0 or more", r.Key, plan)
		case v.State == StateLimited && (v.Value == nil || *v.Value < 0):
			fail("%s on %s: a limited value must be 0 or more", r.Key, plan)
		case v.State == StateUnlimited && (v.Value != nil || inc != 0):
			fail("%s on %s: unlimited has no value and no per-seat growth", r.Key, plan)
		case v.State == StateUnlimited && !def.AllowUnlimited:
			fail("%s on %s: may not be unlimited", r.Key, plan)
		case v.State != StateLimited && v.State != StateUnlimited:
			fail("%s on %s: state %q must be limited or unlimited", r.Key, plan, v.State)
		}
	}
}

func (o Offer) validateTrial(fail func(string, ...any)) {
	t := o.Trial
	if !slices.Contains(planOrder, t.AccessPlan) || t.Days < 1 || t.Seats < 1 {
		fail("trial: access_plan must be a plan, days and seats 1 or more")
	}
	for _, key := range slices.Sorted(maps.Keys(t.Overrides)) {
		if r, ok := o.record(key); !ok || r.Type == KindAccess || t.Overrides[key] < 0 {
			fail("trial.overrides.%s: not a limit, or below 0", key)
		}
	}
}

// validateAIFunding: on every plan the AI cost budget pays for the whole token pool at the sold model's worst mix,
// for the first seat, for each further one and in the trial, so the cost guard never silently shrinks the pool.
func (o Offer) validateAIFunding(fail func(string, ...any)) {
	tokens, okT := o.record(string(AITokens))
	cost, okC := o.record(string(AICost))
	if !okT || !okC {
		return // reported as missing
	}
	card := aimodel.Cards[aimodel.DefaultModel]
	check := func(where string, t, c int64) {
		if err := card.Funds(t, c); err != nil {
			fail("%s: %v", where, err)
		}
	}
	for _, plan := range planOrder {
		t, c := tokens.Values[plan], cost.Values[plan]
		if t.State != StateLimited || c.State != StateLimited || t.Value == nil || c.Value == nil {
			continue // a state error is reported with the record
		}
		check("ai_cost_usd_micros on "+plan, *t.Value, *c.Value)
		check("ai_cost_usd_micros per paid seat on "+plan, tokens.PerAdditionalPaidSeat[plan], cost.PerAdditionalPaidSeat[plan])
	}
	check("trial.overrides.ai_cost_usd_micros", o.Trial.Overrides[string(AITokens)], o.Trial.Overrides[string(AICost)])
}

// validatePublic: the comparison names business features and customer allowances only, never an internal key or a
// technical guard, with plain-text labels (the website renders them as text, but they must not carry markup).
func (o Offer) validatePublic(fail func(string, ...any)) {
	p := o.PublicPricing
	internal := map[string]bool{}
	for _, key := range p.InternalOnlyKeys {
		if _, ok := o.record(key); !ok {
			fail("public_pricing.internal_only_keys: unknown %s", key)
		}
		internal[key] = true
	}
	limit := func(where, key string) {
		r, ok := o.record(key)
		switch {
		case !ok:
			fail("%s: unknown %s", where, key)
		case r.Type == KindAccess || r.Type == KindGuard || internal[key]:
			fail("%s: %s is a feature, a technical guard or internal, not a customer allowance", where, key)
		}
	}
	if len(p.ComparisonRows) == 0 || len(p.UsageDetailsKeys) == 0 {
		fail("public_pricing: comparison_rows and usage_details_keys must not be empty")
	}
	rows := map[string]bool{}
	for _, row := range p.ComparisonRows {
		where := "public_pricing.comparison_rows." + row.Key
		if row.Key == "" || rows[row.Key] {
			fail("%s: a row needs its own key", where)
		}
		rows[row.Key] = true
		if strings.TrimSpace(row.LabelEN) == "" || strings.ContainsAny(row.LabelEN+row.NoteEN, "<>") {
			fail("%s: label_en must be plain text, note_en too", where)
		}
		if len(row.FeatureKeys) == 0 {
			fail("%s: a row needs at least one feature", where)
		}
		for _, key := range row.FeatureKeys {
			if r, ok := o.record(key); !ok || r.Type != KindAccess || internal[key] {
				fail("%s: %s is not a public feature", where, key)
			}
		}
		for _, key := range row.LimitKeys {
			limit(where, key)
		}
	}
	for _, key := range p.UsageDetailsKeys {
		limit("public_pricing.usage_details_keys", key)
	}
}

// planValues are the offer's rows of limit_plans.
func (o Offer) planValues() []store.PlanValue {
	out := make([]store.PlanValue, 0, len(o.Records)*len(planOrder))
	for _, r := range o.Records {
		for _, plan := range planOrder {
			v := r.Values[plan]
			out = append(out, store.PlanValue{Plan: plan, Key: r.Key, State: v.State, Value: v.Value, PerSeat: r.PerAdditionalPaidSeat[plan]})
		}
	}
	return out
}

// DiffOffers lists what changes from a to b, one line per changed value, sorted.
func DiffOffers(a, b Offer) []string {
	fa, fb := a.flat(), b.flat()
	var out []string
	for _, k := range slices.Sorted(maps.Keys(fa)) {
		if fb[k] != fa[k] {
			out = append(out, fmt.Sprintf("%s: %s -> %s", k, orNone(fa[k]), orNone(fb[k])))
		}
	}
	for _, k := range slices.Sorted(maps.Keys(fb)) {
		if _, ok := fa[k]; !ok {
			out = append(out, fmt.Sprintf("%s: (none) -> %s", k, fb[k]))
		}
	}
	slices.Sort(out)
	return out
}

func orNone(s string) string {
	if s == "" {
		return "(none)"
	}
	return s
}

// flat is the offer as one line per value, for DiffOffers.
func (o Offer) flat() map[string]string {
	j := func(v any) string { b, _ := json.Marshal(v); return string(b) }
	out := map[string]string{"currencies": j(o.Billing.Currencies), "schema_version": j(o.SchemaVersion),
		"pooled": j(o.UsagePolicy.Pooled), "trial": j(o.Trial)}
	for plan, p := range o.Billing.Plans {
		out["price."+plan] = fmt.Sprintf("%d/month %d/year", p.MonthMinor, p.YearMinor)
	}
	for _, r := range o.Records {
		for plan, v := range r.Values {
			s := v.State
			if v.Value != nil {
				s += fmt.Sprintf(" %d", *v.Value)
			}
			if inc := r.PerAdditionalPaidSeat[plan]; inc != 0 {
				s += fmt.Sprintf(" +%d/seat", inc)
			}
			out[r.Key+"."+plan] = s
		}
	}
	for _, row := range o.PublicPricing.ComparisonRows {
		out["public.row."+row.Key] = j(row)
	}
	out["public.usage_details"] = j(o.PublicPricing.UsageDetailsKeys)
	out["public.internal_only"] = j(o.PublicPricing.InternalOnlyKeys)
	return out
}

var errOfferUnchanged = errors.New("the offer has the same terms as the current one: nothing to publish")

// PublishOffer validates o against the definitions and makes it the current offer, with its limit_plans rows and an
// audit row (the previous current offer before, o after), in one transaction. Workspaces keep the offer they are on.
func PublishOffer(ctx context.Context, db *store.Store, o Offer, actor, reason string) error {
	if strings.TrimSpace(actor) == "" || strings.TrimSpace(reason) == "" {
		return errors.New("publishing an offer needs an actor and a reason")
	}
	doc, err := json.Marshal(o)
	if err != nil {
		return err
	}
	return db.Tx(ctx, func(q store.Q) error {
		if err := q.LockOffers(ctx); err != nil {
			return err
		}
		defs, err := q.LimitDefs(ctx)
		if err != nil {
			return err
		}
		if err := o.Validate(defs); err != nil {
			return err
		}
		cur, err := q.CurrentOffer(ctx)
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if err == nil && cur.Checksum == o.Checksum() {
			return errOfferUnchanged
		}
		v := store.OfferVersion{ID: o.ID, SchemaVersion: o.SchemaVersion, Checksum: o.Checksum(), Document: doc}
		if err := q.InsertOffer(ctx, v, o.planValues()); err != nil {
			return err
		}
		var before any
		if cur.ID != "" {
			before = map[string]string{"offer_id": cur.ID, "checksum": cur.Checksum}
		}
		return q.AuditOffer(ctx, actor, "offer.publish", o.ID, before, map[string]string{"offer_id": o.ID, "checksum": v.Checksum}, reason)
	})
}

// LoadOffer reads a published offer's document.
func LoadOffer(v store.OfferVersion) (Offer, error) {
	var o Offer
	if err := json.Unmarshal(v.Document, &o); err != nil {
		return Offer{}, fmt.Errorf("offer %s: %w", v.ID, err)
	}
	return o, nil
}
