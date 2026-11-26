package store

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// The engagements background job's lookups (docs/engagements-contract.md, "Automatic drafts and reminders").

type AutoInvoiceTarget struct{ WorkspaceID, Timezone, EngagementID string }

// AutoInvoiceTargets lists the live engagements that make their own drafts, in live workspaces.
func (q Q) AutoInvoiceTargets(ctx context.Context) ([]AutoInvoiceTarget, error) {
	rows, err := q.db.Query(ctx, `SELECT e.workspace_id, w.timezone, e.id FROM engagements e JOIN workspaces w ON w.id = e.workspace_id
		WHERE e.auto_invoice AND e.deleted_at IS NULL AND w.deleted_at IS NULL ORDER BY e.created_at, e.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []AutoInvoiceTarget{}
	for rows.Next() {
		var t AutoInvoiceTarget
		if err := rows.Scan(&t.WorkspaceID, &t.Timezone, &t.EngagementID); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

// LiveWorkspaces lists the live workspaces (id and time zone) that have at least one live engagement.
func (q Q) LiveWorkspaces(ctx context.Context) ([]Workspace, error) {
	return q.engagementWorkspaces(ctx, `SELECT w.id, w.timezone FROM workspaces w WHERE w.deleted_at IS NULL
		AND EXISTS (SELECT 1 FROM engagements e WHERE e.workspace_id = w.id AND e.deleted_at IS NULL) ORDER BY w.id`)
}

func (q Q) engagementWorkspaces(ctx context.Context, sql string) ([]Workspace, error) {
	rows, err := q.db.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByNameLax[Workspace])
}
