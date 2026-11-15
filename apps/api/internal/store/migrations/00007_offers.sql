-- Offer v2 (stage A): versioned offers on the limits of 00005.
-- limits become the definitions of every feature and limit this binary knows (kind, unit, scope, period, the features
-- a limit requires, whether it may be unlimited); a published offer must give each of them a value on every plan.
-- offer_versions keeps each published offer's document (prices, records, trial, public pricing) under its checksum;
-- limit_plans holds its values by offer: a feature enabled or disabled, a limit limited (0 grants none) or unlimited,
-- growing by per_additional_paid_seat for every paid seat after the first. Both never change once published (a
-- correction is a new version). limit_workspaces gives one workspace its own value on its offer until expires_at,
-- with the reason. workspace_billing.offer_id is the offer a workspace is on; offer_audit records every operator's
-- change, before and after. The approved offer helvetly-2026-11-v2 is published here and every workspace put on it:
-- no customer holds the earlier limits, and its earlier values (Down) are restored only for a rollback.

-- +goose Up
CREATE TABLE offer_versions (
    id             text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
    schema_version integer NOT NULL,
    checksum       text NOT NULL,
    document       jsonb NOT NULL,
    published_at   timestamp with time zone NOT NULL
);

-- +goose StatementBegin
CREATE FUNCTION offers_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION '% of a published offer is immutable: publish a new version', TG_TABLE_NAME;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION limit_plans_published_now() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Values join an offer only in the transaction that publishes it.
    IF NOT EXISTS (SELECT 1 FROM offer_versions WHERE id = NEW.offer_id AND published_at = now()) THEN
        RAISE EXCEPTION 'limit_plans of a published offer are immutable: publish a new version';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION offer_audit_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'offer_audit is append-only';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER offer_versions_immutable BEFORE UPDATE OR DELETE ON offer_versions FOR EACH ROW EXECUTE FUNCTION offers_immutable();
CREATE TRIGGER offer_versions_no_truncate BEFORE TRUNCATE ON offer_versions FOR EACH STATEMENT EXECUTE FUNCTION offers_immutable();

INSERT INTO offer_versions (id, schema_version, checksum, published_at, document) VALUES
('helvetly-2026-11-v2', 1, '011183b1d4f288ef7cb68b77baab9b396e0ba499447dfc00e82ac8dc4c1ce2fb', now(), '
{
  "schema_version": 1,
  "offer_id": "helvetly-2026-11-v2",
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
    {"key": "ai_import", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "enabled"}, "business": {"state": "enabled"}, "pro": {"state": "enabled"}}},
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
    {"key": "clients", "type": "resource_state", "unit": "client", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 30}, "business": {"state": "limited", "value": 1500}, "pro": {"state": "limited", "value": 300}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "products", "type": "resource_state", "unit": "catalog_item", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 25}, "business": {"state": "limited", "value": 1000}, "pro": {"state": "limited", "value": 250}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "automation_actions_per_month", "type": "period_counter", "unit": "automation_action", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 0}, "business": {"state": "limited", "value": 6000}, "pro": {"state": "limited", "value": 1500}}, "per_additional_paid_seat": {"basic": 0, "business": 6000, "pro": 1500}, "requires_features": ["automations"]},
    {"key": "invoices_per_month", "type": "period_counter", "unit": "issued_document", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 15}, "business": {"state": "limited", "value": 600}, "pro": {"state": "limited", "value": 150}}, "per_additional_paid_seat": {"basic": 15, "business": 600, "pro": 150}},
    {"key": "expenses_per_month", "type": "period_counter", "unit": "expense", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 0}, "business": {"state": "limited", "value": 1200}, "pro": {"state": "limited", "value": 300}}, "per_additional_paid_seat": {"basic": 0, "business": 1200, "pro": 300}, "requires_features": ["expenses"]},
    {"key": "invoice_drafts", "type": "resource_state", "unit": "draft", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 100}, "business": {"state": "limited", "value": 5000}, "pro": {"state": "limited", "value": 1000}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "quotes_retained", "type": "resource_state", "unit": "quote", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 500}, "business": {"state": "limited", "value": 25000}, "pro": {"state": "limited", "value": 5000}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "engagements", "type": "resource_state", "unit": "engagement", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 3}, "business": {"state": "limited", "value": 100}, "pro": {"state": "limited", "value": 20}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}},
    {"key": "signatures_per_month", "type": "period_counter", "unit": "signature_envelope", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 0}, "business": {"state": "limited", "value": 200}, "pro": {"state": "limited", "value": 50}}, "per_additional_paid_seat": {"basic": 0, "business": 200, "pro": 50}, "requires_features": ["simple_signatures"]},
    {"key": "storage_bytes", "type": "resource_state", "unit": "byte", "scope": "workspace", "period": null, "values": {"basic": {"state": "limited", "value": 500000000}, "business": {"state": "limited", "value": 20000000000}, "pro": {"state": "limited", "value": 5000000000}}, "per_additional_paid_seat": {"basic": 500000000, "business": 20000000000, "pro": 5000000000}},
    {"key": "download_bytes_per_month", "type": "period_counter", "unit": "byte", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 2000000000}, "business": {"state": "limited", "value": 100000000000}, "pro": {"state": "limited", "value": 20000000000}}, "per_additional_paid_seat": {"basic": 2000000000, "business": 100000000000, "pro": 20000000000}},
    {"key": "emails_per_month", "type": "period_counter", "unit": "recipient_message", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 100}, "business": {"state": "limited", "value": 5000}, "pro": {"state": "limited", "value": 1000}}, "per_additional_paid_seat": {"basic": 100, "business": 5000, "pro": 1000}},
    {"key": "ai_tokens_per_month", "type": "period_counter", "unit": "token", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 250000}, "business": {"state": "limited", "value": 20000000}, "pro": {"state": "limited", "value": 5000000}}, "per_additional_paid_seat": {"basic": 250000, "business": 20000000, "pro": 5000000}},
    {"key": "ai_cost_usd_micros", "type": "cost_budget", "unit": "USD_micro", "scope": "workspace", "period": "calendar_month_utc", "values": {"basic": {"state": "limited", "value": 200000}, "business": {"state": "limited", "value": 12000000}, "pro": {"state": "limited", "value": 3000000}}, "per_additional_paid_seat": {"basic": 200000, "business": 12000000, "pro": 3000000}},
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
    {"key": "api_read_requests_per_minute", "type": "technical_guard", "unit": "request", "scope": "workspace", "period": "rolling_minute", "values": {"basic": {"state": "limited", "value": 300}, "business": {"state": "limited", "value": 300}, "pro": {"state": "limited", "value": 300}}, "per_additional_paid_seat": {"basic": 0, "business": 0, "pro": 0}}
  ],
  "usage_policy": {"pooled_by_paid_seat_keys": ["invoices_per_month", "expenses_per_month", "signatures_per_month", "storage_bytes", "download_bytes_per_month", "emails_per_month", "ai_cost_usd_micros", "email_attachment_bytes_per_month", "automation_actions_per_month", "ai_tokens_per_month"]},
  "trial": {"days": 7, "access_plan": "business", "seats": 2, "overrides": {"ai_cost_usd_micros": 200000, "ai_tokens_per_month": 250000, "automation_actions_per_month": 50, "clients": 100, "download_bytes_per_month": 1000000000, "email_attachment_bytes_per_month": 100000000, "emails_per_month": 30, "engagements": 3, "expenses_per_month": 20, "invoice_drafts": 50, "invoices_per_month": 10, "products": 100, "quotes_retained": 50, "signatures_per_month": 2, "storage_bytes": 100000000}},
  "public_pricing": {
    "comparison_rows": [
      {"key": "invoicing", "label_en": "Invoices and quotes", "feature_keys": ["invoice_documents", "quotes"], "limit_keys": ["invoices_per_month"]},
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
      {"key": "ledger_exports", "label_en": "Ledger and data exports", "note_en": "Accounting reports and supported exports, including client and product CSV exports. Individual invoice PDFs remain available in Basic; e-invoice XML requires Business.", "feature_keys": ["ledger_exports", "data_export"], "limit_keys": []}
    ],
    "usage_details_keys": ["clients", "products", "invoices_per_month", "expenses_per_month", "signatures_per_month", "storage_bytes", "download_bytes_per_month", "emails_per_month", "email_attachment_bytes_per_month", "ai_tokens_per_month", "automation_actions_per_month"],
    "internal_only_keys": ["identity_security", "workspace_roles", "period_closing_audit", "api_access", "notifications", "ai_cost_usd_micros"]
  }
}
');

-- Definitions: the offer's records, in its order; keys it does not have (members) go with their workspace values.
DELETE FROM limit_plans;
DELETE FROM limits WHERE key NOT IN (
    SELECT r->>'key' FROM offer_versions, jsonb_array_elements(document->'records') r WHERE id = 'helvetly-2026-11-v2');
ALTER TABLE limits
    DROP COLUMN value,
    ADD COLUMN kind text,
    ADD COLUMN unit text,
    ADD COLUMN scope text,
    ADD COLUMN period text,
    ADD COLUMN requires_features text[] NOT NULL DEFAULT '{}',
    ADD COLUMN allow_unlimited boolean NOT NULL DEFAULT true,
    ADD COLUMN position integer;
INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position)
SELECT r->>'key', r->>'type', r->>'unit', r->>'scope', r->>'period',
    ARRAY(SELECT jsonb_array_elements_text(r->'requires_features')),
    r->>'key' NOT IN ('ai_cost_usd_micros', 'ai_tokens_per_month', 'storage_bytes', 'download_bytes_per_month', 'emails_per_month',
        'email_attachment_bytes_per_month'), t.n
FROM offer_versions, jsonb_array_elements(document->'records') WITH ORDINALITY AS t (r, n)
WHERE id = 'helvetly-2026-11-v2'
ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, unit = EXCLUDED.unit, scope = EXCLUDED.scope,
    period = EXCLUDED.period, requires_features = EXCLUDED.requires_features, allow_unlimited = EXCLUDED.allow_unlimited,
    position = EXCLUDED.position, updated_at = now();
ALTER TABLE limits
    ALTER COLUMN kind SET NOT NULL,
    ALTER COLUMN unit SET NOT NULL,
    ALTER COLUMN scope SET NOT NULL,
    ALTER COLUMN position SET NOT NULL,
    ADD CONSTRAINT limits_kind_check
        CHECK (kind IN ('access', 'resource_state', 'period_counter', 'cost_budget', 'technical_guard')),
    ADD CONSTRAINT limits_access_check CHECK (kind <> 'access' OR period IS NULL);

ALTER TABLE limit_plans
    DROP CONSTRAINT limit_plans_pkey,
    DROP CONSTRAINT limit_plans_value_check,
    DROP COLUMN updated_at,
    ADD COLUMN offer_id text NOT NULL REFERENCES offer_versions (id),
    ADD COLUMN state text NOT NULL,
    ALTER COLUMN value DROP NOT NULL,
    ADD COLUMN per_additional_paid_seat bigint NOT NULL DEFAULT 0 CHECK (per_additional_paid_seat >= 0),
    ADD PRIMARY KEY (offer_id, plan_id, limit_key),
    ADD CONSTRAINT limit_plans_state_check CHECK (
        (state IN ('enabled', 'disabled') AND value IS NULL AND per_additional_paid_seat = 0)
        OR (state = 'limited' AND value >= 0)
        OR (state = 'unlimited' AND value IS NULL AND per_additional_paid_seat = 0));
CREATE TRIGGER limit_plans_published_now BEFORE INSERT ON limit_plans FOR EACH ROW EXECUTE FUNCTION limit_plans_published_now();
CREATE TRIGGER limit_plans_immutable BEFORE UPDATE OR DELETE ON limit_plans FOR EACH ROW EXECUTE FUNCTION offers_immutable();
CREATE TRIGGER limit_plans_no_truncate BEFORE TRUNCATE ON limit_plans FOR EACH STATEMENT EXECUTE FUNCTION offers_immutable();
INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT id, p.plan, r->>'key', p.v->>'state', (p.v->>'value')::bigint,
    coalesce((r->'per_additional_paid_seat'->>p.plan)::bigint, 0)
FROM offer_versions, jsonb_array_elements(document->'records') r, jsonb_each(r->'values') AS p (plan, v)
WHERE id = 'helvetly-2026-11-v2';

-- A workspace's own values move to the offer, -1 as unlimited and a feature's 1 or 0 as enabled or disabled.
ALTER TABLE limit_workspaces
    DROP CONSTRAINT limit_workspaces_pkey,
    DROP CONSTRAINT limit_workspaces_value_check,
    ADD COLUMN offer_id text REFERENCES offer_versions (id),
    ADD COLUMN state text,
    ALTER COLUMN value DROP NOT NULL,
    ADD COLUMN expires_at timestamp with time zone,
    ADD COLUMN set_by text NOT NULL DEFAULT '';
ALTER TABLE limit_workspaces RENAME COLUMN note TO reason;
UPDATE limit_workspaces w SET offer_id = 'helvetly-2026-11-v2', set_by = 'migration 00007',
    reason = CASE WHEN btrim(reason) = '' THEN 'set before offer v2' ELSE reason END,
    state = CASE WHEN l.kind = 'access' THEN CASE WHEN w.value = 0 THEN 'disabled' ELSE 'enabled' END
        WHEN w.value = -1 THEN 'unlimited' ELSE 'limited' END,
    value = CASE WHEN l.kind = 'access' OR w.value = -1 THEN NULL ELSE w.value END
FROM limits l WHERE l.key = w.limit_key;
ALTER TABLE limit_workspaces
    ALTER COLUMN offer_id SET NOT NULL,
    ALTER COLUMN state SET NOT NULL,
    ALTER COLUMN reason DROP DEFAULT,
    ADD PRIMARY KEY (workspace_id, offer_id, limit_key),
    ADD CONSTRAINT limit_workspaces_reason_check CHECK (btrim(reason) <> ''),
    ADD CONSTRAINT limit_workspaces_state_check CHECK (
        (state IN ('enabled', 'disabled', 'unlimited') AND value IS NULL) OR (state = 'limited' AND value >= 0));

ALTER TABLE workspace_billing ADD COLUMN offer_id text REFERENCES offer_versions (id);
UPDATE workspace_billing SET offer_id = 'helvetly-2026-11-v2';

CREATE TABLE offer_audit (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor      text NOT NULL CHECK (btrim(actor) <> ''),
    action     text NOT NULL,
    target     text NOT NULL,
    before     jsonb,
    after      jsonb,
    reason     text NOT NULL CHECK (btrim(reason) <> ''),
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TRIGGER offer_audit_append_only BEFORE UPDATE OR DELETE ON offer_audit FOR EACH ROW EXECUTE FUNCTION offer_audit_append_only();
CREATE TRIGGER offer_audit_no_truncate BEFORE TRUNCATE ON offer_audit FOR EACH STATEMENT EXECUTE FUNCTION offer_audit_append_only();
INSERT INTO offer_audit (actor, action, target, after, reason)
SELECT 'migration 00007', 'offer.publish', id, jsonb_build_object('offer_id', id, 'checksum', checksum),
    'Offer v2 approved by the owner on 2026-11-15'
FROM offer_versions WHERE id = 'helvetly-2026-11-v2';

-- +goose Down
CREATE TEMPORARY TABLE kept_limits ON COMMIT DROP AS
SELECT w.workspace_id, w.limit_key,
    CASE w.state WHEN 'enabled' THEN 1 WHEN 'disabled' THEN 0 WHEN 'unlimited' THEN -1 ELSE w.value END AS value, w.reason
FROM limit_workspaces w JOIN workspace_billing b ON b.workspace_id = w.workspace_id AND b.offer_id = w.offer_id
WHERE w.limit_key IN ('clients', 'invoices_per_month', 'expenses_per_month', 'products', 'engagements',
    'signatures_per_month', 'storage_bytes', 'ai_tokens_per_month', 'api_access');
DROP TABLE offer_audit, limit_workspaces, limit_plans, limits;
ALTER TABLE workspace_billing DROP COLUMN offer_id;
DROP TABLE offer_versions;
DROP FUNCTION offer_audit_append_only(), limit_plans_published_now(), offers_immutable();

CREATE TABLE limits (
    key         text PRIMARY KEY,
    value       bigint NOT NULL CHECK (value >= -1),
    description text NOT NULL DEFAULT '',
    updated_at  timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE limit_plans (
    limit_key  text NOT NULL REFERENCES limits (key) ON DELETE CASCADE,
    plan_id    text NOT NULL CHECK (plan_id = ANY (ARRAY['basic'::text, 'pro'::text, 'business'::text])),
    value      bigint NOT NULL CHECK (value >= -1),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (limit_key, plan_id)
);
CREATE TABLE limit_workspaces (
    limit_key    text NOT NULL REFERENCES limits (key) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    value        bigint NOT NULL CHECK (value >= -1),
    note         text NOT NULL DEFAULT '',
    updated_at   timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, limit_key)
);
INSERT INTO limits (key, value, description) VALUES
    ('members', 2, 'Members besides the owner on the earlier flat prices (per-seat subscriptions have no cap)'),
    ('clients', 50, 'Clients not deleted'),
    ('invoices_per_month', 30, 'Invoices (not credit notes) created per calendar month'),
    ('expenses_per_month', 60, 'Expenses created per calendar month'),
    ('products', 25, 'Catalogue entries not deleted (archived ones too)'),
    ('engagements', 3, 'Engagements not cancelled and not ended'),
    ('signatures_per_month', 5, 'Signature requests sent per calendar month'),
    ('storage_bytes', 5368709120, 'Documents and expense receipts, in bytes'),
    ('ai_tokens_per_month', 1000000, 'Model tokens Heidi and the AI import use per calendar month'),
    ('api_access', 0, 'Creating personal API tokens (1 on, 0 off)');
INSERT INTO limit_plans (limit_key, plan_id, value) VALUES
    ('members', 'pro', 10), ('clients', 'pro', 1000), ('invoices_per_month', 'pro', 300),
    ('expenses_per_month', 'pro', 600), ('products', 'pro', 500), ('engagements', 'pro', 50), ('signatures_per_month', 'pro', 50),
    ('storage_bytes', 'pro', 107374182400), ('ai_tokens_per_month', 'pro', 5000000), ('api_access', 'pro', 1),
    ('members', 'business', -1), ('clients', 'business', -1), ('invoices_per_month', 'business', -1),
    ('expenses_per_month', 'business', -1), ('products', 'business', -1), ('engagements', 'business', -1),
    ('signatures_per_month', 'business', -1), ('storage_bytes', 'business', 1099511627776),
    ('ai_tokens_per_month', 'business', 20000000), ('api_access', 'business', 1);
INSERT INTO limit_workspaces (limit_key, workspace_id, value, note)
SELECT limit_key, workspace_id, value, reason FROM kept_limits;
