package store

import (
	"context"
	"errors"
	"time"

	"helvetly.com/api/internal/tags"
)

// Automatic tags: every write that files a record's file or puts a file into a system folder (CreateDocument,
// UpdateDocument, AddDocumentLink, AddQuoteContract, AddQuoteRevision, CompleteSignatureRequest) tags the file from
// what it is (tags.Auto), and the start-up backfill tags the files from before.

// autoTagSQL: a live general file's tags and its tags.Record. The record decides first (an invoice whose PDF or
// original it is, a quote's PDF or revision, a contract made from a quote or its signed copy, a receipt's expense),
// then the system folder it sits in (Clients/<client>, Invoices, …, <year>, Expenses/<year>/<category>).
const autoTagSQL = `WITH RECURSIVE up AS (
		SELECT f.id, f.parent_id, f.system_kind, f.system_ref, f.name, 0 AS depth
		FROM documents d JOIN document_folders f ON f.id = d.folder_id AND f.deleted_at IS NULL
		WHERE d.workspace_id = $1 AND d.id = $2
		UNION ALL
		SELECT p.id, p.parent_id, p.system_kind, p.system_ref, p.name, u.depth + 1
		FROM up u JOIN document_folders p ON p.id = u.parent_id AND p.deleted_at IS NULL WHERE u.depth < 32),
	fx AS (SELECT
		(SELECT system_kind FROM up WHERE system_kind IN ('invoices', 'quotes', 'engagements', 'signatures', 'contracts', 'expenses')
			ORDER BY depth LIMIT 1) AS kind,
		(SELECT name::int FROM up WHERE system_kind = 'year' AND name ~ '^[0-9]{4}$' ORDER BY depth LIMIT 1) AS year,
		(SELECT system_ref FROM up WHERE system_kind = 'client' ORDER BY depth LIMIT 1) AS client,
		(SELECT c.name FROM up JOIN expense_categories c ON c.id = up.system_ref
			WHERE up.system_kind = 'expense_category' ORDER BY depth LIMIT 1) AS category)
	SELECT d.tags, d.auto_tags, d.removed_auto_tags,
		CASE WHEN inv.kind IS NOT NULL THEN CASE inv.kind WHEN 'credit_note' THEN 'credit-note' WHEN 'debit_note' THEN 'debit-note' ELSE 'invoice' END
			WHEN qt.found THEN 'quote' WHEN qc.number IS NOT NULL THEN 'contract' WHEN ex.found THEN 'receipt'
			ELSE CASE fx.kind WHEN 'invoices' THEN 'invoice' WHEN 'quotes' THEN 'quote' WHEN 'engagements' THEN 'engagement'
				WHEN 'contracts' THEN 'contract' WHEN 'expenses' THEN 'receipt' ELSE '' END END,
		coalesce(inv.year, qt.year, ex.year, fx.year, 0),
		coalesce((SELECT c.name FROM clients c WHERE c.workspace_id = $1 AND c.id = coalesce(inv.client_id, qt.client_id, qc.client_id,
			fx.client, (SELECT min(l.target_id) FROM document_links l WHERE l.document_id = d.id AND l.target_type = 'client'))), ''),
		coalesce(inv.number, qt.number, qc.number, ''),
		coalesce(CASE WHEN ex.found THEN ex.category ELSE fx.category END, ''),
		coalesce(qc.quote_number, ''),
		sg.signed
	FROM documents d CROSS JOIN fx
	LEFT JOIN LATERAL (SELECT i.kind, extract(year FROM i.issue_date)::int AS year, i.client_id, i.number FROM invoices i
		WHERE i.workspace_id = d.workspace_id AND (i.pdf_key = d.object_key OR i.source_document_id = d.id
			OR i.id IN (SELECT l.target_id FROM document_links l WHERE l.document_id = d.id AND l.target_type = 'invoice'))
		ORDER BY i.issue_date DESC NULLS LAST, i.id LIMIT 1) inv ON true
	LEFT JOIN LATERAL (SELECT true AS found, extract(year FROM t.issue_date)::int AS year, t.client_id, t.number FROM quotes t
		WHERE t.workspace_id = d.workspace_id AND (t.pdf_key = d.object_key
			OR EXISTS (SELECT 1 FROM quote_revisions qr WHERE qr.quote_id = t.id AND qr.pdf_key = d.object_key))
		ORDER BY t.issue_date DESC NULLS LAST, t.id LIMIT 1) qt ON true
	LEFT JOIN LATERAL (SELECT c.number, t.number AS quote_number, t.client_id FROM quote_contracts c JOIN quotes t ON t.id = c.quote_id
		WHERE c.workspace_id = d.workspace_id AND (c.document_id = d.id OR c.document_id IN (SELECT s.document_id
			FROM signature_requests s WHERE s.workspace_id = d.workspace_id AND s.signed_document_id = d.id))
		ORDER BY c.created_at DESC LIMIT 1) qc ON true
	LEFT JOIN LATERAL (SELECT true AS found, ec.name AS category, extract(year FROM coalesce(e.document_date,
			(e.created_at AT TIME ZONE (SELECT w.timezone FROM workspaces w WHERE w.id = d.workspace_id))::date))::int AS year
		FROM document_links l JOIN expenses e ON e.id = l.target_id AND e.workspace_id = d.workspace_id
		LEFT JOIN expense_categories ec ON ec.id = e.category_id
		WHERE l.document_id = d.id AND l.target_type = 'expense' ORDER BY e.created_at DESC, e.id LIMIT 1) ex ON true
	CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM signature_requests s WHERE s.workspace_id = d.workspace_id
		AND s.status = 'completed' AND (s.document_id = d.id OR s.signed_document_id = d.id)) AS signed) sg
	WHERE d.workspace_id = $1 AND d.id = $2 AND d.deleted_at IS NULL AND NOT d.hr_private FOR UPDATE OF d`

// AutoTag sets a live general file's automatic tags (tags.Merge of tags.Auto); nothing for another file.
func (q Q) AutoTag(ctx context.Context, workspaceID, documentID string, now time.Time) error {
	var have, auto, removed []string
	var r tags.Record
	err := q.db.QueryRow(ctx, autoTagSQL, workspaceID, documentID).Scan(&have, &auto, &removed, &r.Kind, &r.Year, &r.Client,
		&r.Number, &r.Category, &r.FromQuote, &r.Signed)
	if errors.Is(err, ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	next, nextAuto := tags.Merge(have, auto, removed, tags.Auto(r))
	_, err = q.db.Exec(ctx, `UPDATE documents SET tags = $3, auto_tags = $4, auto_tagged_at = $5,
		removed_auto_tags = ARRAY(SELECT t FROM unnest(removed_auto_tags) a(t) WHERE t !~ $6)
		WHERE workspace_id = $1 AND id = $2`, workspaceID, documentID, next, nextAuto, now, tags.ProtectedPattern)
	return err
}

// autoTagObject tags the workspace's live files of an object (a record's PDF they share).
func (q Q) autoTagObject(ctx context.Context, workspaceID, objectKey string, now time.Time) error {
	rows, err := q.db.Query(ctx, `SELECT id FROM documents WHERE workspace_id = $1 AND object_key = $2 AND deleted_at IS NULL`,
		workspaceID, objectKey)
	if err != nil {
		return err
	}
	ids, err := collect(rows)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := q.AutoTag(ctx, workspaceID, id, now); err != nil {
			return err
		}
	}
	return nil
}

// UntaggedDocument is a live file that needs automatic tag backfill.
type UntaggedDocument struct{ WorkspaceID, ID string }

// UntaggedDocuments finds files not yet tagged and files with protected auto tags dismissed by older versions.
func (q Q) UntaggedDocuments(ctx context.Context, limit int) ([]UntaggedDocument, error) {
	rows, err := q.db.Query(ctx, `SELECT workspace_id, id FROM documents WHERE deleted_at IS NULL AND NOT hr_private
		AND (auto_tagged_at IS NULL OR EXISTS (SELECT 1 FROM unnest(removed_auto_tags) a(t) WHERE t ~ $2))
		ORDER BY id LIMIT $1`, limit, tags.ProtectedPattern)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UntaggedDocument
	for rows.Next() {
		var d UntaggedDocument
		if err := rows.Scan(&d.WorkspaceID, &d.ID); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
