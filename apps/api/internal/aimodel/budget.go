package aimodel

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"helvetly.com/api/internal/store"
)

var (
	// ErrUncertain: an earlier call's usage is unknown (or this one's became unknown); no further call until an
	// operator reconciles heidi_usage.uncertain. Never retry a call that ended this way.
	ErrUncertain = errors.New("model usage is uncertain")
	// ErrUnaccounted: this call's usage was not reported, so the month is now uncertain (see ErrUncertain).
	ErrUnaccounted = errors.New("model usage was not reported")
	// ErrQuota: the workspace has used its monthly allowance.
	ErrQuota = errors.New("monthly model token allowance used")
	// ErrTooLarge: this input and a response exceed what is left of the allowance.
	ErrTooLarge = errors.New("input exceeds the remaining model token allowance")
	// ErrProvider: the provider failed with known usage (recorded); nothing was generated.
	ErrProvider = errors.New("model provider failed")
)

// Allowance is a workspace's monthly token allowance (its plan's ai_tokens_per_month), read in the admission
// transaction; a negative value is unlimited.
type Allowance func(ctx context.Context, q store.Q, workspaceID string) (int64, error)

// Budget is the workspace's monthly token allowance, shared by every model call (heidi_usage rows). A nil Allowance
// is unlimited (billing off).
type Budget struct {
	DB        *store.Store
	Allowance Allowance
	// Gate, when set, refuses a call in its admission transaction (the workspace's consent): checked before every
	// call, so a withdrawal stops the next one even within a turn or a file. Its error is returned as is.
	Gate func(ctx context.Context, q store.Q, workspaceID string) error
	Now  func() time.Time
	// Calling, when set, runs right before the provider is asked, after admission and the input check passed: a
	// caller shows the step as it starts.
	Calling func()
}

// Generate makes one provider call under the budget: admission marks the month uncertain, the input is counted, the
// output capped to what is left (and to maxOutput), and actual usage recorded afterwards even when the caller's
// context ends. A call whose usage the provider does not report leaves the month uncertain (ErrUnaccounted).
func (b Budget) Generate(ctx context.Context, p Provider, ws store.Workspace, req Request, maxOutput int64) (Reply, error) {
	period := b.Now().In(ws.Location()).Format("2006-01")
	var remaining int64
	err := b.DB.Tx(ctx, func(q store.Q) error {
		u, err := q.LockHeidiUsage(ctx, ws.ID, period, b.Now())
		if err != nil {
			return err
		}
		if u.Uncertain {
			return ErrUncertain
		}
		if b.Gate != nil {
			if err := b.Gate(ctx, q, ws.ID); err != nil {
				return err
			}
		}
		monthly := int64(math.MaxInt64)
		if b.Allowance != nil {
			if monthly, err = b.Allowance(ctx, q, ws.ID); err != nil {
				return err
			}
			if monthly < 0 {
				monthly = math.MaxInt64
			}
		}
		remaining = monthly - u.TokensUsed
		if remaining < 16 {
			return ErrQuota
		}
		u.Uncertain = true
		return q.SaveHeidiUsage(ctx, ws.ID, period, u, b.Now())
	})
	if err != nil {
		return Reply{}, err
	}
	req.MaxOutputTokens = min(maxOutput, remaining)
	inputTokens, countErr := p.InputTokens(ctx, req)
	zero := int64(0)
	reply := Reply{Tokens: &zero}
	var providerErr error
	tooLarge := false
	if countErr != nil || inputTokens < 0 {
		providerErr = errors.New("the provider could not count the input tokens")
	} else if inputTokens > remaining-16 {
		tooLarge = true
	} else if providerErr = ctx.Err(); providerErr == nil {
		req.MaxOutputTokens = min(maxOutput, remaining-inputTokens)
		if b.Calling != nil {
			b.Calling()
		}
		// A started generation is billed whether or not the caller stays: cancelling it would lose its usage and
		// block the workspace's model calls until an operator reconciles. The provider's own timeout bounds it.
		reply, providerErr = p.Answer(context.WithoutCancel(ctx), req)
	}
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	err = b.DB.Tx(cleanup, func(q store.Q) error {
		u, err := q.LockHeidiUsage(cleanup, ws.ID, period, b.Now())
		if err != nil {
			return err
		}
		if reply.Tokens != nil && *reply.Tokens >= 0 && *reply.Tokens <= math.MaxInt64-u.TokensUsed {
			u.TokensUsed += *reply.Tokens
			u.Uncertain = false
		}
		return q.SaveHeidiUsage(cleanup, ws.ID, period, u, b.Now())
	})
	if err != nil {
		return Reply{}, fmt.Errorf("record model usage: %w", err)
	}
	unknown := reply.Tokens == nil || *reply.Tokens < 0
	switch {
	case tooLarge:
		return Reply{}, ErrTooLarge
	case providerErr != nil && unknown:
		return Reply{}, errors.Join(ErrProvider, ErrUnaccounted, providerErr)
	case providerErr != nil:
		return Reply{}, errors.Join(ErrProvider, providerErr)
	case unknown:
		return Reply{}, ErrUnaccounted
	}
	return reply, nil
}
