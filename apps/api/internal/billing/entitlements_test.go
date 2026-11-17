package billing

import (
	"context"
	"math"
	"net/http"
	"slices"
	"testing"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// rowsOf are a plan's rows of offer o as ResolveLimits reads them, without workspace values.
func rowsOf(o Offer, defs []store.LimitDef, plan string) []store.ResolvedLimit {
	out := make([]store.ResolvedLimit, 0, len(defs))
	for _, d := range defs {
		l := store.ResolvedLimit{LimitDef: d}
		if r, ok := o.record(d.Key); ok {
			v := r.Values[plan]
			l.Plan = &store.PlanValue{Plan: plan, Key: d.Key, State: v.State, Value: v.Value, PerSeat: r.PerAdditionalPaidSeat[plan]}
		}
		out = append(out, l)
	}
	return out
}

// TestResolveMatrix: every key of the current offer on every plan for 1, 2, 5 and 25 paid seats. The pooled limits grow
// by their full value with each seat (an unlimited one stays unlimited), everything else stays the workspace's, and a limit whose feature is off stays 0.
func TestResolveMatrix(t *testing.T) {
	_, o, defs := seeded(t)
	pooled := map[string]bool{}
	for _, k := range o.UsagePolicy.Pooled {
		pooled[k] = true
	}
	for _, plan := range planOrder {
		for _, seats := range []int64{1, 2, 5, 25} {
			r, err := resolve(rowsOf(o, defs, plan), seats)
			if err != nil {
				t.Fatal(err)
			}
			for _, rec := range o.Records {
				e, v := r.Items[rec.Key], rec.Values[plan]
				switch {
				case e.Source != SourcePlan || e.State != v.State:
					t.Errorf("%s %s × %d: %+v from %+v", plan, rec.Key, seats, e, v)
				case v.State != StateLimited:
				case rec.Key == "seats" && e.Value != seats:
					t.Errorf("%s seats × %d: %d", plan, seats, e.Value)
				case pooled[rec.Key] && e.Value != *v.Value*seats:
					t.Errorf("%s %s × %d: %d, want %d × %d", plan, rec.Key, seats, e.Value, *v.Value, seats)
				case !pooled[rec.Key] && rec.Key != "seats" && e.Value != *v.Value:
					t.Errorf("%s %s × %d: %d, want the workspace's %d", plan, rec.Key, seats, e.Value, *v.Value)
				}
			}
		}
	}
	// The owner's examples (offer-v2.json, implementation.md §4, §9).
	for _, c := range []struct {
		plan  string
		seats int64
		key   Limit
		want  int64
	}{
		{Pro, 2, Storage, 10_000_000_000}, {Pro, 2, AITokens, 10_000_000}, {Pro, 2, "ai_cost_usd_micros", 6_000_000},
		{Business, 5, Storage, 100_000_000_000}, {Business, 5, AITokens, 100_000_000}, {Business, 5, "ai_cost_usd_micros", 60_000_000},
		{Business, 5, "automation_actions_per_month", 30_000}, {Business, 5, Engagements, Unlimited}, {Business, 5, Clients, Unlimited},
		{Pro, 5, "automation_actions_per_month", 7500}, {Basic, 25, Invoices, 375}, {Basic, 1, Clients, 30},
		{Basic, 25, Expenses, 0}, {Basic, 25, Signatures, 0}, {Basic, 25, "automation_actions_per_month", 0},
		{Basic, 25, Storage, 12_500_000_000}, {Basic, 1, MaxSeats, 5}, {Pro, 1, MaxSeats, 25}, {Business, 1, MaxSeats, Unlimited}, {Business, 26, MaxSeats, Unlimited}, {Basic, 1, AICost, 0}, {Basic, 25, AITokens, 0},
		// The current offer: Pro issues 100 invoices per paid seat; quotes are new; Business counts no records.
		{Pro, 2, Invoices, 200}, {Basic, 1, Quotes, 5}, {Basic, 3, Quotes, 15}, {Pro, 5, Quotes, 500},
		{Business, 25, Quotes, Unlimited}, {Business, 25, Invoices, Unlimited}, {Business, 25, Expenses, Unlimited},
		{Business, 25, Signatures, Unlimited}, {Business, 1, Products, Unlimited}, {Business, 25, Emails, 50_000},
	} {
		r, err := resolve(rowsOf(o, defs, c.plan), c.seats)
		if err != nil {
			t.Fatal(err)
		}
		r.Plan = c.plan
		if got, err := r.Cap(c.key); err != nil || got != c.want {
			t.Errorf("%s × %d %s = %d, want %d (%v)", c.plan, c.seats, c.key, got, c.want, err)
		}
	}
}

func TestResolveStates(t *testing.T) {
	_, o, defs := seeded(t)
	rows := rowsOf(o, defs, Pro)
	at := func(key string) *store.ResolvedLimit {
		return &rows[slices.IndexFunc(rows, func(l store.ResolvedLimit) bool { return l.Key == key })]
	}
	at("clients").Plan = nil                                                                       // missing: nothing new, never unlimited
	at("products").Plan.Value = n64(0)                                                             // zero: none granted
	at("engagements").Plan = &store.PlanValue{State: StateUnlimited}                               // unlimited
	at("invoices_per_month").Workspace = &store.WorkspaceLimit{State: StateLimited, Value: n64(7)} // an operator's value, not grown
	at("automations").Workspace = &store.WorkspaceLimit{State: StateDisabled}
	r, err := resolve(rows, 5)
	if err != nil {
		t.Fatal(err)
	}
	r.Plan = Pro
	if _, err := r.Cap(Clients); err != errEntitlementsUnavailable || r.Items["clients"].State != StateMissing {
		t.Fatalf("missing: %+v %v", r.Items["clients"], err)
	}
	if n, err := r.Cap(Products); err != nil || n != 0 {
		t.Fatalf("zero: %d %v", n, err)
	}
	if n, err := r.Cap(Engagements); err != nil || n != Unlimited {
		t.Fatalf("unlimited: %d %v", n, err)
	}
	if n, err := r.Cap(Invoices); err != nil || n != 7 || r.Items["invoices_per_month"].Source != SourceWorkspace {
		t.Fatalf("override: %d %v", n, err)
	}
	// Disabling automations disables the features that need it and zeroes its allowance, whatever the seats.
	if r.Includes("automations") || r.Includes("invoice_reminders") || r.Includes("engagement_automation") {
		t.Fatal("dependent features stayed enabled")
	}
	if n, _ := r.Cap("automation_actions_per_month"); n != 0 {
		t.Fatalf("automation actions without automations: %d", n)
	}
	if _, err := r.Cap("heidi"); err != errEntitlementsUnavailable {
		t.Fatalf("a feature has no cap: %v", err)
	}

	// Overflow refuses instead of wrapping.
	at("storage_bytes").Plan = &store.PlanValue{State: StateLimited, Value: n64(math.MaxInt64 - 1), PerSeat: 1}
	if _, err := resolve(rows, 3); err == nil {
		t.Fatal("overflow resolved")
	}
	if v, ok := grow(math.MaxInt64-2, 1, 3); !ok || v != math.MaxInt64 {
		t.Fatalf("grow at the edge: %d %v", v, ok)
	}

	// Self-hosted: every feature, no cap; no plan: read-only.
	self := Rights{SelfHosted: true}
	if n, err := self.Cap(Storage); !self.Includes("client_portal") || n != Unlimited || err != nil {
		t.Fatalf("self-hosted: %d %v", n, err)
	}
	if _, err := (Rights{}).Cap(Clients); err != errPlanRequired {
		t.Fatalf("no plan: %v", err)
	}
}

func TestEntitlementsInTheDatabase(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	b := e.workspace()
	e.subscribe(b.workspace, "price_bm")
	e.exec(`UPDATE workspace_billing SET per_seat = true, seats = 5 WHERE workspace_id = $1`, b.workspace)
	r := mustRights(t, e, b.workspace)
	if r.Plan != Basic || r.OfferID != currentOffer || r.Seats != 5 || r.Items["storage_bytes"].Value != 2_500_000_000 ||
		r.Items["clients"].Value != 30 || r.Includes("expenses") || r.Items["expenses_per_month"].Value != 0 {
		t.Fatalf("basic × 5: %+v", r)
	}

	// An override applies until it expires, then the plan's value does again, without a restart.
	now := e.svc.now()
	expires := now.Add(time.Hour)
	e.override(b.workspace, Clients, StateLimited, n64(45), &expires)
	if r := mustRights(t, e, b.workspace); r.Items["clients"].Value != 45 || r.Items["clients"].ExpiresAt == nil {
		t.Fatalf("override: %+v", r.Items["clients"])
	}
	e.svc.now = func() time.Time { return now.Add(2 * time.Hour) }
	if r := mustRights(t, e, b.workspace); r.Items["clients"].Value != 30 || r.Items["clients"].Source != SourcePlan {
		t.Fatalf("after expiry: %+v", r.Items["clients"])
	}
	e.svc.now = func() time.Time { return now }
	past := now.Add(-time.Minute)
	w := store.WorkspaceLimit{WorkspaceID: b.workspace, Key: "clients", State: StateLimited, Value: n64(1), ExpiresAt: &past, Reason: "x"}
	if err := SetWorkspaceOverride(ctx, e.st, w, "op", now); err == nil {
		t.Fatal("an expired override was set")
	}
	for _, bad := range []store.WorkspaceLimit{
		{WorkspaceID: b.workspace, Key: "storage_bytes", State: StateUnlimited, Reason: "x"},
		{WorkspaceID: b.workspace, Key: "heidi", State: StateLimited, Value: n64(1), Reason: "x"},
		{WorkspaceID: b.workspace, Key: "clients", State: StateEnabled, Reason: "x"},
		{WorkspaceID: b.workspace, Key: "teleport", State: StateEnabled, Reason: "x"},
		{WorkspaceID: "wsp_none", Key: "clients", State: StateLimited, Value: n64(1), Reason: "x"},
		{WorkspaceID: b.workspace, Key: "clients", State: StateLimited, Value: n64(1)},
	} {
		if err := SetWorkspaceOverride(ctx, e.st, bad, "op", now); err == nil {
			t.Fatalf("override %+v was set", bad)
		}
	}
	var audits int
	if err := e.raw.QueryRow(ctx, `SELECT count(*) FROM offer_audit WHERE target LIKE $1`, b.workspace+"/%").Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("%d audit rows: %v", audits, err)
	}

	// A plan without an offer is a configuration error: refused, never unlimited.
	e.exec(`UPDATE workspace_billing SET offer_id = NULL WHERE workspace_id = $1`, b.workspace)
	if _, err := e.svc.Entitlements(ctx, e.st.Q, b.workspace); err != errEntitlementsUnavailable {
		t.Fatalf("no offer: %v", err)
	}
	if status, code, _, _ := auth.Describe(e.svc.Require(ctx, e.st.Q, b.workspace, APIAccess)); status != http.StatusServiceUnavailable || code != "entitlements_unavailable" {
		t.Fatalf("require without an offer: %d %s", status, code)
	}
}
