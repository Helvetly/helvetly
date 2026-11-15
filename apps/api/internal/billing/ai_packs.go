package billing

import (
	"context"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// The AI token packs (Helvetly/billing's catalogue): one-time prices of the product AITokensProduct, each with the
// token count in its metadata. A paid pack adds its tokens to the workspace's allowance for the month it was paid
// in (ai_token_packs), after the plan's own; what is left lapses with the month.
const (
	AITokensProduct = "helvetly_ai_tokens"
	AITokensKey     = "helvetly_ai_tokens" // price metadata: the pack's tokens
)

type aiPack struct {
	Tokens   int64  `json:"tokens"`
	Amount   int64  `json:"amount"` // minor units, VAT included
	Currency string `json:"currency"`
	price    string
}

var errNoPack = auth.Error(http.StatusUnprocessableEntity, "ai_pack_unavailable", "This AI token pack is not on sale.",
	map[string]any{"fields": map[string]string{"tokens": "invalid"}})

// aiPacks reads the packs on sale from Stripe, smallest first, cached for ten minutes; a failure leaves none.
func (s *Service) aiPacks(ctx context.Context) []aiPack {
	if !s.enabled {
		return []aiPack{}
	}
	s.packsMu.Lock()
	defer s.packsMu.Unlock()
	if s.packs != nil && s.now().Sub(s.packedAt) < 10*time.Minute {
		return s.packs
	}
	var found list[price]
	form := url.Values{"product": {AITokensProduct}, "active": {"true"}, "type": {"one_time"}, "limit": {"20"}}
	if err := s.stripe.Call(ctx, http.MethodGet, "/v1/prices", form, "", &found); err != nil {
		s.log.WarnContext(ctx, "reading the AI token packs failed", "error", err)
		return []aiPack{} // not cached: the next read tries again
	}
	out := []aiPack{}
	for _, p := range found.Data {
		if n, err := strconv.ParseInt(p.Metadata[AITokensKey], 10, 64); err == nil && n > 0 && p.UnitAmount > 0 {
			out = append(out, aiPack{n, p.UnitAmount, p.Currency, p.ID})
		}
	}
	slices.SortFunc(out, func(a, b aiPack) int { return int(a.Tokens - b.Tokens) })
	s.packs, s.packedAt = out, s.now()
	return out
}

// buyAITokens opens a Checkout Session (payment mode) for one pack. Only a workspace on a plan can buy: the tokens
// add to the plan's allowance. The webhook records the pack once Stripe says it is paid.
func (s *Service) buyAITokens(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var in struct {
		Tokens int64 `json:"tokens"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	packs := s.aiPacks(ctx)
	i := slices.IndexFunc(packs, func(p aiPack) bool { return p.Tokens == in.Tokens })
	if i < 0 {
		return errNoPack
	}
	pack := packs[i]
	b, err := s.db.WorkspaceBilling(ctx, ws)
	if err != nil {
		return err
	}
	if PlanOf(b) == "" {
		return errPlanRequired
	}
	if b.CustomerID == "" {
		return errNoCustomer
	}
	tokens := strconv.FormatInt(pack.Tokens, 10)
	back := s.publicURL + "/settings/billing?checkout="
	form := url.Values{
		"mode": {"payment"}, "customer": {b.CustomerID}, "client_reference_id": {ws},
		"line_items[0][price]": {pack.price}, "line_items[0][quantity]": {"1"},
		"metadata[workspace_id]": {ws}, "metadata[" + AITokensKey + "]": {tokens},
		"payment_intent_data[metadata][workspace_id]": {ws}, "invoice_creation[enabled]": {"true"},
		"billing_address_collection": {"required"}, "tax_id_collection[enabled]": {"true"},
		"customer_update[name]": {"auto"}, "customer_update[address]": {"auto"},
		"success_url": {back + "ai_tokens"}, "cancel_url": {back + "canceled"},
	}
	if s.cfg.AutomaticTax {
		form.Set("automatic_tax[enabled]", "true")
	}
	if s.cfg.ManagedPayments {
		managedPayments(form)
	}
	var cs struct {
		URL string `json:"url"`
	}
	if err := s.stripe.Call(ctx, http.MethodPost, "/v1/checkout/sessions", form, "", &cs); err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"url": cs.URL})
	return nil
}

// creditAITokens records a paid pack Checkout Session on its workspace, once, for the workspace's current month. A
// session for another customer than the workspace's, or not paid yet, adds nothing.
func (s *Service) creditAITokens(ctx context.Context, sessionID, customer, workspaceID, tokens, paymentStatus string) error {
	n, err := strconv.ParseInt(tokens, 10, 64)
	if err != nil || n <= 0 || workspaceID == "" || paymentStatus != "paid" {
		return nil
	}
	return s.db.Tx(ctx, func(q store.Q) error {
		b, err := q.WorkspaceBilling(ctx, workspaceID)
		if err != nil || b.CustomerID == "" || b.CustomerID != customer {
			return err
		}
		w, err := q.AdmissionWorkspace(ctx, workspaceID)
		if err != nil {
			return err
		}
		now := s.now()
		added, err := q.AddAITokenPack(ctx, sessionID, workspaceID, now.In(w.Location()).Format("2006-01"), n, now)
		if added {
			s.log.InfoContext(ctx, "AI token pack credited", "workspace", workspaceID, "tokens", n)
		}
		return err
	})
}
