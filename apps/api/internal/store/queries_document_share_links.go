package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type DocumentShareLink struct {
	ID        string     `json:"id"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at"`
	SingleUse bool       `json:"single_use"`
	UsedAt    *time.Time `json:"used_at"`
}

func (q Q) CreateDocumentShareLink(ctx context.Context, workspaceID, documentID string, link DocumentShareLink, hash []byte) error {
	tag, err := q.db.Exec(ctx, `INSERT INTO document_share_links (id, workspace_id, document_id, token_hash, single_use, created_at, expires_at)
		SELECT $3, d.workspace_id, d.id, $4, $5, $6, $7 FROM documents d JOIN workspaces w ON w.id = d.workspace_id
		WHERE d.workspace_id = $1 AND d.id = $2 AND d.deleted_at IS NULL AND NOT d.hr_private AND w.deleted_at IS NULL`,
		workspaceID, documentID, link.ID, hash, link.SingleUse, link.CreatedAt, link.ExpiresAt)
	return affected(tag, err)
}

func (q Q) DocumentShareLinks(ctx context.Context, workspaceID, documentID string) ([]DocumentShareLink, error) {
	rows, err := q.db.Query(ctx, `SELECT l.id, l.created_at, l.expires_at, l.single_use, l.used_at
		FROM document_share_links l JOIN documents d ON d.id = l.document_id AND d.workspace_id = l.workspace_id
		WHERE l.workspace_id = $1 AND l.document_id = $2 AND d.deleted_at IS NULL AND NOT d.hr_private
		ORDER BY l.created_at DESC, l.id`, workspaceID, documentID)
	if err != nil {
		return nil, err
	}
	links, err := pgx.CollectRows(rows, pgx.RowToStructByPos[DocumentShareLink])
	if links == nil {
		links = []DocumentShareLink{}
	}
	return links, err
}

func (q Q) DeleteDocumentShareLink(ctx context.Context, workspaceID, documentID, linkID string) error {
	tag, err := q.db.Exec(ctx, `DELETE FROM document_share_links WHERE workspace_id = $1 AND document_id = $2 AND id = $3`, workspaceID, documentID, linkID)
	return affected(tag, err)
}

type DocumentShareDownload struct {
	ObjectKey string
	Name      string
	Size      int64
}

const liveShareLink = `l.token_hash = $1 AND l.used_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > $2)
	AND d.id = l.document_id AND d.workspace_id = l.workspace_id AND d.deleted_at IS NULL AND NOT d.hr_private
	AND w.id = l.workspace_id AND w.deleted_at IS NULL`

func (q Q) DocumentShareDownload(ctx context.Context, hash []byte, now time.Time) (DocumentShareDownload, error) {
	var d DocumentShareDownload
	err := q.db.QueryRow(ctx, `SELECT d.object_key, d.name, d.size
		FROM document_share_links l, documents d, workspaces w WHERE `+liveShareLink, hash, now).
		Scan(&d.ObjectKey, &d.Name, &d.Size)
	return d, err
}

// Open the object before claiming it so an unavailable object does not consume a single-use link.
func (q Q) ClaimDocumentShareDownload(ctx context.Context, hash []byte, now time.Time, objectKey string) error {
	tag, err := q.db.Exec(ctx, `UPDATE document_share_links l
		SET used_at = CASE WHEN l.single_use THEN $2::timestamptz ELSE NULL END
		FROM documents d, workspaces w WHERE `+liveShareLink+` AND d.object_key = $3`, hash, now, objectKey)
	return affected(tag, err)
}
