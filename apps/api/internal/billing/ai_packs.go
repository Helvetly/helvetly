package billing

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// The AI token packs (Helvetly/billing's earlier catalogue): one-time prices of the product AITokensProduct, each with
// the token count in its metadata. They are no longer sold (the offer has no top-ups); a pack paid in a Checkout opened
// before still adds its tokens to the workspace's allowance for the month it was paid in (ai_token_packs), after the
// plan's own; what is left lapses with the month.
const (
	AITokensProduct = "helvetly_ai_tokens"
	AITokensKey     = "helvetly_ai_tokens" // price metadata: the pack's tokens
)

// errPacksRetired: the offer sells no top-ups; the monthly AI tokens grow with the plan and its paid seats.
var errPacksRetired = auth.Error(http.StatusGone, "ai_pack_unavailable",
	"AI token packs are no longer sold. Your plan's AI tokens grow with every person in the workspace; upgrade or add people for more.",
	nil)

// buyAITokens refuses: packs are no longer sold. Packs paid before keep their tokens (creditAITokens, AITokens).
func (s *Service) buyAITokens(http.ResponseWriter, *http.Request, store.Session) error {
	return errPacksRetired
}

// creditAITokens records a paid pack Checkout Session on its workspace, once, for the workspace's current month, and
// the event with it. A session for another customer than the workspace's, or not paid yet, adds nothing.
func (s *Service) creditAITokens(ctx context.Context, ev event, sessionID, customer, workspaceID, tokens, paymentStatus string) error {
	n, err := strconv.ParseInt(tokens, 10, 64)
	if err != nil || n <= 0 || workspaceID == "" || paymentStatus != "paid" {
		return nil
	}
	err = s.db.Tx(ctx, func(q store.Q) error {
		if err := s.record(ctx, q, ev); err != nil {
			return err
		}
		b, err := q.WorkspaceBilling(ctx, workspaceID)
		if err != nil || b.CustomerID == "" || b.CustomerID != customer {
			return err
		}
		now := s.now()
		added, err := q.AddAITokenPack(ctx, sessionID, workspaceID, store.UsagePeriod(now), n, now)
		if added {
			s.log.InfoContext(ctx, "AI token pack credited", "workspace", workspaceID, "tokens", n)
		}
		return err
	})
	if errors.Is(err, errSeen) {
		return nil
	}
	return err
}
