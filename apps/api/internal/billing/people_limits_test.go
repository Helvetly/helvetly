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
