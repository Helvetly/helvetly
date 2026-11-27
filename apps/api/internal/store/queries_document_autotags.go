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
// then the system folder it sits in (Clients/<client>, Invoices, …, <year>, Expenses/<year>/<category>, Tax Documents/<year>).
const autoTagSQL = `WITH RECURSIVE up AS (
		SELECT f.id, f.parent_id, f.system_kind, f.system_ref, f.name, 0 AS depth
		FROM documents d JOIN document_folders f ON f.id = d.folder_id AND f.workspace_id = d.workspace_id AND f.deleted_at IS NULL
		WHERE d.workspace_id = $1 AND d.id = $2
		UNION ALL
		SELECT p.id, p.parent_id, p.system_kind, p.system_ref, p.name, u.depth + 1
		FROM up u JOIN document_folders p ON p.id = u.parent_id AND p.workspace_id = $1 AND p.deleted_at IS NULL WHERE u.depth < 32),
	fx AS (SELECT
		(SELECT system_kind FROM up WHERE system_kind IN ('invoices', 'quotes', 'engagements', 'signatures', 'contracts', 'expenses', 'tax_documents',
				'client_bank_statements')
			ORDER BY depth LIMIT 1) AS kind,
		(SELECT name FROM up WHERE system_kind = 'year' AND name ~ '^[0-9]{4}$' ORDER BY depth LIMIT 1) AS year,
		(SELECT system_ref FROM up WHERE system_kind = 'client' ORDER BY depth LIMIT 1) AS client,
		(SELECT c.name FROM up JOIN expense_categories c ON c.id = up.system_ref
			WHERE up.system_kind = 'expense_category' ORDER BY depth LIMIT 1) AS category)
	SELECT d.tags, d.auto_tags, d.removed_auto_tags, coalesce(inv.kind, ''), coalesce(d.filed_kind, ''),
		CASE WHEN inv.kind IS NOT NULL THEN ''
			WHEN qt.found THEN 'quote' WHEN qc.number IS NOT NULL THEN 'contract' WHEN ex.found THEN 'receipt' WHEN eg.start_date IS NOT NULL THEN 'engagement'
			ELSE CASE fx.kind WHEN 'invoices' THEN 'invoice' WHEN 'quotes' THEN 'quote' WHEN 'engagements' THEN 'engagement'
				WHEN 'contracts' THEN 'contract' WHEN 'expenses' THEN 'receipt' WHEN 'tax_documents' THEN 'tax-document'
				-- a client's Bank Statements also holds payment confirmations: the folder says bank statement only without a filed kind
				WHEN 'client_bank_statements' THEN CASE WHEN d.filed_kind IS NULL THEN 'bank-statement' ELSE '' END ELSE '' END END,
		coalesce(to_char(CASE WHEN inv.kind IS NOT NULL THEN inv.issue_date WHEN qt.found THEN qt.issue_date
			WHEN qc.number IS NOT NULL THEN (qc.created_at AT TIME ZONE w.timezone)::date WHEN ex.found THEN ex.document_date
			WHEN eg.start_date IS NOT NULL THEN eg.start_date ELSE (sg.completed_at AT TIME ZONE w.timezone)::date END, 'YYYY-MM'), fx.year, ''),
		coalesce((SELECT c.name FROM clients c WHERE c.workspace_id = $1 AND c.id = coalesce(inv.client_id, qt.client_id, qc.client_id, eg.client_id,
			fx.client, (SELECT min(l.target_id) FROM document_links l WHERE l.document_id = d.id AND l.target_type = 'client'))), ''),
		coalesce(inv.number, qt.number, qc.number, ''),
		coalesce(CASE WHEN ex.found THEN ex.category ELSE fx.category END, ''),
		coalesce(qc.quote_number, ''),
		sg.completed_at IS NOT NULL
	FROM documents d JOIN workspaces w ON w.id = d.workspace_id CROSS JOIN fx
	LEFT JOIN LATERAL (SELECT i.kind, i.issue_date, i.client_id, i.number FROM invoices i
		WHERE i.workspace_id = d.workspace_id AND (i.pdf_key = d.object_key OR i.source_document_id = d.id
			OR i.id IN (SELECT l.target_id FROM document_links l WHERE l.document_id = d.id AND l.target_type = 'invoice'))
		ORDER BY CASE WHEN i.source_document_id = d.id THEN 1 WHEN i.pdf_key = d.object_key THEN 2 ELSE 3 END, i.issue_date DESC NULLS LAST, i.id LIMIT 1) inv ON true
	LEFT JOIN LATERAL (SELECT true AS found, CASE WHEN pg_input_is_valid(rev.snapshot->>'issue_date', 'date')
			THEN (rev.snapshot->>'issue_date')::date WHEN t.pdf_key = d.object_key THEN t.issue_date END AS issue_date,
			t.client_id, t.number FROM quotes t
		LEFT JOIN LATERAL (SELECT qr.snapshot, qr.revision FROM quote_revisions qr WHERE qr.workspace_id = d.workspace_id
			AND qr.quote_id = t.id AND qr.pdf_key = d.object_key ORDER BY qr.revision DESC LIMIT 1) rev ON true
		WHERE t.workspace_id = d.workspace_id AND (t.pdf_key = d.object_key OR rev.revision IS NOT NULL)
		ORDER BY t.issue_date DESC NULLS LAST, t.id LIMIT 1) qt ON true
	LEFT JOIN LATERAL (SELECT c.created_at, c.number, t.number AS quote_number, t.client_id FROM quote_contracts c JOIN quotes t ON t.id = c.quote_id AND t.workspace_id = c.workspace_id
		WHERE c.workspace_id = d.workspace_id AND (c.document_id = d.id OR c.document_id IN (SELECT s.document_id
			FROM signature_requests s WHERE s.workspace_id = d.workspace_id AND s.signed_document_id = d.id))
		ORDER BY c.created_at DESC LIMIT 1) qc ON true
	LEFT JOIN LATERAL (SELECT true AS found, ec.name AS category, e.document_date
		FROM document_links l JOIN expenses e ON e.id = l.target_id AND e.workspace_id = d.workspace_id
		LEFT JOIN expense_categories ec ON ec.id = e.category_id
		WHERE l.document_id = d.id AND l.target_type = 'expense' ORDER BY e.created_at DESC, e.id LIMIT 1) ex ON true
	LEFT JOIN LATERAL (SELECT e.start_date, e.client_id FROM engagements e WHERE e.workspace_id = d.workspace_id
		AND e.document_id = d.id AND e.deleted_at IS NULL ORDER BY e.start_date DESC, e.id LIMIT 1) eg ON true
	CROSS JOIN LATERAL (SELECT max(s.completed_at) AS completed_at FROM signature_requests s WHERE s.workspace_id = d.workspace_id
		AND s.status = 'completed' AND (s.document_id = d.id OR s.signed_document_id = d.id)) sg
	WHERE d.workspace_id = $1 AND d.id = $2 AND d.deleted_at IS NULL AND NOT d.hr_private FOR UPDATE OF d`

// AutoTag sets a live general file's automatic tags (tags.Merge of tags.Auto); nothing for another file.
func (q Q) AutoTag(ctx context.Context, workspaceID, documentID string, now time.Time) error {
	var have, auto, removed []string
	var invoiceKind, filedKind string
	var r tags.Record
	err := q.db.QueryRow(ctx, autoTagSQL, workspaceID, documentID).Scan(&have, &auto, &removed, &invoiceKind, &filedKind, &r.Kind,
		&r.Period, &r.Client, &r.Number, &r.Category, &r.FromQuote, &r.Signed)
	if errors.Is(err, ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	switch {
	case invoiceKind != "":
		r.Kind = tags.InvoiceKinds[invoiceKind]
	case r.Kind == "" && tags.Kind(filedKind):
		r.Kind = filedKind
	}
	locked := tags.Locked(r)
	next, nextAuto := tags.Merge(have, auto, removed, tags.Auto(r), locked)
	_, err = q.db.Exec(ctx, `UPDATE documents SET tags = $3, auto_tags = $4, auto_tagged_at = $5, record_tags_current = true,
		locked_tags = $7, removed_auto_tags = ARRAY(SELECT t FROM unnest(removed_auto_tags) a(t) WHERE t !~ $6 AND NOT t = ANY($7))
		WHERE workspace_id = $1 AND id = $2`, workspaceID, documentID, next, nextAuto, now, tags.ProtectedPattern, locked)
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

// WorkspaceDocument identifies one document and its tenant.
type WorkspaceDocument struct{ WorkspaceID, ID string }

// UntaggedDocuments finds files not yet tagged and files with protected auto tags dismissed by older versions.
func (q Q) UntaggedDocuments(ctx context.Context, limit int) ([]WorkspaceDocument, error) {
	rows, err := q.db.Query(ctx, `SELECT workspace_id, id FROM documents WHERE deleted_at IS NULL AND NOT hr_private
		AND (NOT record_tags_current OR auto_tagged_at IS NULL)
		ORDER BY id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkspaceDocument
	for rows.Next() {
		var d WorkspaceDocument
		if err := rows.Scan(&d.WorkspaceID, &d.ID); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
