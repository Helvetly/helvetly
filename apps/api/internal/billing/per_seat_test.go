package billing

import (
	"context"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func seatsOf(e *env, ws string) int64 {
	e.t.Helper()
	b := e.billing(ws)
	if b.Seats == nil {
		e.t.Fatalf("no seats recorded: %+v", b)
	}
	return *b.Seats
}

// Checkout bills a per-seat price for every member (open invitations take no seat); a flat price for one.
func TestCheckoutQuantity(t *testing.T) {
	for _, tc := range []struct {
		name    string
		perSeat bool
		want    string
	}{
		{"per seat", true, "3"},
		{"flat price not yet replaced", false, "1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t, true)
			if tc.perSeat {
				e.stripe.setPerSeat()
			}
			owner := e.workspace()
			e.join(owner.workspace, "admin")
			e.join(owner.workspace, "member")
			e.exec(`INSERT INTO workspace_invitations (id, workspace_id, email, role, token_hash, created_at, expires_at)
				VALUES ('inv_1', $1, 'b@example.com', 'member', 'h1', now(), now() + interval '1 day')`, owner.workspace)
			if code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
				t.Fatalf("checkout: %d %v", code, body)
			}
			if q := e.stripe.form("POST /v1/checkout/sessions").Get("line_items[0][quantity]"); q != tc.want {
				t.Fatalf("quantity %q, want %q", q, tc.want)
			}
		})
	}
}

// A per-seat subscription takes people up to the self-service seats (25: 24 besides the owner) on every plan; the
// overview says how the subscription is billed and for how many.
func TestPerSeatSubscription(t *testing.T) {
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	for range 3 { // more than Basic's flat cap of 2 besides the owner
		e.join(owner.workspace, "member")
	}
	if code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Basic, "interval": "month"}); code != http.StatusOK {
		t.Fatalf("checkout of per-seat Basic with 4 people: %d %v", code, body)
	}
	e.stripe.put("sub_1", owner.workspace, "cus_1", "active", "price_bm") // the customer Checkout made
	e.event("evt_1", "customer.subscription.created", map[string]any{"id": "sub_1"})
	if b := e.billing(owner.workspace); !b.PerSeat {
		t.Fatalf("not per seat: %+v", b)
	}
	if code, _ := e.do(owner, http.MethodPost, "/api/v1/members/invitations", map[string]string{"email": "x@example.com"}); code != http.StatusCreated {
		t.Fatalf("invite on a per-seat plan: %d", code)
	}
	if err := e.svc.AllowResource(context.Background(), e.st.Q, owner.workspace, string(Members), 1); err != nil {
		t.Fatalf("admission on a per-seat plan: %v", err)
	}

	code, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	data, _ := body["data"].(map[string]any)
	usage, _ := data["usage"].([]any)
	members, _ := usage[0].(map[string]any)
	plansList, _ := data["plans"].([]any)
	basic, _ := plansList[0].(map[string]any)
	limits, _ := basic["limits"].(map[string]any)
	if code != http.StatusOK || data["pricing"] != "per_seat" || data["seats"] != 4.0 || members["used"] != 3.0 || members["max"] != 4.0 ||
		limits["members"] != 4.0 || limits["clients"] == nil || data["paid_seats"] != 4.0 {
		t.Fatalf("overview: %d %v", code, body)
	}
}

// A subscription on an earlier flat price keeps its member cap until it changes plan; the change moves it to the
// per-seat price for every member.
func TestFlatSubscriptionMovesToPerSeatOnChange(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	e.join(owner.workspace, "member")
	e.join(owner.workspace, "member")
	e.subscribe(owner.workspace, "price_bm") // flat, before per-seat prices were deployed
	e.setPlanValue(Basic, MaxSeats, StateLimited, n64(3))
	e.stripe.setPerSeat()

	code, body := e.do(owner, http.MethodPost, "/api/v1/members/invitations", map[string]string{"email": "x@example.com"})
	if errBody, _ := body["error"].(map[string]any); code != http.StatusPaymentRequired || errBody["code"] != "limit_reached" {
		t.Fatalf("invite over the flat cap: %d %v", code, body)
	}
	_, body = e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	if data, _ := body["data"].(map[string]any); data["pricing"] != "flat" || data["seats"] != 3.0 {
		t.Fatalf("flat overview: %v", body)
	}

	if code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Pro, "interval": "month"}); code != http.StatusOK {
		t.Fatalf("change: %d %v", code, body)
	}
	if f := e.stripe.form("POST /v1/subscriptions/sub_" + owner.workspace); f.Get("items[0][price]") != "price_pm" || f.Get("items[0][quantity]") != "3" {
		t.Fatalf("change form %v", f)
	}
	if b := e.billing(owner.workspace); !b.PerSeat || b.Plan != Pro || seatsOf(e, owner.workspace) != 3 {
		t.Fatalf("after the change: %+v", b)
	}
}

// SyncSeats bills a per-seat subscription for the members it has, prorated; it leaves a flat one and an unchanged
// count alone, and the job catches up on a workspace out of step.
func TestSyncSeats(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	e.subscribe(owner.workspace, "price_pm")
	path := "POST /v1/subscriptions/sub_" + owner.workspace

	e.svc.SyncSeats(ctx, owner.workspace)
	if n := e.stripe.called(path); n != 0 {
		t.Fatalf("synced an unchanged count: %d calls", n)
	}

	e.join(owner.workspace, "member")
	e.svc.SyncSeats(ctx, owner.workspace)
	// Charged at once, prorated from the membership change.
	f := e.stripe.form(path)
	at, _ := strconv.ParseInt(f.Get("proration_date"), 10, 64)
	if f.Get("items[0][quantity]") != "2" || f.Get("proration_behavior") != "always_invoice" || f.Has("items[0][price]") ||
		at < periodStart || at > time.Now().Unix() {
		t.Fatalf("sync form %v", f)
	}
	if seatsOf(e, owner.workspace) != 2 {
		t.Fatalf("seats %d, want 2", seatsOf(e, owner.workspace))
	}

	// A failed sync leaves the count behind; the job bills it on its next run.
	e.join(owner.workspace, "member")
	e.stripe.setFail(true)
	e.svc.SyncSeats(ctx, owner.workspace)
	e.stripe.setFail(false)
	if seatsOf(e, owner.workspace) != 2 {
		t.Fatalf("a failed sync changed the seats")
	}
	if err := e.svc.SeatsTick(ctx); err != nil || seatsOf(e, owner.workspace) != 3 {
		t.Fatalf("job: %v, seats %d", err, seatsOf(e, owner.workspace))
	}
	calls := e.stripe.called(path)
	if err := e.svc.SeatsTick(ctx); err != nil || e.stripe.called(path) != calls {
		t.Fatalf("job synced a workspace in step: %v", err)
	}
}

// A flat subscription is not billed per member.
func TestSyncSeatsLeavesAFlatSubscription(t *testing.T) {
	ctx := context.Background()
	flat := newEnv(t, true)
	other := flat.workspace()
	flat.subscribe(other.workspace, "price_pm")
	flat.join(other.workspace, "member")
	flat.svc.SyncSeats(ctx, other.workspace)
	if err := flat.svc.SeatsTick(ctx); err != nil || flat.stripe.called("POST /v1/subscriptions/sub_"+other.workspace) != 0 {
		t.Fatalf("synced a flat subscription: %v", err)
	}
}

func TestSyncSeatsWithoutBilling(t *testing.T) {
	e := newEnv(t, false)
	owner := e.workspace()
	e.svc.SyncSeats(context.Background(), owner.workspace)
	if err := e.svc.SeatsTick(context.Background()); err != nil || len(e.stripe.calls) != 0 {
		t.Fatalf("billing off: %v %v", err, e.stripe.calls)
	}
}

// A subscription read from Stripe that bills another number of seats than the workspace's people is synced.
func TestApplyResyncsSeatsOutOfStep(t *testing.T) {
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	e.join(owner.workspace, "member")
	e.join(owner.workspace, "admin")
	e.subscribe(owner.workspace, "price_pm") // Stripe bills 1 seat
	if f := e.stripe.form("POST /v1/subscriptions/sub_" + owner.workspace); f.Get("items[0][quantity]") != "3" {
		t.Fatalf("resync form %v", f)
	}
	if seatsOf(e, owner.workspace) != 3 {
		t.Fatalf("seats %d, want 3", seatsOf(e, owner.workspace))
	}
	calls := e.stripe.called("POST /v1/subscriptions/sub_" + owner.workspace)
	e.event("evt_again", "customer.subscription.updated", map[string]any{"id": "sub_" + owner.workspace})
	if n := e.stripe.called("POST /v1/subscriptions/sub_" + owner.workspace); n != calls {
		t.Fatalf("resynced a subscription in step: %d calls", n)
	}
}

// During the trial seats are free: the quantity follows without proration.
func TestSyncSeatsInTheTrial(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	e.stripe.put("sub_"+owner.workspace, owner.workspace, "cus_"+owner.workspace, "trialing", "price_bm")
	e.event("evt_trial", "customer.subscription.created", map[string]any{"id": "sub_" + owner.workspace})
	e.join(owner.workspace, "member")
	e.svc.SyncSeats(ctx, owner.workspace)
	if f := e.stripe.form("POST /v1/subscriptions/sub_" + owner.workspace); f.Get("proration_behavior") != "none" || f.Has("proration_date") ||
		f.Get("items[0][quantity]") != "2" {
		t.Fatalf("sync form %v", f)
	}
}

func TestProrationDate(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	at := func(d time.Duration) *time.Time { t := now.Add(d); return &t }
	for _, tc := range []struct {
		name    string
		changed *time.Time
		start   int64
		want    int64
	}{
		{"the membership change", at(-time.Hour), now.Add(-48 * time.Hour).Unix(), now.Add(-time.Hour).Unix()},
		{"unknown: now", nil, now.Add(-48 * time.Hour).Unix(), now.Unix()},
		{"before the period: its start", at(-72 * time.Hour), now.Add(-48 * time.Hour).Unix(), now.Add(-48 * time.Hour).Unix()},
		{"in the future: now", at(time.Hour), now.Add(-48 * time.Hour).Unix(), now.Unix()},
	} {
		if got := prorationDate(tc.changed, tc.start, now); got != tc.want {
			t.Errorf("%s: %d, want %d", tc.name, got, tc.want)
		}
	}
}
