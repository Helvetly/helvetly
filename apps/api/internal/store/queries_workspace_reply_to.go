package store

import "context"

// WorkspaceReplyTo is the workspace's own reply address for its client email (nil: none set).
func (q Q) WorkspaceReplyTo(ctx context.Context, workspaceID string) (*string, error) {
	var a *string
	err := q.db.QueryRow(ctx, `SELECT reply_to_email FROM workspaces WHERE id = $1`, workspaceID).Scan(&a)
	return a, err
}

// LockWorkspaceReplyTo reads WorkspaceReplyTo and locks the workspace's row until the transaction ends, so two
// changes at once are applied and audited one after the other.
func (q Q) LockWorkspaceReplyTo(ctx context.Context, workspaceID string) (*string, error) {
	var a *string
	err := q.db.QueryRow(ctx, `SELECT reply_to_email FROM workspaces WHERE id = $1 FOR UPDATE`, workspaceID).Scan(&a)
	return a, err
}

// SetWorkspaceReplyTo sets the workspace's reply address (nil clears it).
func (q Q) SetWorkspaceReplyTo(ctx context.Context, workspaceID string, address *string) error {
	_, err := q.db.Exec(ctx, `UPDATE workspaces SET reply_to_email = $2 WHERE id = $1`, workspaceID, address)
	return err
}
