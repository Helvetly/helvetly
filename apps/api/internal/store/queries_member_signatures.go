package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// MemberSignature is a member's own signature for contracts: the image's object (none: only a place) and the place
// they sign at ("" = the workspace's city).
type MemberSignature struct {
	ObjectKey   string
	ContentType string
	SHA256      string
	Place       string
	UpdatedAt   time.Time
}

// LockMemberSignature: the member's signature, locked for a change; ErrNotFound without one.
func (q Q) LockMemberSignature(ctx context.Context, workspaceID, userID string) (MemberSignature, error) {
	return q.memberSignature(ctx, workspaceID, userID, " FOR UPDATE")
}

// MemberSignatureOf: the member's signature; ErrNotFound without one.
func (q Q) MemberSignatureOf(ctx context.Context, workspaceID, userID string) (MemberSignature, error) {
	return q.memberSignature(ctx, workspaceID, userID, "")
}

func (q Q) memberSignature(ctx context.Context, workspaceID, userID, lock string) (MemberSignature, error) {
	var m MemberSignature
	err := q.db.QueryRow(ctx, `SELECT coalesce(object_key, ''), coalesce(content_type, ''), coalesce(sha256, ''),
		coalesce(place, ''), updated_at FROM member_signatures WHERE workspace_id = $1 AND user_id = $2`+lock,
		workspaceID, userID).Scan(&m.ObjectKey, &m.ContentType, &m.SHA256, &m.Place, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

// SetMemberSignature stores the member's signature as given (empty fields stored as none).
func (q Q) SetMemberSignature(ctx context.Context, workspaceID, userID string, m MemberSignature) error {
	_, err := q.db.Exec(ctx, `INSERT INTO member_signatures (workspace_id, user_id, object_key, content_type, sha256, place, updated_at)
		VALUES ($1, $2, nullif($3, ''), nullif($4, ''), nullif($5, ''), nullif($6, ''), $7)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET object_key = excluded.object_key, content_type = excluded.content_type,
			sha256 = excluded.sha256, place = excluded.place, updated_at = excluded.updated_at`,
		workspaceID, userID, m.ObjectKey, m.ContentType, m.SHA256, m.Place, m.UpdatedAt)
	return err
}
