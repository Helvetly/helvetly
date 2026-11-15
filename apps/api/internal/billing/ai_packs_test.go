package billing

import (
	"context"
	"net/http"
	"testing"
)

func TestAITokenPacks(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, true)
	owner := e.workspace()
	allowance := func() int64 {
		t.Helper()
		n, err := e.svc.AITokens(ctx, e.st.Q, owner.workspace)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Packs are no longer sold (offer v2 has no top-ups), with a plan or without.
	for _, subscribed := range []bool{false, true} {
		if subscribed {
			e.subscribe(owner.workspace, "price_bm")
			e.override(owner.workspace, AITokens, StateLimited, n64(1_000_000), nil) // the plan allowance packs add to
		}
		code, body := e.do(owner, http.MethodPost, "/api/v1/billing/ai-tokens", map[string]any{"tokens": 5_000_000})
		if errBody, _ := body["error"].(map[string]any); code != http.StatusGone || errBody["code"] != "ai_pack_unavailable" {
			t.Fatalf("buy (subscribed %v): %d %v", subscribed, code, body)
		}
	}
	if n := e.stripe.called("POST /v1/checkout/sessions"); n != 0 {
		t.Fatalf("pack Checkouts opened: %d", n)
	}

	// A pack paid in a Checkout opened before is honoured.
	session := func(id, customer, status string) map[string]any {
		return map[string]any{"id": id, "mode": "payment", "customer": customer, "payment_status": status,
			"metadata": map[string]string{"workspace_id": owner.workspace, AITokensKey: "5000000"}}
	}
	// Unpaid (an async method still pending) and another customer's session add nothing.
	for i, s := range []map[string]any{session("cs_1", "cus_"+owner.workspace, "unpaid"), session("cs_2", "cus_other", "paid")} {
		if code := e.event("evt_ai_"+string(rune('a'+i)), "checkout.session.completed", s); code != http.StatusOK || allowance() != 1_000_000 {
			t.Fatalf("session %d: %d, allowance %d", i, code, allowance())
		}
	}
	// Paid: the tokens add to the plan's allowance, once, even when Stripe delivers again or the async success follows.
	e.event("evt_ai_paid", "checkout.session.completed", session("cs_3", "cus_"+owner.workspace, "paid"))
	e.event("evt_ai_again", "checkout.session.async_payment_succeeded", session("cs_3", "cus_"+owner.workspace, "paid"))
	if n := allowance(); n != 6_000_000 {
		t.Fatalf("after a paid pack: %d", n)
	}
	_, body := e.do(owner, http.MethodGet, "/api/v1/billing", nil)
	data := body["data"].(map[string]any)
	if data["ai_tokens_bought"] != float64(5_000_000) || len(data["ai_packs"].([]any)) != 0 {
		t.Fatalf("overview %v %v", data["ai_tokens_bought"], data["ai_packs"])
	}
	for _, u := range data["usage"].([]any) {
		if u := u.(map[string]any); u["limit"] == string(AITokens) && u["max"] != float64(6_000_000) {
			t.Fatalf("AI usage max %v", u["max"])
		}
	}

	// Last month's packs have lapsed.
	e.exec(`UPDATE ai_token_packs SET period = '2001-01' WHERE workspace_id = $1`, owner.workspace)
	if n := allowance(); n != 1_000_000 {
		t.Fatalf("a lapsed pack still counts: %d", n)
	}
}

func TestManagedPaymentsDropsInvoiceCreation(t *testing.T) {
	form := map[string][]string{"invoice_creation[enabled]": {"true"}}
	managedPayments(form)
	if _, ok := form["invoice_creation[enabled]"]; ok {
		t.Fatal("invoice_creation is refused under Managed Payments")
	}
}
