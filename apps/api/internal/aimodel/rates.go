package aimodel

import (
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strings"
)

// DefaultModel is the model the offer is sold on, for Heidi and AI import.
const DefaultModel = "gpt-6-luna"

// RateCard prices one model at one service tier. Rates are micro-USD per million tokens with the regional uplift
// already applied, so a call's cost is exact integer arithmetic, rounded up.
type RateCard struct {
	Version string // when the provider's price list was verified
	Model   string
	Tier    string // the provider's service_tier for this price: "default" is OpenAI's Standard
	Region  string
	// Input is uncached input, Cached cached input, Output output including reasoning.
	Input, Cached, Output int64
}

// regional is OpenAI's +10% for regional processing: base rate × 1.1, in micro-USD per million tokens.
func regional(usdPerMillion float64) int64 { return int64(usdPerMillion*1.1*1e6 + 0.5) }

// Cards are the models a deployment may choose (OPENAI_MODEL, OPENAI_FALLBACK_MODEL), at Standard tier, from OpenAI's
// price list verified 2026-11-15 (gpt-5.6-luna, the previous Luna kept as a fallback, 2026-11-19). Sol, Astra and
// Luna 5.6 are priced only so an operator's explicit choice is costed; the sold token pools are funded for gpt-6-luna,
// and Budget refuses calls whose card cannot fund the pool (ErrUnfunded).
var Cards = map[string]RateCard{
	"gpt-6-luna":   {Version: "openai-2026-11-15", Model: "gpt-6-luna", Tier: "default", Region: "regional", Input: regional(0.10), Cached: regional(0.01), Output: regional(0.50)},
	"gpt-6.1-sol":  {Version: "openai-2026-11-15", Model: "gpt-6.1-sol", Tier: "default", Region: "regional", Input: regional(2), Cached: regional(0.10), Output: regional(10)},
	"gpt-5.6-luna": {Version: "openai-2026-11-19", Model: "gpt-5.6-luna", Tier: "default", Region: "regional", Input: regional(0.20), Cached: regional(0.02), Output: regional(1.20)},
	"gpt-6-astra":  {Version: "openai-2026-11-15", Model: "gpt-6-astra", Tier: "default", Region: "regional", Input: regional(10), Cached: regional(1), Output: regional(50)},
}

// Cost is the micro-USD price of uncached input, cached input and output tokens, rounded up.
func (c RateCard) Cost(input, cached, output int64) int64 {
	sum := new(big.Int)
	for _, t := range [][2]int64{{input, c.Input}, {cached, c.Cached}, {output, c.Output}} {
		sum.Add(sum, new(big.Int).Mul(big.NewInt(t[0]), big.NewInt(t[1])))
	}
	million := big.NewInt(1_000_000)
	sum.Add(sum, new(big.Int).Sub(million, big.NewInt(1)))
	return sum.Quo(sum, million).Int64()
}

// outputFor is the most output tokens micros pay for.
func (c RateCard) outputFor(micros int64) int64 {
	if micros <= 0 {
		return 0
	}
	n := new(big.Int).Quo(new(big.Int).Mul(big.NewInt(micros), big.NewInt(1_000_000)), big.NewInt(c.Output))
	if !n.IsInt64() {
		return math.MaxInt64
	}
	return n.Int64()
}

// WorstCost is what tokens cost at the most expensive mix the card allows: every token billed at its highest rate.
func (c RateCard) WorstCost(tokens int64) int64 {
	return RateCard{Input: max(c.Input, c.Cached, c.Output)}.Cost(tokens, 0, 0)
}

// Funds checks the funding invariant: a cost budget pays for the whole token pool sold with it at the worst mix, so
// the cost guard never silently shrinks the pool (a price or tier change must fund the pool or change the offer).
func (c RateCard) Funds(tokens, costMicros int64) error {
	if need := c.WorstCost(tokens); costMicros < need {
		return fmt.Errorf("%w: %d tokens of %s need %d micro-USD, the budget is %d", ErrUnfunded, tokens, c.Model, need, costMicros)
	}
	return nil
}

// snapshot is what may follow the card's model in the reported one: nothing or a dated snapshot, never a variant.
var snapshot = regexp.MustCompile(`^(-[0-9]{4}-[0-9]{2}-[0-9]{2})?$`)

// maxCallTokens bounds a reported count, far above any one call, so costing never overflows.
const maxCallTokens = 1 << 32

// Usage is what a provider reports for one call. Cached input is part of Input and reasoning part of Output, never
// counted twice.
type Usage struct {
	Input, CachedInput, Output, Reasoning int64
	Model, Tier, RequestID                string
}

// price is the call's cost by this card; false when the report is inconsistent or was made by another model or tier
// than the card prices, so the cost is left to reconcile instead of guessed.
func (c RateCard) price(u *Usage, total int64) (int64, bool) {
	if u == nil || u.Input < 0 || u.Output < 0 || u.CachedInput < 0 || u.Reasoning < 0 || u.CachedInput > u.Input ||
		u.Reasoning > u.Output || u.Input > maxCallTokens || u.Output > maxCallTokens || u.Input+u.Output != total {
		return 0, false
	}
	if u.Tier != c.Tier || !strings.HasPrefix(u.Model, c.Model) || !snapshot.MatchString(u.Model[len(c.Model):]) {
		return 0, false
	}
	return c.Cost(u.Input-u.CachedInput, u.CachedInput, u.Output), true
}
