package store

import "context"

// SimilarEngagement: a live engagement of the client with the same title (case-insensitive) and start date.
func (q Q) SimilarEngagement(ctx context.Context, workspaceID, clientID, title, startDate string) (*ImportDuplicate, error) {
	var d ImportDuplicate
	err := q.db.QueryRow(ctx, `SELECT id, title || ' (#' || number || ')', 'same client, title and start'
		FROM engagements WHERE workspace_id=$1 AND client_id=$2 AND lower(title)=lower($3) AND start_date=$4::date
			AND deleted_at IS NULL
		ORDER BY number LIMIT 1`, workspaceID, clientID, title, startDate).Scan(&d.ID, &d.Label, &d.Reason)
	return similar(d, err)
}
