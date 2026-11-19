package billing

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

// seeded is the offer 00007 publishes, with the definitions.
func seeded(t *testing.T) (*env, Offer, []store.LimitDef) {
	t.Helper()
	e := newEnv(t, true)
	defs, err := e.st.LimitDefs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return e, e.currentOffer(), defs
}

// clone is a deep copy, so a case can change it freely.
func clone(t *testing.T, o Offer) Offer {
	t.Helper()
	b, _ := json.Marshal(o)
	var c Offer
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

// currentOffer is the offer on sale in the seeded database, the one 00031 publishes (00007 published helvetly-v1,
// 00017 helvetly-v1.1, 00018 helvetly-v1.2).
const currentOffer = "helvetly-v1.3"

func recordOf(o *Offer, key string) *OfferRecord {
	return &o.Records[slices.IndexFunc(o.Records, func(r OfferRecord) bool { return r.Key == key })]
}

func TestSeededOffer(t *testing.T) {
	e, o, defs := seeded(t)
	if err := o.Validate(defs); err != nil {
		t.Fatalf("the current offer does not validate: %v", err)
	}
	v, err := e.st.CurrentOffer(context.Background())
	if err != nil || v.ID != currentOffer || v.Checksum != o.Checksum() {
		t.Fatalf("current offer %s, checksum %s, recomputed %s: %v", v.ID, v.Checksum, o.Checksum(), err)
	}
	if o.Trial.AccessPlan != Pro || o.Trial.Days != 7 || o.Trial.Seats != 2 {
		t.Fatalf("the current offer's trial: %+v", o.Trial)
	}
	if len(o.Records) != 69 || len(defs) != 69 || len(o.PublicPricing.ComparisonRows) != 13 || len(o.PublicPricing.UsageDetailsKeys) != 10 {
		t.Fatalf("%d records, %d definitions, %d rows, %d allowances", len(o.Records), len(defs),
			len(o.PublicPricing.ComparisonRows), len(o.PublicPricing.UsageDetailsKeys))
	}
	if len(o.UsagePolicy.Pooled) != 11 {
		t.Fatalf("pooled: %v", o.UsagePolicy.Pooled)
	}
	// limit_plans holds exactly the document's values (the migration materialised them in SQL, Publish does in Go).
	rows, err := e.st.OfferPlanValues(context.Background(), v.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := o.planValues()
	key := func(p store.PlanValue) string { b, _ := json.Marshal(p); return string(b) }
	got := make([]string, 0, len(rows))
	for _, r := range rows {
		got = append(got, key(r))
	}
	exp := make([]string, 0, len(want))
	for _, r := range want {
		exp = append(exp, key(r))
	}
	slices.Sort(got)
	slices.Sort(exp)
	if !slices.Equal(got, exp) {
		t.Fatalf("limit_plans differ from the document: %d rows, %d expected", len(got), len(exp))
	}
}

func TestOfferValidation(t *testing.T) {
	_, base, defs := seeded(t)
	for _, tc := range []struct {
		name   string
		change func(o *Offer)
		want   string
	}{
		{"a missing key", func(o *Offer) { o.Records = o.Records[1:] }, "identity_security: missing"},
		{"an unknown key", func(o *Offer) {
			r := *recordOf(o, "heidi")
			r.Key = "teleport"
			o.Records = append(o.Records, r)
		}, "teleport: unknown key"},
		{"a key twice", func(o *Offer) { o.Records = append(o.Records, o.Records[0]) }, "identity_security: listed twice"},
		{"another unit than its definition", func(o *Offer) { recordOf(o, "storage_bytes").Unit = "MiB" }, "storage_bytes: type, unit"},
		{"a plan missing", func(o *Offer) { delete(recordOf(o, "clients").Values, Pro) }, "clients: values must be given"},
		{"storage unlimited", func(o *Offer) {
			r := recordOf(o, "storage_bytes")
			r.Values[Business] = OfferValue{State: StateUnlimited}
			r.PerAdditionalPaidSeat[Business] = 0
			o.UsagePolicy.Pooled = removed(o.UsagePolicy.Pooled, "storage_bytes")
		}, "storage_bytes on business: may not be unlimited"},
		{"an unlimited pooled limit growing with seats", func(o *Offer) { recordOf(o, "invoices_per_month").PerAdditionalPaidSeat[Business] = 5 },
			"invoices_per_month on business: unlimited has no value and no per-seat growth"},
		{"a negative limit", func(o *Offer) { recordOf(o, "clients").Values[Basic] = OfferValue{State: StateLimited, Value: n64(-1)} }, "clients on basic: a limited value"},
		{"limited without a value", func(o *Offer) { recordOf(o, "clients").Values[Basic] = OfferValue{State: StateLimited} }, "clients on basic: a limited value"},
		{"-1 is not unlimited", func(o *Offer) { recordOf(o, "clients").Values[Basic] = OfferValue{State: "-1"} }, `state "-1"`},
		{"a feature with a value", func(o *Offer) { recordOf(o, "heidi").Values[Pro] = OfferValue{State: StateEnabled, Value: n64(1)} }, "heidi on pro: a feature"},
		{"a feature growing with seats", func(o *Offer) { recordOf(o, "heidi").PerAdditionalPaidSeat = map[string]int64{Pro: 1} }, "heidi on basic: a feature"},
		{"no per-seat growth given", func(o *Offer) { delete(recordOf(o, "clients").PerAdditionalPaidSeat, Pro) }, "clients on pro: per_additional_paid_seat"},
		{"an allowance for a disabled feature", func(o *Offer) {
			r := recordOf(o, "expenses_per_month")
			r.Values[Basic] = OfferValue{State: StateLimited, Value: n64(10)}
			r.PerAdditionalPaidSeat[Basic] = 10
		}, "expenses_per_month on basic: expenses is disabled there"},
		{"a dependent feature on without its base", func(o *Offer) { recordOf(o, "invoice_reminders").Values[Basic] = OfferValue{State: StateEnabled} }, "invoice_reminders on basic: automations is disabled there"},
		{"a pooled limit growing by less than its value", func(o *Offer) { recordOf(o, "storage_bytes").PerAdditionalPaidSeat[Pro] = 1 }, "storage_bytes on pro: a pooled limit"},
		{"another price", func(o *Offer) { o.Billing.Plans[Pro] = PlanPrice{MonthMinor: 4500, YearMinor: 47100} }, "billing.plans.pro"},
		{"a currency missing", func(o *Offer) { o.Billing.Currencies = []string{"CHF", "EUR"} }, "billing.currencies"},
		{"a bad id", func(o *Offer) { o.ID = "Invalid Offer" }, "offer_id"},
		{"a trial override of a feature", func(o *Offer) { o.Trial.Overrides["heidi"] = 1 }, "trial.overrides.heidi"},
		{"an internal key on the pricing page", func(o *Offer) {
			o.PublicPricing.ComparisonRows[0].FeatureKeys = append(o.PublicPricing.ComparisonRows[0].FeatureKeys, "api_access")
		}, "api_access is not a public feature"},
		{"a technical guard on the pricing page", func(o *Offer) {
			o.PublicPricing.UsageDetailsKeys = append(o.PublicPricing.UsageDetailsKeys, "max_upload_bytes")
		}, "max_upload_bytes is a feature, a technical guard or internal"},
		{"the internal AI cost on the pricing page", func(o *Offer) {
			o.PublicPricing.ComparisonRows[5].LimitKeys = append(o.PublicPricing.ComparisonRows[5].LimitKeys, "ai_cost_usd_micros")
		}, "ai_cost_usd_micros is a feature, a technical guard or internal"},
		{"an AI cost budget that cannot fund the token pool", func(o *Offer) {
			recordOf(o, "ai_cost_usd_micros").Values[Pro] = OfferValue{State: StateLimited, Value: n64(2_000_000)}
		}, "ai_cost_usd_micros on pro:"},
		{"an AI cost increment that cannot fund a seat's tokens", func(o *Offer) {
			recordOf(o, "ai_cost_usd_micros").PerAdditionalPaidSeat[Business] = 1
			o.UsagePolicy.Pooled = removed(o.UsagePolicy.Pooled, "ai_cost_usd_micros")
		}, "ai_cost_usd_micros per paid seat on business"},
		{"a trial whose AI cost cannot fund its tokens", func(o *Offer) {
			o.Trial.Overrides["ai_tokens_per_month"], o.Trial.Overrides["ai_cost_usd_micros"] = 1_000_000, 100
		}, "trial.overrides.ai_cost_usd_micros"},
		{"markup in a label", func(o *Offer) { o.PublicPricing.ComparisonRows[0].LabelEN = "<b>Invoices</b>" }, "label_en must be plain text"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o := clone(t, base)
			tc.change(&o)
			err := o.Validate(defs)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("got %v, want %q", err, tc.want)
			}
		})
	}
	// Unlimited is allowed where the definition allows it.
	o := clone(t, base)
	recordOf(&o, "clients").Values[Business] = OfferValue{State: StateUnlimited}
	if err := o.Validate(defs); err != nil {
		t.Fatalf("unlimited clients: %v", err)
	}
}

func TestPublishOffer(t *testing.T) {
	ctx := context.Background()
	e, base, _ := seeded(t)
	b := e.workspace()
	e.subscribe(b.workspace, "price_pm")

	if err := PublishOffer(ctx, e.st, clone(t, base), "op", "again"); !errors.Is(err, errOfferUnchanged) {
		t.Fatalf("same terms: %v", err)
	}
	next := clone(t, base)
	next.ID = "helvetly-v3"
	recordOf(&next, "clients").Values[Pro] = OfferValue{State: StateLimited, Value: n64(400)}
	if err := PublishOffer(ctx, e.st, next, "", "no actor"); err == nil {
		t.Fatal("published without an actor")
	}
	if err := PublishOffer(ctx, e.st, next, "op", "more clients on Pro"); err != nil {
		t.Fatal(err)
	}
	// Published once, never again under the same id, and its values do not change.
	again := clone(t, next)
	recordOf(&again, "clients").Values[Pro] = OfferValue{State: StateLimited, Value: n64(500)}
	if err := PublishOffer(ctx, e.st, again, "op", "reuse the id"); err == nil {
		t.Fatal("published twice under one id")
	}
	if _, err := e.raw.Exec(ctx, `UPDATE limit_plans SET value = 1 WHERE offer_id = $1`, next.ID); err == nil {
		t.Fatal("a published value changed")
	}
	var before, after, reason string
	if err := e.raw.QueryRow(ctx, `SELECT before::text, after::text, reason FROM offer_audit WHERE action = 'offer.publish' AND target = $1`,
		next.ID).Scan(&before, &after, &reason); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(before, `"`+currentOffer+`"`) || !strings.Contains(after, next.ID) || reason != "more clients on Pro" {
		t.Fatalf("audit: %s -> %s (%s)", before, after, reason)
	}
	// The workspace keeps the offer it bought; a new subscription gets the new one.
	if r := mustRights(t, e, b.workspace); r.OfferID != currentOffer || r.Items["clients"].Value != 300 {
		t.Fatalf("existing workspace: %s %+v", r.OfferID, r.Items["clients"])
	}
	n := e.workspace()
	e.subscribe(n.workspace, "price_pm")
	if r := mustRights(t, e, n.workspace); r.OfferID != next.ID || r.Items["clients"].Value != 400 {
		t.Fatalf("new workspace: %s %+v", r.OfferID, r.Items["clients"])
	}
	diff := DiffOffers(base, next)
	if !slices.Equal(diff, []string{"clients.pro: limited 300 -> limited 400"}) {
		t.Fatalf("diff: %v", diff)
	}
}
