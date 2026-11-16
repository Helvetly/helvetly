package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// NameSuggestion is a workspace's one-time AI name suggestion (onboarding).
type NameSuggestion struct {
	WorkspaceID, RequestedBy, CompanyName string
	Status, Suggestion                    string
	RateCard, Model                       string
	InputTokens, OutputTokens, CostMicros *int64
	CreatedAt                             time.Time
}

// NameSuggestionOutcome is what ReserveNameSuggestion did.
type NameSuggestionOutcome int

const (
	NameReserved    NameSuggestionOutcome = iota // a new row: the caller may ask the model, once
	NameExisting                                 // the workspace's use is already taken; the row says how it went
	NameLimited                                  // the person reached the cap of new reservations
	NameOnboarded                                // the workspace is set up already
	NameNoWorkspace                              // no such workspace
)

// ReserveNameSuggestion takes the workspace's single use, inside the caller's transaction. The workspace row is locked
// first, so two requests of one workspace are ordered; the person's count is taken under an advisory lock, so the cap
// holds under concurrent requests from one person across workspaces. A repeat request finds the existing row and
// never counts towards the cap.
func (q Q) ReserveNameSuggestion(ctx context.Context, s NameSuggestion, perDay int, now time.Time) (NameSuggestion, NameSuggestionOutcome, error) {
	var onboarded bool
	err := q.db.QueryRow(ctx, `SELECT onboarded_at IS NOT NULL FROM workspaces WHERE id = $1 FOR UPDATE`, s.WorkspaceID).Scan(&onboarded)
	if errors.Is(err, pgx.ErrNoRows) {
		return NameSuggestion{}, NameNoWorkspace, nil
	}
	if err != nil {
		return NameSuggestion{}, 0, err
	}
	existing, err := q.nameSuggestion(ctx, s.WorkspaceID)
	if err == nil {
		return existing, NameExisting, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return NameSuggestion{}, 0, err
	}
	if onboarded {
		return NameSuggestion{}, NameOnboarded, nil
	}
	if _, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('name_suggestion:' || $1, 0))`, s.RequestedBy); err != nil {
		return NameSuggestion{}, 0, err
	}
	// The count comes from the person's own ledger, not from the suggestion rows: deleting a workspace removes its row
	// but must not give the person a new use.
	if _, err := q.db.Exec(ctx, `DELETE FROM name_suggestion_uses WHERE requested_by = $1 AND created_at < $2`, s.RequestedBy, now.Add(-7*24*time.Hour)); err != nil {
		return NameSuggestion{}, 0, err
	}
	var used int
	if err := q.db.QueryRow(ctx, `SELECT count(*) FROM name_suggestion_uses WHERE requested_by = $1 AND created_at > $2`,
		s.RequestedBy, now.Add(-24*time.Hour)).Scan(&used); err != nil {
		return NameSuggestion{}, 0, err
	}
	if used >= perDay {
		return NameSuggestion{}, NameLimited, nil
	}
	if _, err := q.db.Exec(ctx, `INSERT INTO name_suggestion_uses(requested_by, created_at) VALUES ($1, $2)`, s.RequestedBy, now); err != nil {
		return NameSuggestion{}, 0, err
	}
	s.Status, s.CreatedAt = "reserved", now
	_, err = q.db.Exec(ctx, `INSERT INTO workspace_name_suggestions(workspace_id,requested_by,company_name,consented_at,status,rate_card,model,created_at)
		VALUES ($1,$2,$3,$4,'reserved',$5,$6,$4)`, s.WorkspaceID, s.RequestedBy, s.CompanyName, now, s.RateCard, s.Model)
	return s, NameReserved, err
}

// SettleNameSuggestion records how the one call ended; only a reserved row is settled, once.
func (q Q) SettleNameSuggestion(ctx context.Context, s NameSuggestion, now time.Time) error {
	tag, err := q.db.Exec(ctx, `UPDATE workspace_name_suggestions SET status=$2,suggestion=$3,input_tokens=$4,output_tokens=$5,cost_micros=$6,settled_at=$7
		WHERE workspace_id=$1 AND status='reserved'`, s.WorkspaceID, s.Status, s.Suggestion, s.InputTokens, s.OutputTokens, s.CostMicros, now)
	if err == nil && tag.RowsAffected() != 1 {
		return ErrNotFound
	}
	return err
}

func (q Q) nameSuggestion(ctx context.Context, workspaceID string) (NameSuggestion, error) {
	var s NameSuggestion
	err := q.db.QueryRow(ctx, `SELECT workspace_id,requested_by,company_name,status,suggestion,rate_card,model,input_tokens,output_tokens,cost_micros,created_at
		FROM workspace_name_suggestions WHERE workspace_id = $1`, workspaceID).Scan(&s.WorkspaceID, &s.RequestedBy, &s.CompanyName, &s.Status,
		&s.Suggestion, &s.RateCard, &s.Model, &s.InputTokens, &s.OutputTokens, &s.CostMicros, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return NameSuggestion{}, ErrNotFound
	}
	return s, err
}
