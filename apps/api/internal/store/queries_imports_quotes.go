package store

import "context"

// SimilarQuote: the workspace's quote with this number (of this client, or of any client when clientID is ""), or nil.
func (q Q) SimilarQuote(ctx context.Context, workspaceID, clientID, number string) (*ImportDuplicate, error) {
	var d ImportDuplicate
	err := q.db.QueryRow(ctx, `SELECT id, number, 'same quote number' FROM quotes
		WHERE workspace_id = $1 AND number = $2 AND ($3 = '' OR client_id = $3) LIMIT 1`,
		workspaceID, number, clientID).Scan(&d.ID, &d.Label, &d.Reason)
	return similar(d, err)
}
