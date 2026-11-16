package billing

import (
	"net/http"
	"testing"
)

// peopleLimits are the offer on sale's people limits (owner included): Basic 5, Pro 25, Business none.
var peopleLimits = []struct {
	plan, price string
	people      int64 // the most people a workspace on the plan may have; 0: no limit
}{{Basic, "price_bm", 5}, {Pro, "price_pm", 25}, {Business, "price_xm", 0}}

func seatsOfWorkspace(e *env, ws string) int64 {
	e.t.Helper()
	var n int64
	if err := e.raw.QueryRow(e.t.Context(), `SELECT count(*) FROM workspace_members WHERE workspace_id = $1`, ws).Scan(&n); err != nil {
		e.t.Fatal(err)
	}
	return n
}

// Invitations stop at the plan's people limit: Basic owner + 4, Pro 25 in all, Business none, and nobody is ever
// removed by reaching it.
func TestInvitationsStopAtThePlansPeopleLimit(t *testing.T) {
	for _, tc := range peopleLimits {
		t.Run(tc.plan, func(t *testing.T) {
			e := newEnv(t, true)
			e.stripe.setPerSeat()
			owner := e.workspace()
			e.subscribe(owner.workspace, tc.price)
			if r := mustRights(t, e, owner.workspace); r.OfferID != currentOffer {
				t.Fatalf("sold on %q, want the offer on sale", r.OfferID)
			}
			invite := func(email string) int {
				code, _ := e.do(owner, http.MethodPost, "/api/v1/members/invitations", map[string]string{"email": email})
				return code
			}
			target := tc.people
			if target == 0 {
				target = 30 // far over what any other plan allows
			}
			for seatsOfWorkspace(e, owner.workspace) < target-1 { // one place left
				e.join(owner.workspace, "member")
			}
			if code := invite("last@example.com"); code < 200 || code > 299 {
				t.Fatalf("the last place of %d people refused: %d", target, code)
			}
			e.join(owner.workspace, "member") // the invitation accepted
			code, body := e.do(owner, http.MethodPost, "/api/v1/members/invitations", map[string]string{"email": "over@example.com"})
			errBody, _ := body["error"].(map[string]any)
			if tc.people == 0 {
				if code < 200 || code > 299 {
					t.Fatalf("Business has no people limit: %d %v", code, body)
				}
				return
			}
			if code != http.StatusPaymentRequired || errBody["code"] != "limit_reached" {
				t.Fatalf("person %d on %s: %d %v", tc.people+1, tc.plan, code, body)
			}
			if n := seatsOfWorkspace(e, owner.workspace); n != tc.people {
				t.Fatalf("%d people after the refusal, want %d: nobody is removed", n, tc.people)
			}
		})
	}
}

// Checkout refuses a workspace with more people than the plan allows, and Business takes any number.
func TestCheckoutHonoursThePeopleLimit(t *testing.T) {
	for _, tc := range peopleLimits {
		for _, people := range []int64{tc.people, tc.people + 1, 30} {
			if tc.people == 0 && people != 30 {
				continue
			}
			t.Run(tc.plan, func(t *testing.T) {
				e := newEnv(t, true)
				e.stripe.setPerSeat()
				owner := e.workspace()
				for seatsOfWorkspace(e, owner.workspace) < people {
					e.join(owner.workspace, "member")
				}
				code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": tc.plan, "interval": "month"})
				refused := tc.people != 0 && people > tc.people
				if refused {
					errBody, _ := body["error"].(map[string]any)
					if code != http.StatusConflict || errBody["code"] != "too_many_seats" {
						t.Fatalf("%d people on %s: %d %v", people, tc.plan, code, body)
					}
					return
				}
				if code != http.StatusOK {
					t.Fatalf("%d people on %s: %d %v", people, tc.plan, code, body)
				}
			})
		}
	}
}

// Changing to a plan with a lower people limit never removes anyone: the change is refused or keeps every member.
func TestDowngradeNeverRemovesPeople(t *testing.T) {
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	e.subscribe(owner.workspace, "price_xm") // Business
	for range 7 {
		e.join(owner.workspace, "member")
	}
	before := seatsOfWorkspace(e, owner.workspace) // 8 people, over Basic's 5
	code, body := e.do(owner, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": Basic, "interval": "month"})
	t.Logf("Business with %d people to Basic: %d %v", before, code, body)
	if after := seatsOfWorkspace(e, owner.workspace); after != before {
		t.Fatalf("%d people before the change, %d after: members were removed", before, after)
	}
}

// legacyOffer is the offer sold before 2026-11, which migration 00018 left Basic (25 people) and Pro workspaces on.
const legacyOffer = "helvetly"

// legacy puts a subscribed workspace on the legacy offer, as the migration left it.
func (e *env) legacy(ws string) {
	e.t.Helper()
	e.exec(`UPDATE workspace_billing SET offer_id = $2 WHERE workspace_id = $1`, ws, legacyOffer)
}

func (e *env) offerOf(ws string) string {
	e.t.Helper()
	var id string
	if err := e.raw.QueryRow(e.t.Context(), `SELECT offer_id FROM workspace_billing WHERE workspace_id = $1`, ws).Scan(&id); err != nil {
		e.t.Fatal(err)
	}
	return id
}

// moves are the offer moves billing audited for the workspace, as "from>to".
func (e *env) moves(ws string) []string {
	e.t.Helper()
	rows, err := e.raw.Query(e.t.Context(), `SELECT (before->>'offer_id') || '>' || (after->>'offer_id') FROM offer_audit
		WHERE actor = 'billing' AND action = 'offer.assign' AND after->>'workspace_id' = $1 ORDER BY id`, ws)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			e.t.Fatal(err)
		}
		out = append(out, m)
	}
	return out
}

// cardMembers is the members limit the overview's card of plan shows; -1 for none.
func (e *env) cardMembers(b *browser, plan string) int64 {
	e.t.Helper()
	code, body := e.do(b, http.MethodGet, "/api/v1/billing", nil)
	data, _ := body["data"].(map[string]any)
	plans, _ := data["plans"].([]any)
	if code != http.StatusOK || len(plans) != 3 {
		e.t.Fatalf("overview: %d %v", code, body)
	}
	for _, p := range plans {
		card, _ := p.(map[string]any)
		if card["id"] != plan {
			continue
		}
		limits, _ := card["limits"].(map[string]any)
		if v, ok := limits[string(Members)].(float64); ok {
			return int64(v)
		}
		return -1
	}
	e.t.Fatalf("no card for %s", plan)
	return 0
}

func (e *env) choose(b *browser, plan string) (int, map[string]any) {
	e.t.Helper()
	return e.do(b, http.MethodPost, "/api/v1/billing/checkout", map[string]string{"plan": plan, "interval": "month"})
}

func (e *env) invite(b *browser, email string) int {
	e.t.Helper()
	code, _ := e.do(b, http.MethodPost, "/api/v1/members/invitations", map[string]string{"email": email})
	return code
}

// A paid Pro on the legacy offer that buys Business gets Business as the cards show it: no people limit. The move is
// audited once; a redelivered event changes nothing.
func TestLegacyProBuysUnlimitedBusiness(t *testing.T) {
	e := newEnv(t, true)
	e.stripe.setPerSeat()
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_pm")
	e.legacy(ws)
	for seatsOfWorkspace(e, ws) < 25 {
		e.join(ws, "member")
	}
	if code := e.invite(owner, "p26@example.com"); code != http.StatusPaymentRequired {
		t.Fatalf("person 26 on the legacy Pro: %d", code)
	}
	if pro, business := e.cardMembers(owner, Pro), e.cardMembers(owner, Business); pro != 24 || business != -1 {
		t.Fatalf("cards: Pro %d, Business %d members; want 24 and none", pro, business)
	}
	if code, body := e.choose(owner, Business); code != http.StatusOK || e.billing(ws).Plan != Business {
		t.Fatalf("upgrade: %d %v", code, body)
	}
	if got := e.offerOf(ws); got != currentOffer {
		t.Fatalf("Business bought on %q, want %q", got, currentOffer)
	}
	if m := e.moves(ws); len(m) != 1 || m[0] != legacyOffer+">"+currentOffer {
		t.Fatalf("audited moves %v", m)
	}
	if e.cap(ws, MaxSeats) != Unlimited {
		t.Fatalf("Business people limit %d, want none", e.cap(ws, MaxSeats))
	}
	if code := e.invite(owner, "p26@example.com"); code < 200 || code > 299 {
		t.Fatalf("person 26 on Business: %d", code)
	}
	e.join(ws, "member")
	if n := seatsOfWorkspace(e, ws); n != 26 {
		t.Fatalf("%d people, want 26", n)
	}
	if code := e.event("evt_again", "customer.subscription.updated", map[string]any{"id": "sub_" + ws}); code != http.StatusOK {
		t.Fatalf("redelivery: %d", code)
	}
	if m := e.moves(ws); len(m) != 1 || e.offerOf(ws) != currentOffer {
		t.Fatalf("after a redelivery: %v on %s", m, e.offerOf(ws))
	}
}

// An upgrade that waits for its payment moves nothing until the paid change is recorded.
func TestLegacyBusinessOfferWaitsForThePayment(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_pm")
	e.legacy(ws)
	e.stripe.mu.Lock()
	e.stripe.declines = true
	e.stripe.mu.Unlock()
	if code, body := e.choose(owner, Business); code != http.StatusPaymentRequired {
		t.Fatalf("unpaid upgrade: %d %v", code, body)
	}
	if b := e.billing(ws); b.Plan != Pro || e.offerOf(ws) != legacyOffer || len(e.moves(ws)) != 0 {
		t.Fatalf("an unpaid upgrade moved: %s on %s, %v", b.Plan, e.offerOf(ws), e.moves(ws))
	}
	e.stripe.mu.Lock()
	e.stripe.declines = false
	e.stripe.mu.Unlock()
	e.stripe.put("sub_"+ws, ws, "cus_"+ws, "active", "price_xm") // paid: Stripe applies the change
	if code := e.event("evt_paid", "customer.subscription.updated", map[string]any{"id": "sub_" + ws}); code != http.StatusOK {
		t.Fatalf("paid: %d", code)
	}
	if b := e.billing(ws); b.Plan != Business || e.offerOf(ws) != currentOffer || len(e.moves(ws)) != 1 {
		t.Fatalf("paid upgrade: %s on %s, %v", b.Plan, e.offerOf(ws), e.moves(ws))
	}
}

// A workspace an override holds to the legacy offer keeps it, and its override, on Business; its cards say so.
func TestOverrideKeepsTheLegacyOfferOnBusiness(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_pm")
	e.legacy(ws)
	e.override(ws, Clients, StateLimited, n64(7), nil)
	if business := e.cardMembers(owner, Business); business != 24 {
		t.Fatalf("Business card %d members, want the legacy 24", business)
	}
	if code, body := e.choose(owner, Business); code != http.StatusOK || e.billing(ws).Plan != Business {
		t.Fatalf("upgrade: %d %v", code, body)
	}
	if e.offerOf(ws) != legacyOffer || len(e.moves(ws)) != 0 || e.cap(ws, Clients) != 7 || e.cap(ws, MaxSeats) != 25 {
		t.Fatalf("held workspace: %s, %v, clients %d, seats %d", e.offerOf(ws), e.moves(ws), e.cap(ws, Clients), e.cap(ws, MaxSeats))
	}
	if business := e.cardMembers(owner, Business); business != 24 {
		t.Fatalf("current Business card %d members, want 24", business)
	}
}

// A Basic sold before 2026-11 keeps its 25 people, shown on its card, also through an upgrade to Pro.
func TestLegacyBasicKeepsItsTerms(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_bm")
	e.legacy(ws)
	if basic, pro, business := e.cardMembers(owner, Basic), e.cardMembers(owner, Pro), e.cardMembers(owner, Business); basic != 24 || pro != 24 || business != -1 {
		t.Fatalf("cards: Basic %d, Pro %d, Business %d; want 24, 24, none", basic, pro, business)
	}
	if code, body := e.choose(owner, Pro); code != http.StatusOK || e.billing(ws).Plan != Pro {
		t.Fatalf("upgrade: %d %v", code, body)
	}
	if e.offerOf(ws) != legacyOffer || len(e.moves(ws)) != 0 {
		t.Fatalf("Basic to Pro moved: %s %v", e.offerOf(ws), e.moves(ws))
	}
}

// A Business the migration left on the legacy offer (an override) shows its real limit and stays on its offer.
func TestExcludedLegacyBusinessShowsItsTerms(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_xm")
	e.legacy(ws)
	e.override(ws, Clients, StateLimited, n64(7), nil)
	if business := e.cardMembers(owner, Business); business != 24 {
		t.Fatalf("current Business card %d members, want 24", business)
	}
	if code := e.event("evt_renewed", "customer.subscription.updated", map[string]any{"id": "sub_" + ws}); code != http.StatusOK {
		t.Fatalf("renewal: %d", code)
	}
	if e.offerOf(ws) != legacyOffer || len(e.moves(ws)) != 0 {
		t.Fatalf("a renewal moved: %s %v", e.offerOf(ws), e.moves(ws))
	}
}

// A Business the migration left on the legacy offer for its scheduled change (no override) shows the 25 people it
// holds, and neither a renewal nor cancelling the change moves it.
func TestPendingLegacyBusinessShowsItsTerms(t *testing.T) {
	e := newEnv(t, true)
	owner := e.workspace()
	ws := owner.workspace
	e.subscribe(ws, "price_xm")
	e.legacy(ws)
	if code, body := e.choose(owner, Pro); code != http.StatusOK || e.billing(ws).PendingPlan != Pro {
		t.Fatalf("scheduling Pro: %d %v %+v", code, body, e.billing(ws))
	}
	if business := e.cardMembers(owner, Business); business != 24 {
		t.Fatalf("current Business card %d members, want the legacy 24", business)
	}
	if code := e.event("evt_renewed", "customer.subscription.updated", map[string]any{"id": "sub_" + ws}); code != http.StatusOK {
		t.Fatalf("renewal: %d", code)
	}
	if b := e.billing(ws); b.PendingPlan != Pro || e.offerOf(ws) != legacyOffer || len(e.moves(ws)) != 0 {
		t.Fatalf("a renewal moved: %+v on %s, %v", b, e.offerOf(ws), e.moves(ws))
	}
	if code, body := e.choose(owner, Business); code != http.StatusOK { // keeps Business: the schedule is released
		t.Fatalf("cancelling the change: %d %v", code, body)
	}
	if b := e.billing(ws); b.Plan != Business || b.PendingPlan != "" || e.offerOf(ws) != legacyOffer || len(e.moves(ws)) != 0 ||
		e.cap(ws, MaxSeats) != 25 {
		t.Fatalf("cancelled change: %+v on %s, %v, seats %d", b, e.offerOf(ws), e.moves(ws), e.cap(ws, MaxSeats))
	}
	if business := e.cardMembers(owner, Business); business != 24 {
		t.Fatalf("current Business card %d members after the cancel, want 24", business)
	}
}
