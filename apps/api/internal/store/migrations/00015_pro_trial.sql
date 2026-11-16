-- Offer helvetly: the same terms as helvetly-v2 (00014), except that the 7-day trial gives Pro, not Business.
-- A published offer never changes, so it is published next to v2 and becomes the one on sale: every new Checkout is sold
-- on it (billing.newCheckout reads the current offer's trial), so only Pro starts a trial. Nothing else moves: workspaces,
-- their limits and usage, trials already started (their rights come from the offer they were sold on), paid
-- subscriptions, Checkouts in flight and the trial claims stay as they are. Down removes the offer when nothing refers to it.

-- +goose Up
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document) VALUES
('helvetly', 1, '03d8515144ffa74ca7d3ea89fe55af499efe578f7f5c0d190b76834deb47cb7f', now(), '
{
  "schema_version": 1,
  "offer_id": "helvetly",
  "billing": {"currencies": ["CHF", "EUR", "USD"], "plans": {"basic": {"month_minor": 1900, "year_minor": 18300}, "business": {"month_minor": 9900, "year_minor": 95100}, "pro": {"month_minor": 4900, "year_minor": 47100}}},
  "records": [
    {"key": "identity_security", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "workspace_roles", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "clients_contacts", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "products_catalog", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "quotes", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "invoice_documents", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "invoice_corrections", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "swiss_qr", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "revolut_payment_link", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "invoice_payments", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "invoice_delivery", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "automations", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "invoice_reminders", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}, "requires_features": ["automations"]},
    {"key": "invoice_instalments", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}, "requires_features": ["automations"]},
    {"key": "einvoice_xml", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "disabled"}}},
    {"key": "expenses", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "engagement_management", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "engagement_automation", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}, "requires_features": ["automations"]},
    {"key": "document_library", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "document_templates", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "simple_signatures", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "recipient_document_access", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "ai_import", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "dashboard_reports", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "vat_returns", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "ledger_exports", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "period_closing_audit", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "data_export", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "api_access", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "notifications", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "heidi", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
    {"key": "client_portal", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "disabled"}}},
    {"key": "qualified_signatures", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "disabled"}, "pro": {"state": "disabled"}}},
    {"key": "einvoice_network_delivery", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "disabled"}, "pro": {"state": "disabled"}}},
    {"key": "bank_sync", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "disabled"}, "pro": {"state": "disabled"}}},
    {"key": "payroll_inventory", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "disabled"}, "pro": {"state": "disabled"}}},
    {"key": "receivables_card_checkout", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "disabled"}, "pro": {"state": "disabled"}}},
    {"key": "seats", "type": "resource_state", "unit": "seat", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 1}, "business": {"state": "limited", "value": 1}, "pro": {"state": "limited", "value": 1}}, "per_additional_paid_seat": {"basic": 1, "business": 1, "pro": 1}},
    {"key": "clients", "type": "resource_state", "unit": "client", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 30}, "business": {"state": "unlimited"}, "pro": {"state": "limited", "value": 300}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "products", "type": "resource_state", "unit": "catalog_item", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 25}, "business": {"state": "unlimited"}, "pro": {"state": "limited", "value": 250}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "automation_actions_per_month", "type": "period_counter", "unit": "automation_action", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 0}, "business": {"state": "limited", "value": 6000}, "pro": {"state": "limited", "value": 1500}}, "per_additional_paid_seat": {"basic": 0, "business": 6000, "pro": 1500}, "requires_features": ["automations"]},
    {"key": "invoices_per_month", "type": "period_counter", "unit": "issued_document", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 15}, "business": {"state": "unlimited"}, "pro": {"state": "limited", "value": 100}}, "per_additional_paid_seat": {"basic": 15, "business": 0, "pro": 100}},
    {"key": "quotes_per_month", "type": "period_counter", "unit": "issued_quote", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 5}, "business": {"state": "unlimited"}, "pro": {"state": "limited", "value": 100}}, "per_additional_paid_seat": {"basic": 5, "business": 0, "pro": 100}},
    {"key": "expenses_per_month", "type": "period_counter", "unit": "expense", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 0}, "business": {"state": "unlimited"}, "pro": {"state": "limited", "value": 300}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 300}, "requires_features": ["expenses"]},
    {"key": "invoice_drafts", "type": "resource_state", "unit": "draft", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 100}, "business": {"state": "limited", "value": 5000}, "pro": {"state": "limited", "value": 1000}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "quotes_retained", "type": "resource_state", "unit": "quote", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 500}, "business": {"state": "limited", "value": 25000}, "pro": {"state": "limited", "value": 5000}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "engagements", "type": "resource_state", "unit": "engagement", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 3}, "business": {"state": "unlimited"}, "pro": {"state": "limited", "value": 20}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "signatures_per_month", "type": "period_counter", "unit": "signature_envelope", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 0}, "business": {"state": "unlimited"}, "pro": {"state": "limited", "value": 50}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 50}, "requires_features": ["simple_signatures"]},
    {"key": "storage_bytes", "type": "resource_state", "unit": "byte", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 500000000}, "business": {"state": "limited", "value": 20000000000}, "pro": {"state": "limited", "value": 5000000000}}, "per_additional_paid_seat": {"basic": 500000000, "business": 20000000000, "pro": 5000000000}},
    {"key": "download_bytes_per_month", "type": "period_counter", "unit": "byte", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 2000000000}, "business": {"state": "limited", "value": 100000000000}, "pro": {"state": "limited", "value": 20000000000}}, "per_additional_paid_seat": {"basic": 2000000000, "business": 100000000000, "pro": 20000000000}},
    {"key": "emails_per_month", "type": "period_counter", "unit": "recipient_message", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 100}, "business": {"state": "limited", "value": 5000}, "pro": {"state": "limited", "value": 1000}}, "per_additional_paid_seat": {"basic": 100, "business": 5000, "pro": 1000}},
    {"key": "ai_tokens_per_month", "type": "period_counter", "unit": "token", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 0}, "business": {"state": "limited", "value": 20000000}, "pro": {"state": "limited", "value": 5000000}}, "per_additional_paid_seat": {"basic": 0, "business": 20000000, "pro": 5000000}, "requires_features": ["ai_import"]},
    {"key": "ai_cost_usd_micros", "type": "cost_budget", "unit": "USD_micro", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 0}, "business": {"state": "limited", "value": 12000000}, "pro": {"state": "limited", "value": 3000000}}, "per_additional_paid_seat": {"basic": 0, "business": 12000000, "pro": 3000000}},
    {"key": "max_upload_bytes", "type": "technical_guard", "unit": "byte", "scope": "file", "period": null, "values": {"basic": {"state": "limited", "value": 26214400}, "business": {"state": "limited", "value": 26214400}, "pro": {"state": "limited", "value": 26214400}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "max_ai_attachment_bytes", "type": "technical_guard", "unit": "byte", "scope": "file", "period": null, "values": {"basic": {"state": "limited", "value": 8388608}, "business": {"state": "limited", "value": 8388608}, "pro": {"state": "limited", "value": 8388608}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "max_signature_signers", "type": "technical_guard", "unit": "signer", "scope": "signature_envelope", "period": null, "values": {"basic": {"state": "limited", "value": 10}, "business": {"state": "limited", "value": 10}, "pro": {"state": "limited", "value": 10}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "ai_concurrency", "type": "technical_guard", "unit": "call", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 1}, "business": {"state": "limited", "value": 1}, "pro": {"state": "limited", "value": 1}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "ai_import_call_max_usd_micros", "type": "technical_guard", "unit": "USD_micro", "scope": "provider_call", "period": null, "values": {"basic": {"state": "limited", "value": 50000}, "business": {"state": "limited", "value": 50000}, "pro": {"state": "limited", "value": 50000}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "ai_heidi_operation_max_usd_micros", "type": "technical_guard", "unit": "USD_micro", "scope": "operation", "period": null, "values": {"basic": {"state": "limited", "value": 250000}, "business": {"state": "limited", "value": 250000}, "pro": {"state": "limited", "value": 250000}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "ai_input_tokens_max", "type": "technical_guard", "unit": "input_token", "scope": "provider_call", "period": null, "values": {"basic": {"state": "limited", "value": 100000}, "business": {"state": "limited", "value": 100000}, "pro": {"state": "limited", "value": 100000}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "max_self_service_seats", "type": "technical_guard", "unit": "seat", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 25}, "business": {"state": "limited", "value": 25}, "pro": {"state": "limited", "value": 25}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "email_attachment_bytes_per_month", "type": "period_counter", "unit": "byte", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 100000000}, "business": {"state": "limited", "value": 5000000000}, "pro": {"state": "limited", "value": 1000000000}}, "per_additional_paid_seat": {"basic": 100000000, "business": 5000000000, "pro": 1000000000}},
    {"key": "max_email_attachment_bytes", "type": "technical_guard", "unit": "byte", "scope": "message_recipient", "period": null, "values": {"basic": {"state": "limited", "value": 10485760}, "business": {"state": "limited", "value": 10485760}, "pro": {"state": "limited", "value": 10485760}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "ai_import_file_max_usd_micros", "type": "technical_guard", "unit": "USD_micro", "scope": "import_file", "period": null, "values": {"basic": {"state": "limited", "value": 250000}, "business": {"state": "limited", "value": 250000}, "pro": {"state": "limited", "value": 250000}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "ai_import_batch_max_usd_micros", "type": "technical_guard", "unit": "USD_micro", "scope": "import_batch", "period": null, "values": {"basic": {"state": "limited", "value": 1000000}, "business": {"state": "limited", "value": 1000000}, "pro": {"state": "limited", "value": 1000000}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "api_write_requests_per_minute", "type": "technical_guard", "unit": "request", "scope": "workspace", "period": "rolling_minute", "values": {"basic": {"state": "limited", "value": 60}, "business": {"state": "limited", "value": 60}, "pro": {"state": "limited", "value": 60}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "api_read_requests_per_minute", "type": "technical_guard", "unit": "request", "scope": "workspace", "period": "rolling_minute", "values": {"basic": {"state": "limited", "value": 300}, "business": {"state": "limited", "value": 300}, "pro": {"state": "limited", "value": 300}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "employees", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "disabled"}}}
  ],
  "usage_policy": {"pooled_by_paid_seat_keys": ["invoices_per_month", "quotes_per_month", "expenses_per_month", "signatures_per_month", "storage_bytes", "download_bytes_per_month", "emails_per_month", "ai_cost_usd_micros", "email_attachment_bytes_per_month", "automation_actions_per_month", "ai_tokens_per_month"]},
  "trial": {"days": 7, "access_plan": "pro", "seats": 2, "overrides": {"ai_cost_usd_micros": 200000, "ai_tokens_per_month": 250000, "automation_actions_per_month": 50, "clients": 100, "download_bytes_per_month": 1000000000, "email_attachment_bytes_per_month": 100000000, "emails_per_month": 30, "engagements": 3, "expenses_per_month": 20, "invoice_drafts": 50, "invoices_per_month": 10, "products": 100, "quotes_per_month": 10, "quotes_retained": 50, "signatures_per_month": 2, "storage_bytes": 100000000}},
  "public_pricing": {
    "comparison_rows": [
      {"key": "invoicing", "label_en": "Invoices and quotes", "feature_keys": ["invoice_documents", "quotes"], "limit_keys": ["invoices_per_month", "quotes_per_month"]},
      {"key": "swiss_qr", "label_en": "Swiss QR bills", "feature_keys": ["swiss_qr"], "limit_keys": []},
      {"key": "revolut", "label_en": "Revolut payment link", "note_en": "revolut.me link and QR; the payer enters the displayed amount and reference. No bank sync or automatic payment confirmation.", "feature_keys": ["revolut_payment_link"], "limit_keys": []},
      {"key": "engagements", "label_en": "Engagements and retainers", "note_en": "Manual engagement management in every plan; scheduled workflows require Pro or Business.", "feature_keys": ["engagement_management"], "limit_keys": ["engagements"]},
      {"key": "automations", "label_en": "Automations and payment reminders", "feature_keys": ["automations"], "limit_keys": ["automation_actions_per_month"]},
      {"key": "heidi", "label_en": "Heidi AI assistant", "feature_keys": ["heidi"], "limit_keys": ["ai_tokens_per_month"]},
      {"key": "client_portal", "label_en": "Client portal", "feature_keys": ["client_portal"], "limit_keys": []},
      {"key": "expenses", "label_en": "Expenses and AI receipt import", "feature_keys": ["expenses", "ai_import"], "limit_keys": ["expenses_per_month"]},
      {"key": "documents_signatures", "label_en": "Document templates and simple signatures", "feature_keys": ["document_templates", "simple_signatures"], "limit_keys": ["signatures_per_month"]},
      {"key": "corrections_vat", "label_en": "Invoice corrections and VAT returns", "feature_keys": ["invoice_corrections", "vat_returns"], "limit_keys": []},
      {"key": "einvoice_xml", "label_en": "E-invoice XML export", "note_en": "Supported file formats only; no network delivery.", "feature_keys": ["einvoice_xml"], "limit_keys": []},
      {"key": "ledger_exports", "label_en": "Ledger and data exports", "note_en": "Accounting reports and supported exports, including client and product CSV exports. Individual invoice PDFs remain available in Basic; e-invoice XML requires Business.", "feature_keys": ["ledger_exports", "data_export"], "limit_keys": []},
      {"key": "employees", "label_en": "Employees and payroll register", "note_en": "Staff records, employee documents and a payroll register you fill in or import. No payroll calculation, payslips or filings.", "feature_keys": ["employees"], "limit_keys": []}
    ],
    "usage_details_keys": ["clients", "products", "invoices_per_month", "quotes_per_month", "expenses_per_month", "signatures_per_month", "storage_bytes", "download_bytes_per_month", "emails_per_month", "email_attachment_bytes_per_month", "ai_tokens_per_month", "automation_actions_per_month"],
    "internal_only_keys": ["identity_security", "workspace_roles", "period_closing_audit", "api_access", "notifications", "ai_cost_usd_micros"]
  }
}
');

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT id, p.plan, r->>'key', p.v->>'state', (p.v->>'value')::bigint,
    coalesce((r->'per_additional_paid_seat'->>p.plan)::bigint, 0)
FROM offer_versions, jsonb_array_elements(document->'records') r, jsonb_each(r->'values') AS p (plan, v)
WHERE id = 'helvetly';

INSERT INTO offer_audit (actor, action, target, before, after, reason)
SELECT 'migration 00015', 'offer.publish', id,
    jsonb_build_object('offer_id', 'helvetly-v2', 'checksum', (SELECT checksum FROM offer_versions WHERE id = 'helvetly-v2')),
    jsonb_build_object('offer_id', id, 'checksum', checksum),
    'Owner decision 2026-11-16: the 7-day free trial is for Pro only'
FROM offer_versions WHERE id = 'helvetly';

-- +goose Down
-- Refuses once the offer was used: a workspace pinned to it, a Checkout saved on it or an override written for it
-- would otherwise be moved to another offer's terms (a started Pro trial would read the Business access plan).
-- Nothing is reassigned or deleted then; the unused offer and its plans are removed only when nothing refers to it.
-- +goose StatementBegin
DO $$
DECLARE used text;
BEGIN
    SELECT concat_ws(', ',
        CASE WHEN EXISTS (SELECT 1 FROM workspace_billing WHERE offer_id = 'helvetly') THEN 'workspace_billing' END,
        CASE WHEN EXISTS (SELECT 1 FROM billing_checkouts WHERE offer_id = 'helvetly') THEN 'billing_checkouts' END,
        CASE WHEN EXISTS (SELECT 1 FROM limit_workspaces WHERE offer_id = 'helvetly') THEN 'limit_workspaces' END)
    INTO used;
    IF used <> '' THEN
        RAISE EXCEPTION 'cannot roll back 00015: offer helvetly is still referenced by %', used;
    END IF;
END $$;
-- +goose StatementEnd
-- A published offer is immutable (00007): only a rollback removes one.
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
DELETE FROM limit_plans WHERE offer_id = 'helvetly';
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
DELETE FROM offer_versions WHERE id = 'helvetly';
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;
