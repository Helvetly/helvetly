package aimodel

import (
	"cmp"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math"
	mrand "math/rand/v2"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

var (
	// ErrUncertain: another call of the workspace's pool is in flight; try again once it settles.
	ErrUncertain = errors.New("model usage is uncertain")
	// ErrUnaccounted (always with ErrProvider): this call's usage was not reported (a timeout, a dropped answer, no
	// usage block), so it was charged its whole reservation and nothing was generated. The step may be asked again
	// (maxAttempts): each attempt costs at most its own reservation.
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
	// ErrGroupCap (always with ErrCap): the group (an import batch) has spent its Caps.Group; another call of it is
	// refused however small, a new group is not.
	ErrGroupCap = errors.New("the batch has spent what one batch may use")
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
	// maxAttempts per step: a failed call may be asked once more, by the caller.
	maxAttempts = 2
	minOutput   = 16
	// staleAfter: a call still reserved this long ended with its process; its outcome is unknown. Longer than any
	// Generate's deadline (MaxAnswerTimeout) and its settlement (settleTimeout), so a live call is never taken for one.
	staleAfter = 5 * time.Minute
	// settleTimeout bounds recording a call's outcome after the provider answered.
	settleTimeout = 5 * time.Second
	// answerTimeout bounds a Generate a person waits on in an HTTP request, under a proxy's 100 s limit.
	answerTimeout = 90 * time.Second
	// MaxAnswerTimeout bounds a background Generate (an import file part, filing), which reads a whole PDF. A job's
	// lease on its work must be longer.
	MaxAnswerTimeout = 3 * time.Minute
	// countTimeout bounds one input count; it is quick, and a slow one must leave the answer its time.
	countTimeout = 30 * time.Second
)

// Caps bound one call, its operation (all calls for an import file or a Heidi turn, attempts included) and its group
// (an import batch), in micro-USD; zero is no cap. They apply on top of the monthly budget.
type Caps struct{ Call, Operation, Group int64 }

var (
	// ImportCaps: a batch reads up to 250 files; its group cap pays one full Luna call (about USD 0.02) for each.
	ImportCaps = Caps{Call: 50_000, Operation: 250_000, Group: 5_000_000}
	HeidiCaps  = Caps{Call: 250_000, Operation: 250_000}
	// FilingCaps: one uploaded document classified for filing, one call (and its one retry).
	FilingCaps = Caps{Call: 50_000, Operation: 100_000}
	// OrganizeCaps: one AI organize run over up to 150 documents, and its one shorter retry.
	OrganizeCaps = Caps{Call: 120_000, Operation: 240_000}
	// WriteCaps: one "Write with AI" text (up to 4000 characters), one call, counted in Heidi's pool.
	WriteCaps = Caps{Call: 50_000, Operation: 50_000}
)

// Pools are the separate monthly allowances: Heidi's chat, and the automation pool AI import and the automatic filing
// of documents share. Each has its own usage, reservations and one call in flight.
const (
	PoolHeidi      = "heidi"
	PoolAutomation = "automation"
)

// Call names a provider call for its caps and attempts: Kind is "heidi", "import", "filing", "organize" or "write", Operation the turn,
// file or document, Step the chunk or stage within it, Group the batch ("" none). Timeout bounds the whole Generate:
// counts, retries and the answer (0 = answerTimeout, for a request a person waits on; at most MaxAnswerTimeout).
type Call struct {
	Kind, Operation, Step, Group string
	MaxOutput                    int64
	Caps                         Caps
	Timeout                      time.Duration
	// fallback marks the one call on the fallback model: the pool is funded for the configured model, not for it.
	fallback bool
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
// context ends. An unknown outcome is charged its whole reservation (ErrUnaccounted): the request's max_output_tokens
// is the reserved output, so the provider cannot bill more, and the cost is reserved at uncached input prices. A usage
// report without a cost breakdown settles the tokens and keeps the cost reserved for reconciliation.
//
// A failure that cost nothing (the provider refused before generating: a rate limit, an overload, or the input count)
// is tried again up to len(retryDelays) times, after the provider's Retry-After or growing pauses, each retry its own
// step and reservation; a failure whose usage is unknown never is. Neither is one with less than half of the call's
// time left. A provider still busy then (Busy) and with a fallback model (NewOpenAI) is asked once on that model,
// reserved and priced at its card, while half of the call's time is left.
func (b Budget) Generate(ctx context.Context, p Provider, ws store.Workspace, req Request, call Call) (Reply, error) {
	reply, err := b.generateAll(ctx, p, ws, req, call)
	b.watch(ctx, ws.ID, err)
	return reply, err
}

func (b Budget) generateAll(ctx context.Context, p Provider, ws store.Workspace, req Request, call Call) (Reply, error) {
	timeout := answerTimeout
	if call.Timeout > 0 {
		timeout = min(call.Timeout, MaxAnswerTimeout)
	}
	deadline := time.Now().Add(timeout)
	reply, err := b.retrying(ctx, p, ws, req, call, deadline, timeout)
	f, ok := p.(interface{ Fallback() Provider })
	if !ok || !Busy(err) || ctx.Err() != nil || time.Until(deadline) < timeout/2 {
		return reply, err
	}
	fallback := f.Fallback()
	if fallback == nil {
		return reply, err
	}
	slog.WarnContext(ctx, "model busy, asking the fallback model", "workspace", ws.ID, "kind", call.Kind, "step", call.Step,
		"model", p.Card().Model, "fallback_model", fallback.Card().Model, "reason", FailureKind(err))
	call.Step, call.fallback = call.Step+"/fallback", true
	fallbackReply, fallbackErr := b.generate(ctx, fallback, ws, req, call, deadline)
	if fallbackErr != nil && !errors.Is(fallbackErr, ErrProvider) {
		// Refused before asking (its card does not fit the caps or what is left): the person hears the model is busy.
		slog.WarnContext(ctx, "model fallback refused", "workspace", ws.ID, "kind", call.Kind, "step", call.Step,
			"fallback_model", fallback.Card().Model, "error", fallbackErr.Error())
		return reply, err
	}
	return fallbackReply, fallbackErr
}

// retrying asks p, retrying a failure that cost nothing (retryable) while time is left.
func (b Budget) retrying(ctx context.Context, p Provider, ws store.Workspace, req Request, call Call, deadline time.Time, timeout time.Duration) (Reply, error) {
	step := call.Step
	for i := 0; ; i++ {
		reply, err := b.generate(ctx, p, ws, req, call, deadline)
		if err == nil || i == len(retryDelays) || !retryable(err) {
			return reply, err
		}
		wait := retryWait(err, retryDelays[i])
		if time.Until(deadline) < timeout/2+wait {
			return reply, err
		}
		select {
		case <-ctx.Done():
			return reply, err
		case <-time.After(wait):
		}
		call.Step = fmt.Sprintf("%s/retry%d", step, i+1)
	}
}

// retryDelays are the pauses before each retry of a failure that cost nothing, without a Retry-After.
var retryDelays = []time.Duration{time.Second, 2 * time.Second, 4 * time.Second}

// maxRetryWait caps a provider's Retry-After, so one answer never waits on it for long.
const maxRetryWait = 20 * time.Second

// retryWait is the provider's Retry-After when it sent one, else delay ±50% so retries of many calls spread out.
func retryWait(err error, delay time.Duration) time.Duration {
	if pe, ok := errors.AsType[*ProviderError](err); ok && pe.RetryAfter > 0 {
		return pe.RetryAfter
	}
	if delay <= 0 {
		return 0
	}
	return delay/2 + mrand.N(delay)
}

// errCount marks a failed input count: nothing was reserved or generated.
var errCount = errors.New("the provider could not count the input tokens")

func retryable(err error) bool {
	if errors.Is(err, ErrUnaccounted) {
		return false
	}
	switch FailureKind(err) {
	case FailRateLimited, FailOverloaded:
		return true
	case FailServer, FailTimeout, FailNetwork, FailInvalid:
		return errors.Is(err, errCount)
	}
	return false
}

func (b Budget) generate(ctx context.Context, p Provider, ws store.Workspace, req Request, call Call, deadline time.Time) (Reply, error) {
	card := p.Card()
	period := store.UsagePeriod(b.Now())
	if err := b.expireStale(ctx, ws.ID); err != nil {
		return Reply{}, err
	}
	if _, err := b.admit(ctx, ws, period, card, call, -1); err != nil {
		return Reply{}, err
	}
	countCtx, cancelCount := context.WithTimeout(ctx, min(countTimeout, time.Until(deadline)))
	inputTokens, err := p.InputTokens(countCtx, req)
	cancelCount()
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
	// A started generation is billed whether or not the caller stays: cancelling it would lose its usage and charge
	// the whole reservation. Only the call's own deadline bounds it.
	answerCtx, cancel := context.WithDeadline(context.WithoutCancel(ctx), deadline)
	started := time.Now()
	reply, providerErr := p.Answer(answerCtx, req)
	cancel()
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
		return Reply{}, errors.Join(ErrProvider, ErrUnaccounted)
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
		// Only a busy pool is ErrUncertain (a caller waits on it without spending a try); a database error is not.
		if _, busy, err := q.AICallInFlight(ctx, ws.ID, b.Pool); err != nil {
			return fmt.Errorf("model call in flight: %w", err)
		} else if busy {
			return ErrUncertain
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
		if tokens != math.MaxInt64 && cost != math.MaxInt64 && !call.fallback {
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
		if call.Caps.Group > 0 && call.Caps.Group-groupSpent < card.Cost(0, 0, minOutput) {
			return errors.Join(ErrCap, ErrGroupCap)
		}
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
		if ok, err := q.InsertAICall(ctx, row); err != nil {
			return fmt.Errorf("reserve model call: %w", err)
		} else if !ok {
			return ErrUncertain
		}
		u.TokensReserved += row.ReservedTokens
		u.CostReserved += row.ReservedMicros
		return q.SaveHeidiUsage(ctx, ws.ID, b.Pool, period, u, b.Now())
	})
	return row, err
}

// Left is how many tokens this month's allowance of the pool still holds, and the allowance; math.MaxInt64 for both
// when it is unlimited. It reserves nothing: a caller refuses work up front with it, Generate still admits every call.
func (b Budget) Left(ctx context.Context, q store.Q, workspaceID string) (left, allowed int64, err error) {
	allowed, err = allowance(ctx, q, workspaceID, b.Allowance)
	if err != nil || allowed == math.MaxInt64 {
		return allowed, allowed, err
	}
	u, err := q.HeidiUsage(ctx, workspaceID, b.Pool, store.UsagePeriod(b.Now()))
	if err != nil {
		return 0, 0, err
	}
	return allowed - u.TokensUsed - u.TokensReserved, allowed, nil
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
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), settleTimeout)
	defer cancel()
	return b.DB.Tx(cleanup, func(q store.Q) error {
		u, err := q.LockHeidiUsage(cleanup, row.WorkspaceID, row.Pool, row.Period, b.Now())
		if err != nil {
			return err
		}
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
			cost, ok := card.price(reply.Usage, total)
			if ok {
				row.Status = "settled"
				if cost > row.ReservedMicros {
					slog.WarnContext(cleanup, "model call cost more than it reserved", "call", row.ID, "reserved", row.ReservedMicros, "cost", cost)
				}
			} else {
				// Not priced: charged what its known tokens cost at the card's highest rate, at most its reservation,
				// so the month never holds the reservation forever; cost_pending marks it for reconciliation.
				tokens := total
				if r := reply.Usage; r != nil {
					tokens = max(tokens, r.Input+r.Output) // an inconsistent breakdown: the larger count
				}
				cost = card.WorstCost(tokens)
				if tokens <= row.ReservedTokens { // the reservation bounds what the request allowed
					cost = min(cost, row.ReservedMicros)
				}
				slog.WarnContext(cleanup, "model call cost needs reconciliation, charged at its highest rate", "call", row.ID,
					"workspace", row.WorkspaceID, "cost_micros", cost)
			}
			row.CostMicros = &cost
			u.CostMicros += cost
			u.CostReserved = max(u.CostReserved-row.ReservedMicros, 0)
		} else {
			chargeReservation(cleanup, &row, &u, "unknown_usage:"+cmp.Or(row.Failure, "no_usage"))
		}
		if err := q.SettleAICall(cleanup, row, b.Now()); errors.Is(err, store.ErrNotFound) {
			return nil // a sweep took it for stale and charged its whole reservation, at least what it used
		} else if err != nil {
			return err
		}
		return q.SaveHeidiUsage(cleanup, row.WorkspaceID, row.Pool, row.Period, u, b.Now())
	})
}

// chargeReservation settles a call whose usage is unknown at its whole reservation, the most it could have cost: the
// month may over-count by that one reservation, never under-count, and stays usable.
func chargeReservation(ctx context.Context, row *store.AICall, u *store.HeidiUsage, failure string) {
	tokens, cost := row.ReservedTokens, row.ReservedMicros
	row.Status, row.Total, row.CostMicros, row.Failure = "settled", &tokens, &cost, failure
	u.TokensUsed += tokens
	u.CostMicros += cost
	// Never below zero (the table refuses it): a reservation an operator already released stays charged once.
	u.TokensReserved = max(u.TokensReserved-tokens, 0)
	u.CostReserved = max(u.CostReserved-cost, 0)
	slog.WarnContext(ctx, "model call usage unknown, charged its reservation", "call", row.ID, "workspace", row.WorkspaceID,
		"pool", row.Pool, "period", row.Period, "failure", failure, "tokens", tokens, "cost_micros", cost)
}

// expireStale settles the pool's call left reserved by a process that died at its whole reservation, never released
// as if nothing had been spent.
func (b Budget) expireStale(ctx context.Context, workspaceID string) error {
	c, ok, err := b.DB.AICallInFlight(ctx, workspaceID, b.Pool)
	if err != nil || !ok || b.Now().Sub(c.CreatedAt) < staleAfter {
		return err
	}
	return expire(ctx, b.DB, c, b.Now())
}

func expire(ctx context.Context, db *store.Store, c store.AICall, now time.Time) error {
	return db.Tx(ctx, func(q store.Q) error {
		u, err := q.LockHeidiUsage(ctx, c.WorkspaceID, c.Pool, c.Period, now)
		if err != nil {
			return err
		}
		chargeReservation(ctx, &c, &u, "unknown_usage:stale")
		if err := q.SettleAICall(ctx, c, now); errors.Is(err, store.ErrNotFound) {
			return nil // settled meanwhile
		} else if err != nil {
			return err
		}
		return q.SaveHeidiUsage(ctx, c.WorkspaceID, c.Pool, c.Period, u, now)
	})
}

// ExpireStale settles every workspace's stale call (expireStale), so a pool a dead process left in flight is free
// again within staleAfter and a sweep interval, whether or not anyone asks the model meanwhile.
func ExpireStale(ctx context.Context, db *store.Store, now time.Time) error {
	calls, err := db.StaleAICalls(ctx, now.Add(-staleAfter))
	if err != nil {
		return fmt.Errorf("list stale model calls: %w", err)
	}
	// One call that fails to settle never holds back the others' pools.
	var errs []error
	for _, c := range calls {
		if err := expire(ctx, db, c, now); err != nil {
			slog.ErrorContext(ctx, "settle stale model call", "call", c.ID, "workspace", c.WorkspaceID, "pool", c.Pool, "error", err)
			errs = append(errs, fmt.Errorf("settle stale model call %s: %w", c.ID, err))
		}
	}
	return errors.Join(errs...)
}

// SettleUncertain, run at startup, settles the calls an earlier release left "uncertain" at their whole reservation
// and unblocks their months, logging each; a no-op once done.
func SettleUncertain(ctx context.Context, db *store.Store, now time.Time) error {
	var calls []store.AICall
	err := db.Tx(ctx, func(q store.Q) (err error) {
		calls, err = q.SettleUncertainAICalls(ctx, now)
		return err
	})
	if err != nil {
		return fmt.Errorf("settle uncertain model calls: %w", err)
	}
	for _, c := range calls {
		slog.WarnContext(ctx, "uncertain model call charged its reservation", "call", c.ID, "workspace", c.WorkspaceID,
			"pool", c.Pool, "period", c.Period, "failure", c.Failure, "tokens", c.ReservedTokens, "cost_micros", c.ReservedMicros)
	}
	return nil
}

// RunSweep settles stale calls (ExpireStale) every minute, and calls an instance of an earlier release may still
// leave uncertain during a rolling deploy (SettleUncertain), until ctx ends.
func RunSweep(ctx context.Context, db *store.Store) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		now := time.Now()
		if err := errors.Join(ExpireStale(ctx, db, now), SettleUncertain(ctx, db, now)); err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "sweep model calls", "error", err)
		}
	}
}
