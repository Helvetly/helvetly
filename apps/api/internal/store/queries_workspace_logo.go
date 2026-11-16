package store

import "context"

// LockWorkspaceLogo serialises replacing and removing a workspace's logo until the transaction ends.
func (q Q) LockWorkspaceLogo(ctx context.Context, workspaceID string) error {
	_, err := q.db.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "workspace-logo:"+workspaceID)
	return err
}

// WorkspaceLogoID is the workspace's logo pointer (nil: none); ErrNotFound for a missing or deleted workspace.
func (q Q) WorkspaceLogoID(ctx context.Context, workspaceID string) (*string, error) {
	var id *string
	err := q.db.QueryRow(ctx, `SELECT logo_file_id FROM workspaces WHERE id = $1 AND deleted_at IS NULL`, workspaceID).Scan(&id)
	return id, err
}

// MemberWorkspaceLogoID is WorkspaceLogoID for a person who must be a member: ErrNotFound otherwise, the same
// as for a workspace that does not exist.
func (q Q) MemberWorkspaceLogoID(ctx context.Context, workspaceID, userID string) (*string, error) {
	var id *string
	err := q.db.QueryRow(ctx, `SELECT w.logo_file_id FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
		WHERE w.id = $1 AND m.user_id = $2 AND w.deleted_at IS NULL`, workspaceID, userID).Scan(&id)
	return id, err
}

// SetWorkspaceLogoID points the workspace at a logo object (nil removes it).
func (q Q) SetWorkspaceLogoID(ctx context.Context, workspaceID string, id *string) error {
	_, err := q.db.Exec(ctx, `UPDATE workspaces SET logo_file_id = $2 WHERE id = $1`, workspaceID, id)
	return err
}

// WorkspaceLogoURL is the opaque download path of a workspace's logo; the id is a cache version.
func WorkspaceLogoURL(workspaceID string, id *string) *string {
	if id == nil {
		return nil
	}
	u := "/api/v1/workspaces/" + workspaceID + "/logo?v=" + *id
	return &u
}
