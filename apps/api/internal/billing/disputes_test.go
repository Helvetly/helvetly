package billing

import (
	"context"
	"net/http"
	"testing"
	"time"
)

// chargeback is one workspace on Basic (1M AI tokens a month) with an admin, a subscription invoice's charge
// (ch_sub) and a paid 5M-token pack's charge (ch_pack), as Stripe holds them.
type chargeback struct {
	e  *env
	ws string
}

func newChargeback(t *testing.T) chargeback {
	e := newEnv(t, true)
	owner := e.workspace()
	e.join(owner.workspace, "admin")
	ws, cus := owner.workspace, "cus_"+owner.workspace
	e.subscribe(ws, "price_bm")
	e.stripe.mu.Lock()
	e.stripe.charges["ch_sub"] = map[string]any{"id": "ch_sub", "customer": cus, "payment_intent": "pi_sub", "amount": 1900,
		"amount_refunded": 0, "invoice": map[string]any{"id": "in_1", "subscription": "sub_" + ws}}
	e.stripe.charges["ch_pack"] = map[string]any{"id": "ch_pack", "customer": cus, "payment_intent": "pi_pack", "amount": 4000,
		"amount_refunded": 0, "invoice": nil}
	e.stripe.charges["ch_other"] = map[string]any{"id": "ch_other", "customer": "cus_other", "payment_intent": "pi_other",
		"amount": 1900, "amount_refunded": 0, "invoice": map[string]any{"id": "in_2", "subscription": "sub_" + ws}}
	e.stripe.sessions = append(e.stripe.sessions, map[string]any{"id": "cs_pack", "mode": "payment", "payment_intent": "pi_pack",
		"customer": cus, "payment_status": "paid", "metadata": map[string]string{"workspace_id": ws, AITokensKey: "5000000"}})
	e.stripe.mu.Unlock()
	return chargeback{e, ws}
}

// credit delivers the pack's Checkout Session as paid.
func (c chargeback) credit() {
	c.e.t.Helper()
	cs := map[string]any{"id": "cs_pack", "mode": "payment", "customer": "cus_" + c.ws, "payment_status": "paid",
		"metadata": map[string]string{"workspace_id": c.ws, AITokensKey: "5000000"}}
	if code := c.e.event("evt_credit", "checkout.session.completed", cs); code != http.StatusOK {
		c.e.t.Fatalf("credit: %d", code)
	}
}

// dispute makes Stripe's dispute dp_1 on charge have status, then delivers eventID of type typ about it.
func (c chargeback) dispute(eventID, typ, charge, status string) {
	c.e.t.Helper()
	c.e.stripe.mu.Lock()
	c.e.stripe.disputes["dp_1"] = map[string]any{"id": "dp_1", "status": status, "charge": charge}
	c.e.stripe.mu.Unlock()
	if code := c.e.event(eventID, typ, map[string]any{"id": "dp_1", "status": "stale", "charge": charge}); code != http.StatusOK {
		c.e.t.Fatalf("%s: %d", typ, code)
	}
}

// refund refunds amount of charge in Stripe, then delivers charge.refunded as eventID.
func (c chargeback) refund(eventID, charge string, amount int) {
	c.e.t.Helper()
	c.e.stripe.mu.Lock()
	c.e.stripe.charges[charge]["amount_refunded"] = amount
	c.e.stripe.mu.Unlock()
	if code := c.e.event(eventID, "charge.refunded", map[string]any{"id": charge}); code != http.StatusOK {
		c.e.t.Fatalf("refund: %d", code)
	}
}

func (c chargeback) use(tokens int64) {
	c.e.exec(`INSERT INTO heidi_usage (workspace_id, period, tokens_used, updated_at) VALUES ($1, $2, $3, now())`,
		c.ws, time.Now().UTC().Format("2006-01"), tokens)
}

type outcome struct {
	plan      string // "" once the subscription has ended
	disputed  bool
	allowance int64
	notified  int // billing.payment_disputed notifications (owner and admin: 2 per dispute)
	cancels   int // DELETE calls on the subscription
}

func (c chargeback) outcome() outcome {
	c.e.t.Helper()
	ctx := context.Background()
	disputed, err := c.e.st.Disputed(ctx, c.ws)
	if err != nil {
		c.e.t.Fatal(err)
	}
	allowance, err := c.e.svc.AITokens(ctx, c.e.st.Q, c.ws)
	if err != nil {
		c.e.t.Fatal(err)
	}
	var notified int
	if err := c.e.raw.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE workspace_id = $1 AND event = 'billing.payment_disputed'`,
		c.ws).Scan(&notified); err != nil {
		c.e.t.Fatal(err)
	}
	return outcome{PlanOf(c.e.billing(c.ws)), disputed, allowance, notified, c.e.stripe.called("DELETE /v1/subscriptions/sub_" + c.ws)}
}

func TestChargebacksAndRefunds(t *testing.T) {
	const created, closed, updated = "charge.dispute.created", "charge.dispute.closed", "charge.dispute.updated"
	for _, tc := range []struct {
		name  string
		steps func(c chargeback)
		want  outcome
	}{
		{"an opened dispute alerts the managers once; the plan keeps working", func(c chargeback) {
			c.dispute("evt_1", created, "ch_sub", "needs_response")
			c.dispute("evt_1", created, "ch_sub", "needs_response") // replay
			c.dispute("evt_2", updated, "ch_sub", "under_review")
		}, outcome{"basic", true, 1_000_000, 2, 0}},
		{"a won dispute clears the alert", func(c chargeback) {
			c.dispute("evt_1", created, "ch_sub", "needs_response")
			c.dispute("evt_2", closed, "ch_sub", "won")
		}, outcome{"basic", false, 1_000_000, 2, 0}},
		{"a won dispute delivered before its opening stays closed", func(c chargeback) {
			c.dispute("evt_2", closed, "ch_sub", "won")
			c.dispute("evt_1", created, "ch_sub", "won")
		}, outcome{"basic", false, 1_000_000, 0, 0}},
		{"a lost dispute on the subscription ends it now, once", func(c chargeback) {
			c.dispute("evt_1", created, "ch_sub", "needs_response")
			c.dispute("evt_2", closed, "ch_sub", "lost")
			c.dispute("evt_2", closed, "ch_sub", "lost")  // replay
			c.dispute("evt_1", created, "ch_sub", "lost") // a late redelivery of the opening
			c.e.event("evt_3", "customer.subscription.deleted", map[string]any{"id": "sub_" + c.ws})
		}, outcome{"", false, 0, 2, 1}},
		{"a lost dispute delivered before its opening still ends the subscription", func(c chargeback) {
			c.dispute("evt_2", closed, "ch_sub", "lost")
			c.dispute("evt_1", created, "ch_sub", "lost")
		}, outcome{"", false, 0, 0, 1}},
		{"a lost dispute on a pack takes its tokens back, once", func(c chargeback) {
			c.credit()
			c.dispute("evt_1", created, "ch_pack", "needs_response")
			c.dispute("evt_2", closed, "ch_pack", "lost")
			c.dispute("evt_2", closed, "ch_pack", "lost")
			c.refund("evt_3", "ch_pack", 4000) // refunded as well: still taken back once
		}, outcome{"basic", false, 1_000_000, 2, 0}},
		{"a lost pack dispute takes no more than is left this month", func(c chargeback) {
			c.credit()
			c.use(5_500_000) // of 6M: 500k left
			c.dispute("evt_2", closed, "ch_pack", "lost")
		}, outcome{"basic", false, 5_500_000, 0, 0}},
		{"nothing to take back when the month's tokens are spent", func(c chargeback) {
			c.credit()
			c.use(7_000_000)
			c.dispute("evt_2", closed, "ch_pack", "lost")
		}, outcome{"basic", false, 6_000_000, 0, 0}},
		{"a fully refunded pack loses its tokens, once", func(c chargeback) {
			c.credit()
			c.refund("evt_1", "ch_pack", 4000)
			c.refund("evt_1", "ch_pack", 4000) // replay
			c.refund("evt_2", "ch_pack", 4000) // another delivery of the same state
		}, outcome{"basic", false, 1_000_000, 0, 0}},
		{"a refund delivered before the pack's credit leaves no tokens", func(c chargeback) {
			c.refund("evt_1", "ch_pack", 4000)
			c.credit()
		}, outcome{"basic", false, 1_000_000, 0, 0}},
		{"a partly refunded pack keeps its tokens", func(c chargeback) {
			c.credit()
			c.refund("evt_1", "ch_pack", 1000)
		}, outcome{"basic", false, 6_000_000, 0, 0}},
		{"a refunded subscription payment is the operator's call: nothing ends", func(c chargeback) {
			c.refund("evt_1", "ch_sub", 1900)
		}, outcome{"basic", false, 1_000_000, 0, 0}},
		{"a lost dispute delivered before the subscription is recorded still ends it", func(c chargeback) {
			c.e.exec(`DELETE FROM workspace_billing WHERE workspace_id = $1`, c.ws)
			c.dispute("evt_1", created, "ch_sub", "needs_response")
			c.dispute("evt_2", closed, "ch_sub", "lost")
			c.e.event("evt_3", "customer.subscription.created", map[string]any{"id": "sub_" + c.ws})
		}, outcome{"", false, 0, 2, 1}},
		{"a charge for an unknown workspace changes nothing", func(c chargeback) {
			c.e.stripe.put("sub_gone", "wsp_gone", "cus_"+c.ws, "active", "price_bm")
			c.e.stripe.mu.Lock()
			c.e.stripe.charges["ch_sub"]["invoice"] = map[string]any{"id": "in_3", "subscription": "sub_gone"}
			c.e.stripe.mu.Unlock()
			c.dispute("evt_1", created, "ch_sub", "needs_response")
			c.dispute("evt_2", closed, "ch_sub", "lost")
		}, outcome{"basic", false, 1_000_000, 0, 0}},
		{"another customer's charge changes nothing", func(c chargeback) {
			c.dispute("evt_1", created, "ch_other", "needs_response")
			c.dispute("evt_2", closed, "ch_other", "lost")
		}, outcome{"basic", false, 1_000_000, 0, 0}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newChargeback(t)
			tc.steps(c)
			if got := c.outcome(); got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestDisputedInOverview(t *testing.T) {
	c := newChargeback(t)
	owner := c.e.join(c.ws, "owner")
	disputed := func() any {
		_, body := c.e.do(owner, http.MethodGet, "/api/v1/billing", nil)
		return body["data"].(map[string]any)["disputed"]
	}
	if got := disputed(); got != false {
		t.Fatalf("before: %v", got)
	}
	c.dispute("evt_1", "charge.dispute.created", "ch_sub", "warning_needs_response")
	if got := disputed(); got != true {
		t.Fatalf("open: %v", got)
	}
}
