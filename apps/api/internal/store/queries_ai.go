package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// AICall is one model provider call: what it reserved before it was made and, once settled, what it used.
type AICall struct {
	ID, WorkspaceID, Period, Pool          string
	Kind, Operation, Step, Group           string
	Status                                 string
	RateCard, Model, Tier, Region          string
	ReservedTokens, ReservedMicros         int64
	Input, CachedInput                     *int64
	Output, Reasoning, Total               *int64
	CostMicros                             *int64
	ReportedModel, ReportedTier, RequestID string
	// Failure is why the provider call failed (aimodel's Fail… reasons, "stale"), "" when it did not.
	Failure   string
	CreatedAt time.Time
}

// InsertAICall reserves the one call in flight of the workspace's pool; false when another call holds it.
func (q Q) InsertAICall(ctx context.Context, c AICall) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO ai_calls(id,workspace_id,period,kind,operation,step,call_group,status,rate_card,model,tier,region,reserved_tokens,reserved_micros,created_at,pool)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (workspace_id, pool) WHERE status = 'reserved' DO NOTHING`,
		c.ID, c.WorkspaceID, c.Period, c.Kind, c.Operation, c.Step, c.Group, c.RateCard, c.Model, c.Tier, c.Region, c.ReservedTokens, c.ReservedMicros, c.CreatedAt, c.Pool)
	return err == nil && tag.RowsAffected() == 1, err
}

// SettleAICall records a reserved call's outcome; only a call still reserved is settled, once.
func (q Q) SettleAICall(ctx context.Context, c AICall, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE ai_calls SET status=$2,input_tokens=$3,cached_input_tokens=$4,output_tokens=$5,reasoning_tokens=$6,total_tokens=$7,
		cost_micros=$8,reported_model=$9,reported_tier=$10,request_id=$11,settled_at=$12,failure=$13 WHERE id=$1 AND status='reserved'`,
		c.ID, c.Status, c.Input, c.CachedInput, c.Output, c.Reasoning, c.Total, c.CostMicros, c.ReportedModel, c.ReportedTier, c.RequestID, now, c.Failure)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return err
}

// AICallInFlight is the reserved call of the workspace's pool, if any.
func (q Q) AICallInFlight(ctx context.Context, workspace, pool string) (AICall, bool, error) {
	c := AICall{WorkspaceID: workspace, Pool: pool, Status: "reserved"}
	err := q.db.QueryRow(ctx, `SELECT id,period,created_at,reserved_tokens,reserved_micros FROM ai_calls WHERE workspace_id=$1 AND pool=$2 AND status='reserved'`, workspace, pool).
		Scan(&c.ID, &c.Period, &c.CreatedAt, &c.ReservedTokens, &c.ReservedMicros)
	if errors.Is(err, pgx.ErrNoRows) {
		return AICall{}, false, nil
	}
	return c, err == nil, err
}

// AICallSpend: micro-USD charged to an operation and to a group (settled cost, else the reservation still held) and
// how many calls its step has made.
func (q Q) AICallSpend(ctx context.Context, workspace, operation, step, group string) (opMicros, groupMicros int64, stepCalls int, err error) {
	err = q.db.QueryRow(ctx, `SELECT
		coalesce(sum(coalesce(cost_micros,reserved_micros)) FILTER (WHERE operation=$2),0)::bigint,
		coalesce(sum(coalesce(cost_micros,reserved_micros)) FILTER (WHERE $4<>'' AND call_group=$4),0)::bigint,
		count(*) FILTER (WHERE operation=$2 AND step=$3)
		FROM ai_calls WHERE workspace_id=$1 AND (operation=$2 OR ($4<>'' AND call_group=$4))`, workspace, operation, step, group).Scan(&opMicros, &groupMicros, &stepCalls)
	return opMicros, groupMicros, stepCalls, err
}

// SettleUncertainAICalls charges every call left "uncertain" (by releases that blocked a month on an unknown outcome)
// its whole reservation, as aimodel now settles one, and unblocks the months; idempotent. It returns the calls settled.
func (q Q) SettleUncertainAICalls(ctx context.Context, now time.Time) ([]AICall, error) {
	rows, err := q.db.Query(ctx, `WITH c AS (
			UPDATE ai_calls SET status='settled', total_tokens=reserved_tokens, cost_micros=reserved_micros, settled_at=$1,
				failure='unknown_usage:'||coalesce(nullif(failure,''),'unknown')
			WHERE status='uncertain' RETURNING id,workspace_id,pool,period,reserved_tokens,reserved_micros,failure),
		s AS (SELECT workspace_id,pool,period,sum(reserved_tokens)::bigint t,sum(reserved_micros)::bigint m FROM c GROUP BY 1,2,3),
		h AS (UPDATE heidi_usage h SET tokens_used=h.tokens_used+s.t, tokens_reserved=greatest(h.tokens_reserved-s.t,0),
				cost_micros=h.cost_micros+s.m, cost_reserved_micros=greatest(h.cost_reserved_micros-s.m,0), updated_at=$1
			FROM s WHERE h.workspace_id=s.workspace_id AND h.pool=s.pool AND h.period=s.period)
		SELECT id,workspace_id,pool,period,reserved_tokens,reserved_micros,failure FROM c`, now)
	if err != nil {
		return nil, err
	}
	calls, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (AICall, error) {
		var c AICall
		return c, r.Scan(&c.ID, &c.WorkspaceID, &c.Pool, &c.Period, &c.ReservedTokens, &c.ReservedMicros, &c.Failure)
	})
	if err != nil {
		return nil, err
	}
	_, err = q.db.Exec(ctx, `UPDATE heidi_usage SET uncertain=false, updated_at=$1 WHERE uncertain`, now)
	return calls, err
}
