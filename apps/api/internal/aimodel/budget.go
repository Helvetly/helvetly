package aimodel

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

var (
	// ErrUncertain: another call is in flight, or an earlier call's usage is unknown; no further call until it settles
	// or an operator reconciles heidi_usage.uncertain. Never retry a call that ended unknown.
	ErrUncertain = errors.New("model usage is uncertain")
	// ErrUnaccounted: this call's usage was not reported, so the month is now uncertain (see ErrUncertain).
	ErrUnaccounted = errors.New("model usage was not reported")
	// ErrQuota: the workspace has used its monthly allowance.
	ErrQuota = errors.New("monthly model token allowance used")
	// ErrTooLarge: this input and a response exceed what is left of the allowance.
	ErrTooLarge = errors.New("input exceeds the remaining model token allowance")
	// ErrProvider: the provider failed with known usage (recorded); nothing was generated.
	ErrProvider = errors.New("model provider failed")
	// ErrCap: the call is larger than one call, operation or batch may be (Caps, MaxInputTokens), apart from the
	// monthly allowance.
	ErrCap = errors.New("input exceeds what one model call may use")
	// ErrAttempts: this step already made its calls (maxAttempts).
	ErrAttempts = errors.New("model call attempts used")
	// ErrUnfunded: the cost budget cannot pay for the token pool at the model's prices; an operator must fund it or
	// change the offer, never shrink the sold pool silently.
	ErrUnfunded = errors.New("model cost budget does not fund the token allowance")
)

// Allowance is a workspace's monthly allowance of one pool, read in the admission transaction: tokens (its plan's
// ai_tokens_per_month for Heidi, ai_automation_tokens_per_month for automation) or their cost in micro-USD
// (ai_cost_usd_micros, ai_automation_cost_usd_micros). A negative value is unlimited.
type Allowance func(ctx context.Context, q store.Q, workspaceID string) (int64, error)

const (
	// MaxInputTokens bounds one call's input, whatever the allowance left.
	MaxInputTokens = 100_000
	// maxAttempts per step: a known failure may be retried once; an unknown outcome never (ErrUnaccounted).
	maxAttempts = 2
	minOutput   = 16
	// staleAfter: a call still reserved this long ended with its process; its outcome is unknown.
	staleAfter = 10 * time.Minute
)

// Caps bound one call, its operation (all calls for an import file or a Heidi turn, attempts included) and its group
// (an import batch), in micro-USD; zero is no cap. They apply on top of the monthly budget.
type Caps struct{ Call, Operation, Group int64 }

var (
	ImportCaps = Caps{Call: 50_000, Operation: 250_000, Group: 1_000_000}
	HeidiCaps  = Caps{Call: 250_000, Operation: 250_000}
	// FilingCaps: one uploaded document classified for filing, one call (and its one retry).
	FilingCaps = Caps{Call: 50_000, Operation: 100_000}
	// OrganizeCaps: one AI organize run over up to 150 documents, and its one shorter retry.
	OrganizeCaps = Caps{Call: 120_000, Operation: 240_000}
	// WriteCaps: one "Write with AI" text (up to 4000 characters), one call, counted in Heidi's pool.
	WriteCaps = Caps{Call: 50_000, Operation: 50_000}
)

// Pools are the separate monthly allowances: Heidi's chat, and the automation pool AI import and the automatic filing
// of documents share. Each has its own usage, reservations, uncertain month and one call in flight.
const (
	PoolHeidi      = "heidi"
	PoolAutomation = "automation"
)

// Call names a provider call for its caps and attempts: Kind is "heidi", "import", "filing", "organize" or "write", Operation the turn,
// file or document, Step the chunk or stage within it, Group the batch ("" none).
type Call struct {
	Kind, Operation, Step, Group string
	MaxOutput                    int64
	Caps                         Caps
}

// Budget is one pool's monthly token allowance and its cost guard (heidi_usage and ai_calls of Pool). A nil Allowance
// is unlimited (billing off); a nil CostAllowance applies no monthly cost guard, the per-call Caps still apply.
// Heidi uses PoolHeidi with billing's AITokens and AICost; AI import and filing use PoolAutomation with
// AIAutomationTokens and AIAutomationCost.
type Budget struct {
	DB *store.Store
	// Pool is PoolHeidi or PoolAutomation; its Allowance and CostAllowance must be that pool's.
	Pool          string
	Allowance     Allowance
	CostAllowance Allowance
	// Gate, when set, refuses a call in its admission transaction (the workspace's consent): checked before every
	// call, so a withdrawal stops the next one even within a turn or a file. Its error is returned as is.
	Gate func(ctx context.Context, q store.Q, workspaceID string) error
	Now  func() time.Time
	// Calling, when set, runs right before the provider is asked, after admission and the input check passed: a
	// caller shows the step as it starts.
	Calling func()
}

// Generate makes one provider call under the budget. Admission checks consent and what is left; the input is counted;
// tokens (input + capped output) and their worst-case cost are reserved atomically as the workspace's one call in
// flight of its pool; after the call the actual usage is settled and only the unused rest released, even when the caller's
// context ends. An unknown outcome keeps both reservations and blocks the month (ErrUnaccounted); a usage report
// without a cost breakdown settles the tokens and keeps the cost reserved for reconciliation.
//
// A failure that cost nothing (the provider refused before generating: a rate limit, or the input count) is tried
// again up to len(retryDelays) times after growing pauses, each retry its own step and reservation; a failure whose
// usage is unknown never is.
func (b Budget) Generate(ctx context.Context, p Provider, ws store.Workspace, req Request, call Call) (Reply, error) {
	step := call.Step
	for i := 0; ; i++ {
		reply, err := b.generate(ctx, p, ws, req, call)
		if err == nil || i == len(retryDelays) || !retryable(err) {
			return reply, err
		}
		select {
		case <-ctx.Done():
			return reply, err
		case <-time.After(retryDelays[i]):
		}
		call.Step = fmt.Sprintf("%s/retry%d", step, i+1)
	}
}

// retryDelays are the pauses before each retry of a failure that cost nothing.
var retryDelays = []time.Duration{time.Second, 2 * time.Second, 4 * time.Second}

// errCount marks a failed input count: nothing was reserved or generated.
var errCount = errors.New("the provider could not count the input tokens")

func retryable(err error) bool {
	if errors.Is(err, ErrUnaccounted) {
		return false
	}
	switch FailureKind(err) {
	case FailRateLimited:
		return true
	case FailServer, FailTimeout, FailNetwork, FailInvalid:
		return errors.Is(err, errCount)
	}
	return false
}

func (b Budget) generate(ctx context.Context, p Provider, ws store.Workspace, req Request, call Call) (Reply, error) {
	card := p.Card()
	period := store.UsagePeriod(b.Now())
	if err := b.expireStale(ctx, ws.ID); err != nil {
		return Reply{}, err
	}
	if _, err := b.admit(ctx, ws, period, card, call, -1); err != nil {
		return Reply{}, err
	}
	inputTokens, err := p.InputTokens(ctx, req)
	if err != nil || inputTokens < 0 {
		if ctx.Err() == nil {
			logFailure(ctx, store.AICall{WorkspaceID: ws.ID, Kind: call.Kind, Step: call.Step + "/count", Model: card.Model}, 0, err)
		}
		return Reply{}, errors.Join(ErrProvider, errCount, err)
	}
	if inputTokens > MaxInputTokens {
		return Reply{}, ErrCap
	}
	if err := ctx.Err(); err != nil {
		return Reply{}, err
	}
	reserved, err := b.admit(ctx, ws, period, card, call, inputTokens)
	if err != nil {
		return Reply{}, err
	}
	req.MaxOutputTokens = reserved.ReservedTokens - inputTokens
	if b.Calling != nil {
		b.Calling()
	}
	// A started generation is billed whether or not the caller stays: cancelling it would lose its usage and block
	// the workspace's model calls until an operator reconciles. The provider's own timeout bounds it.
	started := time.Now()
	reply, providerErr := p.Answer(context.WithoutCancel(ctx), req)
	known := reply.Tokens != nil && *reply.Tokens >= 0 && *reply.Tokens <= maxCallTokens
	if providerErr != nil {
		logFailure(ctx, reserved, time.Since(started), providerErr)
		reserved.Failure = "error"
		if pe, ok := errors.AsType[*ProviderError](providerErr); ok {
			reserved.Failure = pe.failure()
		}
	}
	if err := b.settle(ctx, card, reserved, reply, known); err != nil {
		return Reply{}, fmt.Errorf("record model usage: %w", err)
	}
	switch {
	case providerErr != nil && !known:
		return Reply{}, errors.Join(ErrProvider, ErrUnaccounted, providerErr)
	case providerErr != nil:
		// The reply's text stays for a caller that can use a cut-short answer (FailIncomplete).
		return reply, errors.Join(ErrProvider, providerErr)
	case !known:
		return Reply{}, ErrUnaccounted
	}
	return reply, nil
}

// logFailure records a failed provider call once, with what explains it and never the prompt, answer or key.
func logFailure(ctx context.Context, c store.AICall, took time.Duration, err error) {
	attrs := []any{"call", c.ID, "workspace", c.WorkspaceID, "kind", c.Kind, "step", c.Step, "model", c.Model,
		"duration_ms", took.Milliseconds()}
	if pe, ok := errors.AsType[*ProviderError](err); ok {
		attrs = append(attrs, "reason", pe.Kind, "http_status", pe.HTTPStatus, "error_type", pe.Type, "error_code", pe.Code,
			"error_message", pe.Message, "response_status", pe.Status, "incomplete_reason", pe.Reason,
			"request_id", pe.RequestID, "response_id", pe.ResponseID)
		if pe.Err != nil {
			attrs = append(attrs, "error", pe.Err.Error())
		}
	} else if err != nil {
		attrs = append(attrs, "error", err.Error())
	}
	slog.WarnContext(ctx, "model call failed", attrs...)
}

// admit checks, in one transaction, everything a call needs. With input < 0 it only checks (before the input is sent
// to be counted); otherwise it reserves input + the output that fits and its worst-case cost.
func (b Budget) admit(ctx context.Context, ws store.Workspace, period string, card RateCard, call Call, input int64) (store.AICall, error) {
	var row store.AICall
	err := b.DB.Tx(ctx, func(q store.Q) error {
		u, err := q.LockHeidiUsage(ctx, ws.ID, b.Pool, period, b.Now())
		if err != nil {
			return err
		}
		if u.Uncertain {
			return ErrUncertain
		}
		if _, busy, err := q.AICallInFlight(ctx, ws.ID, b.Pool); err != nil || busy {
			return errors.Join(err, ErrUncertain)
		}
		if b.Gate != nil {
			if err := b.Gate(ctx, q, ws.ID); err != nil {
				return err
			}
		}
		tokens, err := allowance(ctx, q, ws.ID, b.Allowance)
		if err != nil {
			return err
		}
		cost, err := allowance(ctx, q, ws.ID, b.CostAllowance)
		if err != nil {
			return err
		}
		if tokens != math.MaxInt64 && cost != math.MaxInt64 {
			if err := card.Funds(tokens, cost); err != nil {
				return err
			}
		}
		tokensLeft := tokens - u.TokensUsed - u.TokensReserved
		costLeft := cost - u.CostMicros - u.CostReserved
		if tokensLeft < minOutput || costLeft < card.Cost(0, 0, minOutput) {
			return ErrQuota
		}
		opSpent, groupSpent, calls, err := q.AICallSpend(ctx, ws.ID, call.Operation, call.Step, call.Group)
		if err != nil {
			return err
		}
		if calls >= maxAttempts {
			return ErrAttempts
		}
		capLeft := int64(math.MaxInt64)
		for _, c := range [][2]int64{{call.Caps.Call, 0}, {call.Caps.Operation, opSpent}, {call.Caps.Group, groupSpent}} {
			if c[0] > 0 {
				capLeft = min(capLeft, c[0]-c[1])
			}
		}
		minCost := card.Cost(max(input, 0), 0, minOutput)
		if capLeft < minCost && input < 0 {
			return ErrCap
		}
		if input < 0 {
			return nil
		}
		if input > tokensLeft-minOutput || minCost > costLeft {
			return ErrTooLarge
		}
		if minCost > capLeft {
			return ErrCap
		}
		inputCost := card.Cost(input, 0, 0)
		output := min(call.MaxOutput, tokensLeft-input, card.outputFor(costLeft-inputCost), card.outputFor(capLeft-inputCost))
		row = store.AICall{ID: "aic_" + strings.ToLower(rand.Text()), WorkspaceID: ws.ID, Period: period, Pool: b.Pool, Kind: call.Kind,
			Operation: call.Operation, Step: call.Step, Group: call.Group, RateCard: card.Version, Model: card.Model,
			Tier: card.Tier, Region: card.Region, ReservedTokens: input + output, ReservedMicros: card.Cost(input, 0, output),
			CreatedAt: b.Now()}
		if ok, err := q.InsertAICall(ctx, row); err != nil || !ok {
			return errors.Join(err, ErrUncertain)
		}
		u.TokensReserved += row.ReservedTokens
		u.CostReserved += row.ReservedMicros
		return q.SaveHeidiUsage(ctx, ws.ID, b.Pool, period, u, b.Now())
	})
	return row, err
}

func allowance(ctx context.Context, q store.Q, workspaceID string, a Allowance) (int64, error) {
	if a == nil {
		return math.MaxInt64, nil
	}
	n, err := a(ctx, q, workspaceID)
	if n < 0 {
		n = math.MaxInt64
	}
	return n, err
}

// settle records the call's outcome against the month it was admitted in, so a call that ends after midnight never
// moves into the new month's budget.
func (b Budget) settle(ctx context.Context, card RateCard, row store.AICall, reply Reply, known bool) error {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return b.DB.Tx(cleanup, func(q store.Q) error {
		u, err := q.LockHeidiUsage(cleanup, row.WorkspaceID, row.Pool, row.Period, b.Now())
		if err != nil {
			return err
		}
		row.Status = "uncertain"
		if known {
			total := *reply.Tokens
			row.Status, row.Total = "cost_pending", &total
			u.TokensUsed += total
			u.TokensReserved -= row.ReservedTokens
			if total > row.ReservedTokens {
				slog.WarnContext(cleanup, "model call used more tokens than it reserved", "call", row.ID, "reserved", row.ReservedTokens, "used", total)
			}
			if r := reply.Usage; r != nil {
				row.Input, row.CachedInput, row.Output, row.Reasoning = &r.Input, &r.CachedInput, &r.Output, &r.Reasoning
				row.ReportedModel, row.ReportedTier, row.RequestID = r.Model, r.Tier, r.RequestID
			}
			if cost, ok := card.price(reply.Usage, total); ok {
				row.Status, row.CostMicros = "settled", &cost
				u.CostMicros += cost
				u.CostReserved -= row.ReservedMicros
				if cost > row.ReservedMicros {
					slog.WarnContext(cleanup, "model call cost more than it reserved", "call", row.ID, "reserved", row.ReservedMicros, "cost", cost)
				}
			} else {
				slog.WarnContext(cleanup, "model call cost needs reconciliation", "call", row.ID, "workspace", row.WorkspaceID)
			}
		} else {
			u.Uncertain = true
		}
		if err := q.SettleAICall(cleanup, row, b.Now()); err != nil {
			return err
		}
		return q.SaveHeidiUsage(cleanup, row.WorkspaceID, row.Pool, row.Period, u, b.Now())
	})
}

// expireStale turns a call left reserved by a process that died into an unknown outcome: its reservation stays and
// its month is blocked until an operator reconciles, never released as if nothing had been spent.
func (b Budget) expireStale(ctx context.Context, workspaceID string) error {
	c, ok, err := b.DB.AICallInFlight(ctx, workspaceID, b.Pool)
	if err != nil || !ok || b.Now().Sub(c.CreatedAt) < staleAfter {
		return err
	}
	return b.DB.Tx(ctx, func(q store.Q) error {
		u, err := q.LockHeidiUsage(ctx, workspaceID, b.Pool, c.Period, b.Now())
		if err != nil {
			return err
		}
		c.Status, c.Failure = "uncertain", "stale"
		if err := q.SettleAICall(ctx, c, b.Now()); errors.Is(err, store.ErrNotFound) {
			return nil // settled meanwhile
		} else if err != nil {
			return err
		}
		u.Uncertain = true
		return q.SaveHeidiUsage(ctx, workspaceID, b.Pool, c.Period, u, b.Now())
	})
}
