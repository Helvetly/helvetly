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
	own("workspace_billing"), own("workspace_ai_consents"), own("workspace_name_suggestions"),
	own("clients"), own("client_contacts"), own("self_billing_agreements"), own("products"),
	own("invoices"), child("invoice_lines", "invoices", "invoice_id"), child("invoice_payments", "invoices", "invoice_id"),
	child("invoice_refunds", "invoices", "invoice_id"), child("invoice_prepayments", "invoices", "invoice_id"),
	child("invoice_instalments", "invoices", "invoice_id"), child("invoice_deliveries", "invoices", "invoice_id"),
	child("invoice_xml_exports", "invoices", "invoice_id"), own("invoice_settings"), own("invoice_counters"), own("email_templates"),
	own("quotes"), own("quote_revisions"), own("quote_counters"), own("quote_contracts"), own("contract_counters"),
	own("instalment_plans"), child("instalment_plan_items", "instalment_plans", "plan_id"), own("reminder_log"),
	own("expenses"), child("expense_lines", "expenses", "expense_id"), own("expense_categories"), own("expense_receipts"),
	own("engagements"), own("engagement_settings"), child("engagement_periods", "engagements", "engagement_id"),
	child("engagement_entries", "engagements", "engagement_id"), child("engagement_notices", "engagements", "engagement_id"),
	{"engagement_invoices", `SELECT to_jsonb(c) FROM engagement_invoices c JOIN engagement_periods ep ON ep.id = c.period_id
		JOIN engagements p ON p.id = ep.engagement_id WHERE p.workspace_id = $1`},
	{"documents", `SELECT to_jsonb(t) FROM documents t WHERE t.workspace_id = $1 AND NOT t.hr_private`}, own("document_folders"), own("document_links"), own("document_shares"),
	{"document_filings", `SELECT to_jsonb(t) FROM document_filings t JOIN documents d ON d.id = t.document_id
		WHERE t.workspace_id = $1 AND NOT d.hr_private`}, own("client_change_requests"),
	{"portal_sessions", `SELECT to_jsonb(t) - 'token_hash' - 'csrf_token' FROM portal_sessions t WHERE t.workspace_id = $1`},
	own("portal_avatars"),
	own("signature_requests"),
	{"signature_signers", `SELECT to_jsonb(c) - 'token_hash' FROM signature_signers c JOIN signature_requests p ON p.id = c.request_id WHERE p.workspace_id = $1`},
	child("signature_fields", "signature_requests", "request_id"), child("signature_events", "signature_requests", "request_id"),
	own("templates"),
	own("closed_periods"), own("financial_events"), own("ledger_settings"),
	own("approval_groups"), own("approval_group_members"), own("approval_policies"), own("approval_requests"), own("approval_authors"),
	child("approval_decisions", "approval_requests", "request_id"),
	own("workspace_counters"), own("dunning_notices"), own("vat_return_settings"), own("einvoice_transmissions"),
	{"import_batches", `SELECT to_jsonb(t) FROM import_batches t WHERE t.workspace_id = $1 AND t.kind <> 'payroll'`},
	{"import_files", `SELECT to_jsonb(t) FROM import_files t JOIN import_batches b ON b.id = t.batch_id
		WHERE t.workspace_id = $1 AND b.kind <> 'payroll'`},
	{"import_records", `SELECT to_jsonb(t) FROM import_records t JOIN import_batches b ON b.id = t.batch_id
		WHERE t.workspace_id = $1 AND b.kind <> 'payroll'`}, own("heidi_usage"), own("ai_calls"), own("ai_token_packs"), own("billing_disputes"),
	own("scheduling_settings"), own("scheduling_holidays"), own("scheduling_hosts"), own("scheduling_availability"),
	own("scheduling_availability_overrides"), own("scheduling_event_types"), own("scheduling_events"), own("scheduling_occurrences"),
	child("scheduling_occurrence_entries", "scheduling_occurrences", "occurrence_id"), own("scheduling_requests"),
	child("scheduling_reminders", "scheduling_occurrences", "occurrence_id"),
	{"scheduling_booking_links", `SELECT to_jsonb(t) - 'token_hash' - 'token_sealed' FROM scheduling_booking_links t WHERE t.workspace_id = $1`},
}

// HRExportTables: the workspace's employees and payroll (docs/planning/2026-11-15-employees.md), for the owner's
// export only, in its own folder; internal/employees opens the sealed fields before they are written.
var HRExportTables = []ExportTable{
	own("employment_settings"), own("employees"), own("employee_pay_terms"), own("employee_documents"),
	{"documents", `SELECT to_jsonb(t) FROM documents t WHERE t.workspace_id = $1 AND t.hr_private`},
	own("payroll_entries"), child("payroll_components", "payroll_entries", "entry_id"),
	own("payroll_bookings"), child("payroll_booking_items", "payroll_bookings", "booking_id"),
	{"import_batches", `SELECT to_jsonb(t) FROM import_batches t WHERE t.workspace_id = $1 AND t.kind = 'payroll'`},
	{"import_files", `SELECT to_jsonb(t) FROM import_files t JOIN import_batches b ON b.id = t.batch_id
		WHERE t.workspace_id = $1 AND b.kind = 'payroll'`},
	{"import_records", `SELECT to_jsonb(t) FROM import_records t JOIN import_batches b ON b.id = t.batch_id
		WHERE t.workspace_id = $1 AND b.kind = 'payroll'`},
}

// hrExportFiles: the employees' documents, in a folder per employee.
const hrExportFiles = `SELECT employee_id || '/' || id || '-' || name, object_key FROM documents
	WHERE workspace_id = $1 AND hr_private AND employee_id IS NOT NULL ORDER BY 1`

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
const exportFiles = `SELECT 'documents/' || id || '-' || name, object_key FROM documents WHERE workspace_id = $1 AND NOT hr_private
	UNION ALL SELECT 'receipts/' || id || '-' || name, object_key FROM expense_receipts WHERE workspace_id = $1
	UNION ALL SELECT 'invoices/' || coalesce(number, id) || '.pdf', pdf_key FROM invoices WHERE workspace_id = $1 AND pdf_key IS NOT NULL
	UNION ALL SELECT 'e-invoices/' || x.invoice_id || '-' || x.filename, x.object_key FROM invoice_xml_exports x
		JOIN invoices i ON i.id = x.invoice_id WHERE i.workspace_id = $1
	UNION ALL SELECT 'quotes/' || coalesce(number, id) || '.pdf', pdf_key FROM quotes WHERE workspace_id = $1 AND pdf_key IS NOT NULL
	UNION ALL SELECT 'quotes/' || coalesce(t.number, t.id) || '-r' || r.revision || '.pdf', r.pdf_key FROM quote_revisions r
		JOIN quotes t ON t.id = r.quote_id WHERE r.workspace_id = $1 AND r.pdf_key IS NOT NULL
	UNION ALL SELECT 'signatures/' || id || '-original.pdf', original_key FROM signature_requests WHERE workspace_id = $1
	UNION ALL SELECT 'invoice-settings/logo', 'workspaces/' || workspace_id || '/invoice-settings/' || (settings->>'logo_file_id')
		FROM invoice_settings WHERE workspace_id = $1 AND settings->>'logo_file_id' IS NOT NULL
	UNION ALL SELECT 'workspace/logo', 'workspaces/' || id || '/workspace-logo/' || logo_file_id
		FROM workspaces WHERE id = $1 AND logo_file_id IS NOT NULL
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
	query := ""
	if files {
		query = exportFiles
	}
	return s.export(ctx, id, tables, w, query)
}

// ExportHR writes HRExportTables and lists the employees' documents, in one snapshot.
func (s *Store) ExportHR(ctx context.Context, workspaceID string, w ExportWriter) ([]ExportFile, error) {
	return s.export(ctx, workspaceID, HRExportTables, w, hrExportFiles)
}

// HasHRData reports whether the workspace keeps any employee, for an export after the module left the plan.
func (q Q) HasHRData(ctx context.Context, workspaceID string) (bool, error) {
	var ok bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM employees WHERE workspace_id = $1)`, workspaceID).Scan(&ok)
	return ok, err
}

func (s *Store) export(ctx context.Context, id string, tables []ExportTable, w ExportWriter, filesQuery string) ([]ExportFile, error) {
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
	if filesQuery == "" {
		return nil, nil
	}
	rows, err := tx.Query(ctx, filesQuery, id)
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
	"api_request_windows":      "API request counts of the last two minutes, a rate limit's state",
	"email_codes":              "sign-in secret (code hashes), minutes long",
	"passkey_challenges":       "sign-in secret, minutes long",
	"transmission_credentials": "sealed e-invoice channel credentials",
	"heidi_confirmations":      "pending confirmations of Heidi actions, minutes long; the conversation is in heidi_messages",
	"digest_days":              "job bookkeeping: the days the engagements digest was sent",
	"workspace_deletions":      "the operator's record of a deletion and its archive; a live workspace has none to export",
	"name_suggestion_uses":     "abuse-cap bookkeeping of one person (ids and times only, kept a week); the suggestion itself is in workspace_name_suggestions",
	"invoice_xml_retention":    "history: the old, unverified mark of an archived XML's object lock",
	"object_retention":         "storage protection state of the workspace's objects, not business data",
	"object_versions":          "storage version ids of objects, not business data",
	"portal_slugs":             "routing: the workspace's portal addresses (shown in its settings), not business data",
	"workspace_domains":        "routing: the workspace's own portal domain and its Cloudflare status (shown in its settings), not business data",
	"stored_objects":           "storage accounting: the bytes each object counts, not business data",
	"limits":                   "global plan configuration, not workspace data",
	"limit_plans":              "global plan configuration, not workspace data",
	"limit_workspaces":         "an operator's plan limit for the workspace, not business data",
	"offer_versions":           "global published offers, not workspace data",
	"offer_audit":              "operators' audit of offer and limit changes, not business data",
	"stripe_events":            "global webhook idempotency log, not workspace data",
	"billing_checkouts":        "what a plan Checkout was opened for, to settle its subscription; not business data",
	"trial_claims":             "digests that recognise a customer's one trial, kept across workspaces for 24 months; not business data",
	"usage_events":             "what the workspace used of its plan's monthly limits, not business data",
	"calendar_connections":     "a member's sealed calendar tokens and account, not business data",
	"calendar_sources":         "sync state of a member's own calendars",
	"calendar_watches":         "push channel secrets of a member's calendars",
	"calendar_busy":            "third-party busy times of a member's own calendar, purged when past",
	"calendar_event_links":     "sync state: the external event each session was pushed as",
	"calendar_push_queue":      "sync job bookkeeping: pushes still to make",
	"calendar_feeds":           "a member's iCal feed secret (token hash and sealed token)",
	"document_zip_exports":     "a member's download of files the export carries anyway, deleted 7 days after it is ready",
	"portal_preview_links":     "one-use secrets of a member's portal preview, gone 5 minutes after they are made",
}
