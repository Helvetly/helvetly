package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ExportTable is one file of a data export: Query selects one JSON value per row, with $1 the workspace or user.
type ExportTable struct{ Name, Query string }

// child selects the rows of table whose parent row (joined on fk) belongs to the workspace.
func child(table, parent, fk string) ExportTable {
	return ExportTable{table, `SELECT to_jsonb(c) FROM ` + table + ` c JOIN ` + parent + ` p ON p.id = c.` + fk + ` WHERE p.workspace_id = $1`}
}

func own(table string) ExportTable {
	return ExportTable{table, `SELECT to_jsonb(t) FROM ` + table + ` t WHERE t.workspace_id = $1`}
}

// WorkspaceExportTables: every record of a workspace, including soft-deleted and voided ones, without secrets
// (token hashes) and without what belongs to one person rather than the workspace (sessions, Heidi chats).
var WorkspaceExportTables = []ExportTable{
	{"workspace", `SELECT to_jsonb(w) FROM workspaces w WHERE w.id = $1`},
	{"members", `SELECT jsonb_build_object('user_id', m.user_id, 'email', u.email, 'name', u.name, 'role', m.role,
		'scopes', m.scopes, 'joined_at', m.created_at) FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1`},
	{"invitations", `SELECT to_jsonb(t) - 'token_hash' FROM workspace_invitations t WHERE t.workspace_id = $1`},
	own("workspace_billing"), own("workspace_ai_consents"),
	own("clients"), own("client_contacts"), own("self_billing_agreements"), own("products"),
	own("invoices"), child("invoice_lines", "invoices", "invoice_id"), child("invoice_payments", "invoices", "invoice_id"),
	child("invoice_refunds", "invoices", "invoice_id"), child("invoice_prepayments", "invoices", "invoice_id"),
	child("invoice_instalments", "invoices", "invoice_id"), child("invoice_deliveries", "invoices", "invoice_id"),
	child("invoice_xml_exports", "invoices", "invoice_id"), own("invoice_settings"), own("invoice_counters"),
	own("quotes"), own("quote_counters"),
	own("instalment_plans"), child("instalment_plan_items", "instalment_plans", "plan_id"), own("reminder_log"),
	own("expenses"), child("expense_lines", "expenses", "expense_id"), own("expense_categories"), own("expense_receipts"),
	own("engagements"), own("engagement_settings"), child("engagement_periods", "engagements", "engagement_id"),
	child("engagement_entries", "engagements", "engagement_id"), child("engagement_notices", "engagements", "engagement_id"),
	{"engagement_invoices", `SELECT to_jsonb(c) FROM engagement_invoices c JOIN engagement_periods ep ON ep.id = c.period_id
		JOIN engagements p ON p.id = ep.engagement_id WHERE p.workspace_id = $1`},
	own("documents"), own("document_folders"), own("document_links"), own("document_shares"), own("client_change_requests"),
	{"portal_sessions", `SELECT to_jsonb(t) - 'token_hash' - 'csrf_token' FROM portal_sessions t WHERE t.workspace_id = $1`},
	own("portal_avatars"),
	own("signature_requests"),
	{"signature_signers", `SELECT to_jsonb(c) - 'token_hash' FROM signature_signers c JOIN signature_requests p ON p.id = c.request_id WHERE p.workspace_id = $1`},
	child("signature_fields", "signature_requests", "request_id"), child("signature_events", "signature_requests", "request_id"),
	own("templates"),
	own("closed_periods"), own("financial_events"), own("ledger_settings"),
	own("workspace_counters"), own("dunning_notices"), own("vat_return_settings"), own("einvoice_transmissions"),
	own("import_batches"), own("import_files"), own("import_records"), own("heidi_usage"), own("ai_token_packs"), own("billing_disputes"),
}

// UserExportTables: what Helvetly holds about one person as account data, $1 the user; no secrets (passkey keys,
// TOTP secrets, recovery, session and API tokens).
var UserExportTables = []ExportTable{
	{"user", `SELECT to_jsonb(u) FROM users u WHERE u.id = $1`},
	{"sign_in_identities", `SELECT jsonb_build_object('provider', provider, 'subject', subject, 'email', email, 'created_at', created_at)
		FROM user_identities WHERE user_id = $1`},
	{"passkeys", `SELECT jsonb_build_object('id', id, 'name', name, 'created_at', created_at, 'last_used_at', last_used_at) FROM passkeys WHERE user_id = $1`},
	{"two_factor", `SELECT jsonb_build_object('enabled', enabled) FROM account_two_factor WHERE user_id = $1`},
	{"sessions", `SELECT jsonb_build_object('id', s.id, 'workspace_id', s.workspace_id, 'created_at', s.created_at, 'expires_at', s.expires_at,
		'last_active_at', s.last_active_at, 'user_agent', s.user_agent, 'ip', s.ip) FROM sessions s WHERE s.user_id = $1`},
	{"api_tokens", `SELECT jsonb_build_object('id', id, 'workspace_id', workspace_id, 'name', name, 'scopes', scopes, 'prefix', prefix,
		'created_at', created_at, 'last_used_at', last_used_at, 'expires_at', expires_at) FROM api_tokens WHERE user_id = $1`},
	{"memberships", `SELECT jsonb_build_object('workspace_id', w.id, 'workspace', w.name, 'role', m.role, 'scopes', m.scopes, 'joined_at', m.created_at)
		FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 AND w.deleted_at IS NULL`},
	{"heidi_messages", `SELECT jsonb_build_object('workspace_id', workspace_id, 'conversation_id', conversation_id, 'message', payload,
		'created_at', created_at) FROM heidi_messages WHERE user_id = $1`},
	{"feedback", `SELECT jsonb_build_object('id', f.id, 'workspace_id', f.workspace_id, 'kind', f.kind, 'description', f.description,
		'page_path', f.page_path, 'created_at', f.created_at, 'screenshots', (SELECT count(*) FROM product_feedback_files WHERE feedback_id = f.id))
		FROM product_feedback f WHERE f.user_id = $1`},
	{"heidi_conversations", `SELECT to_jsonb(t) FROM heidi_conversations t WHERE t.user_id = $1`},
	{"notifications", `SELECT to_jsonb(t) FROM notifications t WHERE t.user_id = $1`},
	{"document_folder_stars", `SELECT to_jsonb(t) FROM document_folder_stars t WHERE t.user_id = $1`},
}

// ExportFile is a stored object of the workspace and where it goes in the export.
type ExportFile struct{ Path, Key string }

// exportFiles: the workspace's stored objects; trashed documents are included while their object exists.
const exportFiles = `SELECT 'documents/' || id || '-' || name, object_key FROM documents WHERE workspace_id = $1
	UNION ALL SELECT 'receipts/' || id || '-' || name, object_key FROM expense_receipts WHERE workspace_id = $1
	UNION ALL SELECT 'invoices/' || coalesce(number, id) || '.pdf', pdf_key FROM invoices WHERE workspace_id = $1 AND pdf_key IS NOT NULL
	UNION ALL SELECT 'e-invoices/' || x.invoice_id || '-' || x.filename, x.object_key FROM invoice_xml_exports x
		JOIN invoices i ON i.id = x.invoice_id WHERE i.workspace_id = $1
	UNION ALL SELECT 'quotes/' || coalesce(number, id) || '.pdf', pdf_key FROM quotes WHERE workspace_id = $1 AND pdf_key IS NOT NULL
	UNION ALL SELECT 'signatures/' || id || '-original.pdf', original_key FROM signature_requests WHERE workspace_id = $1
	UNION ALL SELECT 'invoice-settings/logo', 'workspaces/' || workspace_id || '/invoice-settings/' || (settings->>'logo_file_id')
		FROM invoice_settings WHERE workspace_id = $1 AND settings->>'logo_file_id' IS NOT NULL
	UNION ALL SELECT 'portal-avatars/' || client_id || '-' || email || CASE content_type WHEN 'image/png' THEN '.png' ELSE '.jpg' END, object_key FROM portal_avatars WHERE workspace_id = $1
	ORDER BY 1`

// ExportWriter receives an export table by table: Table starts one (also when it has no rows), Row adds a row.
type ExportWriter interface {
	Table(name string) error
	Row(value json.RawMessage) error
}

// Export reads every table in one read-only snapshot, so the export is consistent, handing each row to w as it is
// read; with files it then returns the stored objects to add, read after the snapshot ends so no transaction
// waits on storage.
func (s *Store) Export(ctx context.Context, id string, tables []ExportTable, w ExportWriter, files bool) ([]ExportFile, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	for _, t := range tables {
		if err := w.Table(t.Name); err != nil {
			return nil, err
		}
		if err := eachJSON(ctx, tx, t, id, w.Row); err != nil {
			return nil, fmt.Errorf("export %s: %w", t.Name, err)
		}
	}
	if !files {
		return nil, nil
	}
	rows, err := tx.Query(ctx, exportFiles, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ExportFile, error) {
		var f ExportFile
		return f, r.Scan(&f.Path, &f.Key)
	})
}

func eachJSON(ctx context.Context, tx pgx.Tx, t ExportTable, id string, row func(json.RawMessage) error) error {
	rows, err := tx.Query(ctx, t.Query, id)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var v json.RawMessage
		if err := rows.Scan(&v); err != nil {
			return err
		}
		if err := row(v); err != nil {
			return err
		}
	}
	return rows.Err()
}

// ExportExcluded: tables neither export reads, each with the reason. TestExportCoversEveryTable fails on a table
// that is in no export and not here.
var ExportExcluded = map[string]string{
	"account_login_challenges": "sign-in secret (token hash), minutes long",
	"account_recovery_codes":   "sign-in secret (code hashes)",
	"email_codes":              "sign-in secret (code hashes), minutes long",
	"passkey_challenges":       "sign-in secret, minutes long",
	"transmission_credentials": "sealed e-invoice channel credentials",
	"heidi_confirmations":      "pending confirmations of Heidi actions, minutes long; the conversation is in heidi_messages",
	"digest_days":              "job bookkeeping: the days the engagements digest was sent",
	"invoice_xml_retention":    "history: the old, unverified mark of an archived XML's object lock",
	"object_retention":         "storage protection state of the workspace's objects, not business data",
	"object_versions":          "storage version ids of objects, not business data",
	"plan_limits":              "global plan configuration, not workspace data",
	"stripe_events":            "global webhook idempotency log, not workspace data",
}
