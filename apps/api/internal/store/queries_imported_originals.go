package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ImportedOriginals returns a bounded page of legal originals. Advance by document ID even when
// a shared original cannot be filed. Only live, general documents of the invoice's workspace qualify.
func (q Q) ImportedOriginals(ctx context.Context, after string, limit int) ([]WorkspaceDocument, error) {
	rows, err := q.db.Query(ctx, `SELECT DISTINCT d.workspace_id, d.id FROM invoices i
		JOIN documents d ON d.id = i.source_document_id AND d.workspace_id = i.workspace_id
		JOIN workspaces w ON w.id = d.workspace_id AND w.deleted_at IS NULL
		WHERE i.origin = 'imported' AND d.id > $1 AND d.deleted_at IS NULL AND NOT d.hr_private
		AND NOT EXISTS (SELECT 1 FROM document_folders y
			JOIN document_folders k ON k.id = y.parent_id AND k.system_kind = 'invoices' AND k.deleted_at IS NULL
			JOIN document_folders c ON c.id = k.parent_id AND c.system_kind = 'client' AND c.system_ref = i.client_id AND c.deleted_at IS NULL
			JOIN document_folders r ON r.id = c.parent_id AND r.system_kind = 'clients' AND r.parent_id IS NULL AND r.deleted_at IS NULL
			WHERE y.id = d.folder_id AND y.system_kind = 'year' AND y.name = to_char(i.issue_date, 'YYYY') AND y.deleted_at IS NULL
			AND y.workspace_id = d.workspace_id AND k.workspace_id = d.workspace_id AND c.workspace_id = d.workspace_id AND r.workspace_id = d.workspace_id)
		ORDER BY d.id LIMIT $2`, after, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[WorkspaceDocument])
}

// FileImportedOriginal moves only the document that is the legal original of a single invoice.
// Links alone cannot identify an original. A second owner leaves the document where it is.
func (q Q) FileImportedOriginal(ctx context.Context, workspaceID, id, userID string, now time.Time) error {
	if err := q.LockLiveDocument(ctx, workspaceID, id); err != nil {
		return err
	}
	var client, name string
	var year int
	var current *string
	err := q.db.QueryRow(ctx, `SELECT i.client_id, extract(year FROM i.issue_date)::int, d.name, d.folder_id
		FROM documents d JOIN invoices i ON i.workspace_id = d.workspace_id AND i.source_document_id = d.id
		JOIN clients c ON c.workspace_id = i.workspace_id AND c.id = i.client_id AND c.deleted_at IS NULL
		WHERE d.workspace_id = $1 AND d.id = $2 AND i.origin = 'imported'
		AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.workspace_id = d.workspace_id AND
			(x.source_document_id = d.id OR x.pdf_key = d.object_key) AND x.id <> i.id)
		AND NOT EXISTS (SELECT 1 FROM document_links l WHERE l.document_id = d.id
			AND NOT (l.workspace_id = d.workspace_id AND ((l.target_type = 'invoice' AND l.target_id = i.id)
				OR (l.target_type = 'client' AND l.target_id = i.client_id))))
		AND NOT EXISTS (SELECT 1 FROM quotes x WHERE x.workspace_id = d.workspace_id AND x.pdf_key = d.object_key)
		AND NOT EXISTS (SELECT 1 FROM quote_revisions x WHERE x.workspace_id = d.workspace_id AND x.pdf_key = d.object_key)
		AND NOT EXISTS (SELECT 1 FROM quote_contracts x WHERE x.workspace_id = d.workspace_id AND x.document_id = d.id)
		AND NOT EXISTS (SELECT 1 FROM signature_requests x WHERE x.workspace_id = d.workspace_id AND
			(x.document_id = d.id OR x.signed_document_id = d.id OR x.original_key = d.object_key))
		AND NOT EXISTS (SELECT 1 FROM engagements x WHERE x.workspace_id = d.workspace_id AND x.document_id = d.id)
		AND NOT EXISTS (SELECT 1 FROM templates x WHERE x.workspace_id = d.workspace_id AND x.document_id = d.id)
		AND NOT EXISTS (SELECT 1 FROM expense_receipts x WHERE x.workspace_id = d.workspace_id AND x.object_key = d.object_key)`,
		workspaceID, id).Scan(&client, &year, &name, &current)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	folder, err := q.ClientRecordFolder(ctx, workspaceID, client, "invoices", year, userID, now)
	if err != nil || current != nil && *current == folder {
		return err
	}
	if err := q.LockContainer(ctx, workspaceID, &folder); err != nil {
		return err
	}
	name, err = q.FreeFileName(ctx, workspaceID, &folder, name)
	if err != nil {
		return err
	}
	return q.UpdateDocument(ctx, workspaceID, id, name, &folder, now)
}
