package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// AICall is one model provider call: what it reserved before it was made and, once settled, what it used.
type AICall struct {
	ID, WorkspaceID, Period                string
	Kind, Operation, Step, Group           string
	Status                                 string
	RateCard, Model, Tier, Region          string
	ReservedTokens, ReservedMicros         int64
	Input, CachedInput                     *int64
	Output, Reasoning, Total               *int64
	CostMicros                             *int64
	ReportedModel, ReportedTier, RequestID string
	CreatedAt                              time.Time
}

// InsertAICall reserves the workspace's one call in flight; false when another call holds it.
func (q Q) InsertAICall(ctx context.Context, c AICall) (bool, error) {
	tag, err := q.db.Exec(ctx, `INSERT INTO ai_calls(id,workspace_id,period,kind,operation,step,call_group,status,rate_card,model,tier,region,reserved_tokens,reserved_micros,created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (workspace_id) WHERE status = 'reserved' DO NOTHING`,
		c.ID, c.WorkspaceID, c.Period, c.Kind, c.Operation, c.Step, c.Group, c.RateCard, c.Model, c.Tier, c.Region, c.ReservedTokens, c.ReservedMicros, c.CreatedAt)
	return err == nil && tag.RowsAffected() == 1, err
}

// SettleAICall records a reserved call's outcome; only a call still reserved is settled, once.
func (q Q) SettleAICall(ctx context.Context, c AICall, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE ai_calls SET status=$2,input_tokens=$3,cached_input_tokens=$4,output_tokens=$5,reasoning_tokens=$6,total_tokens=$7,
		cost_micros=$8,reported_model=$9,reported_tier=$10,request_id=$11,settled_at=$12 WHERE id=$1 AND status='reserved'`,
		c.ID, c.Status, c.Input, c.CachedInput, c.Output, c.Reasoning, c.Total, c.CostMicros, c.ReportedModel, c.ReportedTier, c.RequestID, now)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return err
}

// AICallInFlight is the workspace's reserved call, if any.
func (q Q) AICallInFlight(ctx context.Context, workspace string) (AICall, bool, error) {
	c := AICall{WorkspaceID: workspace, Status: "reserved"}
	err := q.db.QueryRow(ctx, `SELECT id,period,created_at FROM ai_calls WHERE workspace_id=$1 AND status='reserved'`, workspace).Scan(&c.ID, &c.Period, &c.CreatedAt)
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
