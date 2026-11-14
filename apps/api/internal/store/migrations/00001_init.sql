-- The schema as of the first public release: the earlier migrations squashed into one.

-- +goose Up
-- +goose StatementBegin
CREATE FUNCTION financial_events_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Deleting a whole workspace sets helvetly.purge for its transaction; nothing else may change the trail.
    IF TG_OP = 'DELETE' AND current_setting('helvetly.purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'financial_events is append-only';
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION invoice_xml_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('helvetly.purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'invoice XML archive is append-only';
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION require_active_account() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
    PERFORM 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NULL FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account is not active' USING ERRCODE = '23514', CONSTRAINT = 'active_account_reference';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION signature_events_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Deleting a whole workspace sets helvetly.purge for its transaction; nothing else may change the trail.
    IF TG_OP = 'DELETE' AND current_setting('helvetly.purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'signature_events is append-only';
END;
$$;
-- +goose StatementEnd

CREATE TABLE account_login_challenges (
    token_hash text NOT NULL,
    user_id text NOT NULL,
    workspace_id text NOT NULL,
    next_path text DEFAULT '/'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

CREATE TABLE account_recovery_codes (
    user_id text NOT NULL,
    code_hash text NOT NULL
);

CREATE TABLE account_two_factor (
    user_id text NOT NULL,
    secret text NOT NULL,
    pending_secret text,
    pending_expires_at timestamp with time zone,
    enabled boolean DEFAULT false NOT NULL,
    last_step bigint DEFAULT '-1'::integer NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone
);

CREATE TABLE ai_token_packs (
    checkout_session_id text NOT NULL,
    workspace_id text NOT NULL,
    period text NOT NULL,
    tokens bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ai_token_packs_period_check CHECK ((period ~ '^[0-9]{4}-[0-9]{2}$'::text)),
    CONSTRAINT ai_token_packs_tokens_check CHECK ((tokens > 0))
);

CREATE TABLE api_tokens (
    id text NOT NULL,
    user_id text NOT NULL,
    workspace_id text NOT NULL,
    name text NOT NULL,
    token_hash text NOT NULL,
    prefix text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    scopes text[] NOT NULL,
    CONSTRAINT api_tokens_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 80))),
    CONSTRAINT api_tokens_scopes CHECK ((cardinality(scopes) > 0)),
    CONSTRAINT api_tokens_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE client_change_requests (
    id text NOT NULL,
    workspace_id text NOT NULL,
    client_id text NOT NULL,
    contact_id text,
    fields jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    decided_at timestamp with time zone,
    decided_by text,
    applied_fields text[],
    reject_reason text,
    CONSTRAINT client_change_requests_reject_reason_check CHECK ((char_length(reject_reason) <= 500)),
    CONSTRAINT client_change_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

CREATE TABLE client_contacts (
    id text NOT NULL,
    client_id text NOT NULL,
    workspace_id text NOT NULL,
    name text NOT NULL,
    role text,
    email text,
    phone text,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE clients (
    id text NOT NULL,
    workspace_id text NOT NULL,
    number bigint NOT NULL,
    name text NOT NULL,
    preferred_name text,
    is_company boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    email text,
    billing_email text,
    phone text,
    website text,
    street text,
    street_number text,
    apt text,
    zip text,
    city text,
    country text,
    vat_number text,
    language text,
    currency text,
    payment_terms_days integer,
    internal_id text,
    note text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    electronic_address jsonb,
    registration_number text,
    dunning_enabled boolean DEFAULT true NOT NULL,
    einvoice_format text DEFAULT 'none'::text NOT NULL,
    leitweg_id text,
    region text,
    portal_enabled boolean DEFAULT false NOT NULL,
    portal_invited_at timestamp with time zone,
    portal_signed_in_at timestamp with time zone,
    CONSTRAINT clients_einvoice_format_check CHECK ((einvoice_format = ANY (ARRAY['none'::text, 'xrechnung_ubl'::text, 'xrechnung_cii'::text, 'peppol'::text]))),
    CONSTRAINT clients_electronic_address_object CHECK (((electronic_address IS NULL) OR (jsonb_typeof(electronic_address) = 'object'::text))),
    CONSTRAINT clients_language_check CHECK ((language = ANY (ARRAY['de'::text, 'fr'::text, 'it'::text, 'en'::text]))),
    CONSTRAINT clients_payment_terms_days_check CHECK (((payment_terms_days >= 0) AND (payment_terms_days <= 365)))
);

CREATE TABLE closed_periods (
    workspace_id text NOT NULL,
    month text NOT NULL,
    closed_at timestamp with time zone NOT NULL,
    closed_by text,
    CONSTRAINT closed_periods_month_check CHECK ((month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text))
);

CREATE TABLE digest_days (
    workspace_id text NOT NULL,
    day date NOT NULL
);

CREATE TABLE document_folder_stars (
    user_id text NOT NULL,
    folder_id text NOT NULL,
    workspace_id text NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE document_folders (
    id text NOT NULL,
    workspace_id text NOT NULL,
    parent_id text,
    name text NOT NULL,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by text,
    trashed_with text
);

CREATE TABLE document_links (
    document_id text NOT NULL,
    workspace_id text NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT document_links_target_type_check CHECK ((target_type = ANY (ARRAY['client'::text, 'invoice'::text, 'expense'::text, 'signature'::text])))
);

CREATE TABLE document_shares (
    document_id text NOT NULL,
    client_id text NOT NULL,
    workspace_id text NOT NULL,
    shared_by text,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE documents (
    id text NOT NULL,
    workspace_id text NOT NULL,
    folder_id text,
    name text NOT NULL,
    size bigint NOT NULL,
    content_type text NOT NULL,
    sha256 text,
    object_key text NOT NULL,
    uploaded_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by text,
    trashed_with text
);

CREATE TABLE dunning_notices (
    workspace_id text NOT NULL,
    invoice_id text NOT NULL,
    level integer NOT NULL,
    levels integer NOT NULL,
    sent_at timestamp with time zone NOT NULL,
    sent_on date NOT NULL,
    open_amount bigint NOT NULL,
    fee bigint NOT NULL,
    interest bigint NOT NULL,
    interest_rate integer NOT NULL,
    interest_from date,
    total bigint NOT NULL,
    email text NOT NULL,
    sent_by text,
    title text,
    qr_bill boolean DEFAULT true NOT NULL,
    CONSTRAINT dunning_notices_check CHECK (((levels >= level) AND (levels <= 10))),
    CONSTRAINT dunning_notices_level_check CHECK (((level >= 1) AND (level <= 10)))
);

CREATE TABLE einvoice_transmissions (
    id text NOT NULL,
    workspace_id text NOT NULL,
    invoice_id text NOT NULL,
    channel text NOT NULL,
    format text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    external_id text,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT einvoice_transmissions_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'failed'::text])))
);

CREATE TABLE email_codes (
    id text NOT NULL,
    email text NOT NULL,
    code_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    client text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone
);

CREATE TABLE engagement_entries (
    id text NOT NULL,
    engagement_id text NOT NULL,
    period_id text NOT NULL,
    date date NOT NULL,
    quantity bigint NOT NULL,
    note text,
    performed_by text,
    invoice_id text,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT engagement_entries_quantity_check CHECK ((quantity > 0))
);

CREATE TABLE engagement_invoices (
    period_id text NOT NULL,
    invoice_id text NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT engagement_invoices_kind_check CHECK ((kind = ANY (ARRAY['advance'::text, 'usage'::text])))
);

CREATE TABLE engagement_notices (
    id text NOT NULL,
    engagement_id text NOT NULL,
    period_id text NOT NULL,
    kind text NOT NULL,
    invoice_id text,
    created_at timestamp with time zone NOT NULL,
    notified_at timestamp with time zone,
    CONSTRAINT engagement_notices_kind_check CHECK ((kind = ANY (ARRAY['ending_soon'::text, 'period_closed'::text, 'draft_created'::text, 'under_pace'::text])))
);

CREATE TABLE engagement_periods (
    id text NOT NULL,
    engagement_id text NOT NULL,
    idx integer NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    quantity bigint NOT NULL,
    unit_price bigint NOT NULL,
    overage_unit_price bigint NOT NULL,
    natural_ends_on date NOT NULL,
    full_quantity bigint NOT NULL,
    quantity_manual boolean DEFAULT false NOT NULL,
    CONSTRAINT engagement_periods_idx_check CHECK ((idx >= 1)),
    CONSTRAINT engagement_periods_overage_unit_price_check CHECK ((overage_unit_price >= 0)),
    CONSTRAINT engagement_periods_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT engagement_periods_unit_price_check CHECK ((unit_price >= 0))
);

CREATE TABLE engagement_settings (
    workspace_id text NOT NULL,
    digest boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE engagements (
    id text NOT NULL,
    workspace_id text NOT NULL,
    number bigint NOT NULL,
    client_id text NOT NULL,
    title text NOT NULL,
    description text,
    product_id text,
    unit text,
    quantity bigint NOT NULL,
    billing text NOT NULL,
    price_basis text NOT NULL,
    unit_price bigint NOT NULL,
    overage_unit_price bigint,
    currency text NOT NULL,
    vat_category text NOT NULL,
    vat_rate integer NOT NULL,
    start_date date NOT NULL,
    recurrence text NOT NULL,
    "interval" integer NOT NULL,
    end_date date,
    reference text,
    document_id text,
    cancelled_on date,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    rollover boolean DEFAULT false NOT NULL,
    auto_invoice boolean DEFAULT false NOT NULL,
    invoice_detail text DEFAULT 'summary'::text NOT NULL,
    CONSTRAINT engagements_billing_check CHECK ((billing = ANY (ARRAY['advance'::text, 'arrears'::text]))),
    CONSTRAINT engagements_interval_check CHECK ((("interval" >= 1) AND ("interval" <= 12))),
    CONSTRAINT engagements_invoice_detail_check CHECK ((invoice_detail = ANY (ARRAY['summary'::text, 'per_entry'::text]))),
    CONSTRAINT engagements_overage_unit_price_check CHECK ((overage_unit_price >= 0)),
    CONSTRAINT engagements_price_basis_check CHECK ((price_basis = ANY (ARRAY['net'::text, 'gross'::text]))),
    CONSTRAINT engagements_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT engagements_recurrence_check CHECK ((recurrence = ANY (ARRAY['none'::text, 'weekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text]))),
    CONSTRAINT engagements_unit_check CHECK ((unit = ANY (ARRAY['hour'::text, 'day'::text, 'piece'::text, 'month'::text, 'km'::text, 'flat'::text]))),
    CONSTRAINT engagements_unit_price_check CHECK ((unit_price >= 0)),
    CONSTRAINT engagements_vat_category_check CHECK ((vat_category = ANY (ARRAY['S'::text, 'Z'::text, 'E'::text, 'AE'::text, 'K'::text, 'G'::text, 'O'::text]))),
    CONSTRAINT engagements_vat_rate_check CHECK (((vat_rate >= 0) AND (vat_rate <= 10000)))
);

CREATE TABLE expense_categories (
    id text NOT NULL,
    workspace_id text NOT NULL,
    name text NOT NULL,
    account_code text NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE expense_lines (
    id text NOT NULL,
    expense_id text NOT NULL,
    "position" integer NOT NULL,
    description text,
    amount bigint NOT NULL,
    vat_rate integer NOT NULL,
    CONSTRAINT expense_lines_amount_check CHECK ((amount >= 0)),
    CONSTRAINT expense_lines_vat_rate_check CHECK (((vat_rate >= 0) AND (vat_rate <= 10000)))
);

CREATE TABLE expense_receipts (
    id text NOT NULL,
    expense_id text NOT NULL,
    workspace_id text NOT NULL,
    object_key text NOT NULL,
    name text NOT NULL,
    size bigint NOT NULL,
    content_type text NOT NULL,
    uploaded_by text,
    created_at timestamp with time zone NOT NULL,
    sha256 text,
    CONSTRAINT expense_receipts_sha256_check CHECK (((sha256 IS NULL) OR (sha256 ~ '^[0-9a-f]{64}$'::text)))
);

CREATE TABLE expenses (
    id text NOT NULL,
    workspace_id text NOT NULL,
    number bigint NOT NULL,
    status text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    supplier_name text,
    supplier_vat_number text,
    reference text,
    description text,
    category_id text,
    document_date date,
    due_date date,
    currency text NOT NULL,
    amount_mode text NOT NULL,
    input_tax text NOT NULL,
    deductible_percent integer NOT NULL,
    net_total bigint NOT NULL,
    vat_total bigint NOT NULL,
    total bigint NOT NULL,
    deductible_vat bigint NOT NULL,
    vat_breakdown jsonb NOT NULL,
    exchange_rate bigint NOT NULL,
    exchange_rate_date date,
    exchange_rate_source text,
    base_currency text NOT NULL,
    base_net_total bigint NOT NULL,
    base_vat_total bigint NOT NULL,
    base_total bigint NOT NULL,
    base_deductible_vat bigint NOT NULL,
    payment_status text NOT NULL,
    paid_on date,
    payment_method text,
    paid_by text,
    reimbursed_on date,
    note text,
    receipt_missing_reason text,
    created_by text,
    booked_at timestamp with time zone,
    booked_by text,
    voided_at timestamp with time zone,
    voided_by text,
    void_reason text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    supplier_country text DEFAULT 'CH'::text NOT NULL,
    reverse_charge boolean DEFAULT false NOT NULL,
    input_tax_box text,
    CONSTRAINT expenses_amount_mode_check CHECK ((amount_mode = ANY (ARRAY['gross'::text, 'net'::text]))),
    CONSTRAINT expenses_check CHECK (((status = 'draft'::text) = (booked_at IS NULL))),
    CONSTRAINT expenses_check1 CHECK (((deleted_at IS NULL) OR (status = 'draft'::text))),
    CONSTRAINT expenses_deductible_percent_check CHECK (((deductible_percent >= 0) AND (deductible_percent <= 10000))),
    CONSTRAINT expenses_exchange_rate_check CHECK ((exchange_rate > 0)),
    CONSTRAINT expenses_exchange_rate_source_check CHECK ((exchange_rate_source = ANY (ARRAY['estv_monthly'::text, 'estv_daily'::text, 'bank'::text, 'manual'::text]))),
    CONSTRAINT expenses_input_tax_box_check CHECK ((input_tax_box = ANY (ARRAY['400'::text, '405'::text]))),
    CONSTRAINT expenses_input_tax_check CHECK ((input_tax = ANY (ARRAY['full'::text, 'partial'::text, 'none'::text]))),
    CONSTRAINT expenses_payment_method_check CHECK ((payment_method = ANY (ARRAY['bank_transfer'::text, 'cash'::text, 'card'::text, 'twint'::text, 'other'::text]))),
    CONSTRAINT expenses_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text]))),
    CONSTRAINT expenses_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'import'::text]))),
    CONSTRAINT expenses_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'booked'::text, 'void'::text])))
);

CREATE TABLE financial_events (
    workspace_id text NOT NULL,
    seq bigint NOT NULL,
    kind text NOT NULL,
    subject_type text NOT NULL,
    subject_id text NOT NULL,
    actor_id text,
    at timestamp with time zone NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    prev_hash bytea NOT NULL,
    hash bytea NOT NULL
);

CREATE TABLE heidi_confirmations (
    id text NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    conversation_id text NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT heidi_confirmations_kind_check CHECK ((kind = ANY (ARRAY['log_entry'::text, 'select_engagement'::text])))
);

CREATE TABLE heidi_conversations (
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    id text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT heidi_conversations_id_check CHECK ((id ~ '^[A-Za-z0-9_-]{1,32}$'::text))
);

CREATE TABLE heidi_messages (
    "position" bigint NOT NULL,
    id text NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    conversation_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

ALTER TABLE heidi_messages ALTER COLUMN "position" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME heidi_messages_position_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE heidi_usage (
    workspace_id text NOT NULL,
    period text NOT NULL,
    tokens_used bigint DEFAULT 0 NOT NULL,
    uncertain boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT heidi_usage_period_check CHECK ((period ~ '^[0-9]{4}-[0-9]{2}$'::text)),
    CONSTRAINT heidi_usage_tokens_used_check CHECK ((tokens_used >= 0))
);

CREATE TABLE import_batches (
    id text NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT import_batches_kind_check CHECK ((kind = ANY (ARRAY['clients'::text, 'products'::text, 'expenses'::text, 'invoices'::text, 'engagements'::text])))
);

CREATE TABLE import_files (
    id text NOT NULL,
    batch_id text NOT NULL,
    workspace_id text NOT NULL,
    "position" integer NOT NULL,
    name text NOT NULL,
    size bigint NOT NULL,
    content_type text NOT NULL,
    object_key text,
    entry_index integer,
    document_id text,
    reused boolean DEFAULT false NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    error text,
    chunks_done integer DEFAULT 0 NOT NULL,
    chunks_total integer,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    claimed_until timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT import_files_size_check CHECK ((size >= 0)),
    CONSTRAINT import_files_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'extracting'::text, 'done'::text, 'failed'::text])))
);

CREATE TABLE import_records (
    id text NOT NULL,
    batch_id text NOT NULL,
    file_id text NOT NULL,
    workspace_id text NOT NULL,
    "position" integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    data jsonb NOT NULL,
    issues jsonb DEFAULT '{}'::jsonb NOT NULL,
    duplicate jsonb,
    entity_id text,
    error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    generated_by text DEFAULT 'model'::text NOT NULL,
    CONSTRAINT import_records_check CHECK (((status = 'created'::text) = (entity_id IS NOT NULL))),
    CONSTRAINT import_records_generated_by_check CHECK ((generated_by = ANY (ARRAY['model'::text, 'helvetly'::text]))),
    CONSTRAINT import_records_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'created'::text, 'failed'::text, 'skipped'::text])))
);

CREATE TABLE instalment_plan_items (
    plan_id text NOT NULL,
    seq integer NOT NULL,
    due_date date NOT NULL,
    issue_on date NOT NULL,
    invoice_id text,
    issued_at timestamp with time zone,
    CONSTRAINT instalment_plan_items_seq_check CHECK ((seq > 0))
);

CREATE TABLE instalment_plans (
    id text NOT NULL,
    workspace_id text NOT NULL,
    source_invoice_id text NOT NULL,
    client_id text NOT NULL,
    count integer NOT NULL,
    instalment_interval text NOT NULL,
    first_due_date date NOT NULL,
    lead_days integer NOT NULL,
    auto_send boolean NOT NULL,
    status text NOT NULL,
    reminders_enabled boolean DEFAULT true NOT NULL,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT instalment_plans_count_check CHECK (((count >= 2) AND (count <= 12))),
    CONSTRAINT instalment_plans_instalment_interval_check CHECK ((instalment_interval = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text]))),
    CONSTRAINT instalment_plans_lead_days_check CHECK ((lead_days >= 0)),
    CONSTRAINT instalment_plans_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'cancelled'::text, 'done'::text])))
);

CREATE TABLE invoice_counters (
    workspace_id text NOT NULL,
    kind text NOT NULL,
    year integer NOT NULL,
    seq bigint NOT NULL,
    CONSTRAINT invoice_counters_kind_check CHECK ((kind = ANY (ARRAY['invoice'::text, 'credit_note'::text, 'proforma'::text, 'self_billed'::text])))
);

CREATE TABLE invoice_deliveries (
    id text NOT NULL,
    invoice_id text NOT NULL,
    recipients text[] NOT NULL,
    cc text[] DEFAULT '{}'::text[] NOT NULL,
    sent_by text,
    sent_at timestamp with time zone NOT NULL
);

CREATE TABLE invoice_instalments (
    invoice_id text NOT NULL,
    seq integer NOT NULL,
    due_date date NOT NULL,
    amount bigint NOT NULL,
    reference text,
    CONSTRAINT invoice_instalments_seq_check CHECK ((seq > 0))
);

CREATE TABLE invoice_lines (
    id text NOT NULL,
    invoice_id text NOT NULL,
    "position" integer NOT NULL,
    description text NOT NULL,
    quantity bigint NOT NULL,
    unit text,
    unit_price bigint NOT NULL,
    discount_percent integer NOT NULL,
    vat_category text NOT NULL,
    vat_rate integer NOT NULL,
    amount bigint NOT NULL,
    vat_exemption_code text,
    vat_exemption_reason text,
    CONSTRAINT invoice_lines_discount_percent_check CHECK (((discount_percent >= 0) AND (discount_percent <= 10000))),
    CONSTRAINT invoice_lines_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT invoice_lines_unit_check CHECK ((unit = ANY (ARRAY['hour'::text, 'day'::text, 'piece'::text, 'month'::text, 'km'::text, 'flat'::text]))),
    CONSTRAINT invoice_lines_unit_price_check CHECK ((unit_price >= 0)),
    CONSTRAINT invoice_lines_vat_category_check CHECK ((vat_category = ANY (ARRAY['S'::text, 'Z'::text, 'E'::text, 'AE'::text, 'K'::text, 'G'::text, 'O'::text]))),
    CONSTRAINT invoice_lines_vat_rate_check CHECK (((vat_rate >= 0) AND (vat_rate <= 10000)))
);

CREATE TABLE invoice_payments (
    id text NOT NULL,
    invoice_id text NOT NULL,
    amount bigint NOT NULL,
    paid_on date NOT NULL,
    method text NOT NULL,
    note text,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT invoice_payments_amount_check CHECK ((amount > 0)),
    CONSTRAINT invoice_payments_method_check CHECK ((method = ANY (ARRAY['bank_transfer'::text, 'cash'::text, 'card'::text, 'twint'::text, 'other'::text])))
);

CREATE TABLE invoice_prepayments (
    invoice_id text NOT NULL,
    prepayment_id text NOT NULL,
    "position" integer NOT NULL
);

CREATE TABLE invoice_refunds (
    id text NOT NULL,
    invoice_id text NOT NULL,
    amount bigint NOT NULL,
    refunded_on date NOT NULL,
    method text NOT NULL,
    note text,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT invoice_refunds_amount_check CHECK ((amount > 0)),
    CONSTRAINT invoice_refunds_method_check CHECK ((method = ANY (ARRAY['bank_transfer'::text, 'cash'::text, 'card'::text, 'twint'::text, 'other'::text])))
);

CREATE TABLE invoice_settings (
    workspace_id text NOT NULL,
    settings jsonb NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE invoice_xml_exports (
    invoice_id text NOT NULL,
    format text NOT NULL,
    serializer_version text NOT NULL,
    object_key text NOT NULL,
    sha256 text NOT NULL,
    size bigint NOT NULL,
    filename text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    created_by text,
    CONSTRAINT invoice_xml_exports_format_check CHECK ((format = ANY (ARRAY['xrechnung-ubl'::text, 'xrechnung-cii'::text, 'peppol'::text, 'ksef-fa3'::text, 'ro-cius'::text]))),
    CONSTRAINT invoice_xml_exports_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT invoice_xml_exports_size_check CHECK ((size > 0))
);

CREATE TABLE invoice_xml_retention (
    invoice_id text NOT NULL,
    format text NOT NULL,
    applied_at timestamp with time zone NOT NULL
);

CREATE TABLE invoices (
    id text NOT NULL,
    workspace_id text NOT NULL,
    kind text NOT NULL,
    status text NOT NULL,
    number text,
    seq bigint,
    client_id text NOT NULL,
    credited_invoice_id text,
    issue_date date NOT NULL,
    due_date date NOT NULL,
    service_date date,
    service_date_end date,
    currency text NOT NULL,
    language text NOT NULL,
    vat_mode text NOT NULL,
    reference text,
    intro text,
    footer text,
    note text,
    discount_percent integer NOT NULL,
    subtotal bigint NOT NULL,
    discount_amount bigint NOT NULL,
    net_total bigint NOT NULL,
    vat_total bigint NOT NULL,
    total bigint NOT NULL,
    rounding_amount bigint NOT NULL,
    vat_breakdown jsonb NOT NULL,
    amount_paid bigint DEFAULT 0 NOT NULL,
    amount_credited bigint DEFAULT 0 NOT NULL,
    iban text,
    reference_type text,
    payment_reference text,
    qr_bill boolean DEFAULT false NOT NULL,
    seller jsonb,
    buyer jsonb,
    pdf_key text,
    issued_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    amount_refunded bigint DEFAULT 0 NOT NULL,
    pay_qr_bill boolean DEFAULT false NOT NULL,
    pay_revolut boolean DEFAULT false NOT NULL,
    revolut_url text,
    prepaid_total bigint DEFAULT 0 NOT NULL,
    deducted_on_invoice_id text,
    instalment_interval text,
    reminders_enabled boolean DEFAULT true NOT NULL,
    plan_id text,
    plan_seq integer,
    send_claimed_at timestamp with time zone,
    dunning_paused boolean DEFAULT false NOT NULL,
    tax_currency_rate numeric(18,6),
    origin text DEFAULT 'helvetly'::text NOT NULL,
    source_document_id text,
    CONSTRAINT invoices_check CHECK (((status = 'draft'::text) = (number IS NULL))),
    CONSTRAINT invoices_discount_percent_check CHECK (((discount_percent >= 0) AND (discount_percent <= 10000))),
    CONSTRAINT invoices_imported_original CHECK (((origin = 'helvetly'::text) OR (status = 'draft'::text) OR (source_document_id IS NOT NULL))),
    CONSTRAINT invoices_instalment_interval_check CHECK ((instalment_interval = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'quarterly'::text, 'yearly'::text]))),
    CONSTRAINT invoices_kind_check CHECK ((kind = ANY (ARRAY['invoice'::text, 'partial'::text, 'prepayment'::text, 'debit_note'::text, 'corrected'::text, 'credit_note'::text, 'proforma'::text, 'self_billed'::text]))),
    CONSTRAINT invoices_language_check CHECK ((language = ANY (ARRAY['de'::text, 'fr'::text, 'it'::text, 'en'::text]))),
    CONSTRAINT invoices_origin_check CHECK ((origin = ANY (ARRAY['helvetly'::text, 'imported'::text]))),
    CONSTRAINT invoices_reference_type_check CHECK ((reference_type = ANY (ARRAY['QRR'::text, 'SCOR'::text, 'NON'::text]))),
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'void'::text, 'replaced'::text]))),
    CONSTRAINT invoices_tax_currency_rate_check CHECK ((tax_currency_rate > (0)::numeric)),
    CONSTRAINT invoices_vat_mode_check CHECK ((vat_mode = ANY (ARRAY['exclusive'::text, 'inclusive'::text, 'none'::text])))
);

CREATE TABLE ledger_settings (
    workspace_id text NOT NULL,
    accounts jsonb NOT NULL,
    updated_by text,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE notifications (
    id bigint NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    event text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    in_app boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    read_at timestamp with time zone,
    emailed_at timestamp with time zone,
    once_key text
);

ALTER TABLE notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE object_retention (
    object_key text NOT NULL,
    workspace_id text NOT NULL,
    status text NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    requested_until timestamp with time zone,
    requested_mode text,
    version_id text,
    locked_mode text,
    locked_until timestamp with time zone,
    confirmed_at timestamp with time zone,
    next_attempt_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    CONSTRAINT object_retention_check CHECK (((status <> 'confirmed'::text) OR ((locked_mode IS NOT NULL) AND (locked_until IS NOT NULL) AND (confirmed_at IS NOT NULL)))),
    CONSTRAINT object_retention_requested_mode_check CHECK ((requested_mode = ANY (ARRAY['GOVERNANCE'::text, 'COMPLIANCE'::text]))),
    CONSTRAINT object_retention_status_check CHECK ((status = ANY (ARRAY['not_requested'::text, 'pending'::text, 'failed'::text, 'confirmed'::text])))
);

CREATE TABLE object_versions (
    object_key text NOT NULL,
    version_id text NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    CONSTRAINT object_versions_version_id_check CHECK (((version_id <> ''::text) AND (version_id <> 'null'::text)))
);

CREATE TABLE passkey_challenges (
    id text NOT NULL,
    purpose text NOT NULL,
    user_id text,
    session jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT passkey_challenges_purpose_check CHECK ((purpose = ANY (ARRAY['register'::text, 'sign_in'::text])))
);

CREATE TABLE passkeys (
    id text NOT NULL,
    user_id text NOT NULL,
    credential_id text NOT NULL,
    name text NOT NULL,
    credential jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone
);

CREATE TABLE plan_limits (
    plan text NOT NULL,
    limit_key text NOT NULL,
    max_value bigint,
    CONSTRAINT plan_limits_limit_key_check CHECK ((limit_key = ANY (ARRAY['members'::text, 'clients'::text, 'invoices_per_month'::text, 'expenses_per_month'::text, 'products'::text, 'engagements'::text, 'signatures_per_month'::text, 'storage_bytes'::text, 'ai_tokens_per_month'::text]))),
    CONSTRAINT plan_limits_max_value_check CHECK ((max_value >= 0)),
    CONSTRAINT plan_limits_plan_check CHECK ((plan = ANY (ARRAY['basic'::text, 'pro'::text, 'business'::text])))
);

CREATE TABLE portal_avatars (
    client_id text NOT NULL,
    email text NOT NULL,
    workspace_id text NOT NULL,
    object_key text NOT NULL,
    content_type text NOT NULL,
    size bigint NOT NULL,
    sha256 text NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT portal_avatars_email_check CHECK ((email = lower(email))),
    CONSTRAINT portal_avatars_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE portal_sessions (
    id text NOT NULL,
    token_hash text NOT NULL,
    csrf_token text NOT NULL,
    client_id text NOT NULL,
    workspace_id text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_active_at timestamp with time zone NOT NULL,
    email text NOT NULL
);

CREATE TABLE product_feedback (
    id text NOT NULL,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    description text NOT NULL,
    page_path text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    emailed_at timestamp with time zone,
    CONSTRAINT product_feedback_description_check CHECK (((char_length(description) >= 1) AND (char_length(description) <= 5000))),
    CONSTRAINT product_feedback_kind_check CHECK ((kind = ANY (ARRAY['problem'::text, 'feature'::text])))
);

CREATE TABLE product_feedback_files (
    feedback_id text NOT NULL,
    "position" integer NOT NULL,
    object_key text NOT NULL,
    content_type text NOT NULL,
    size bigint NOT NULL,
    sha256 text NOT NULL,
    CONSTRAINT product_feedback_files_position_check CHECK ((("position" >= 0) AND ("position" <= 4)))
);

CREATE TABLE products (
    id text NOT NULL,
    workspace_id text NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    description text,
    sku text,
    gtin text,
    unit text,
    price_basis text NOT NULL,
    unit_price bigint NOT NULL,
    currency text NOT NULL,
    vat_category text NOT NULL,
    vat_rate integer NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT products_check CHECK (((gtin IS NULL) OR (type = 'product'::text))),
    CONSTRAINT products_price_basis_check CHECK ((price_basis = ANY (ARRAY['net'::text, 'gross'::text]))),
    CONSTRAINT products_type_check CHECK ((type = ANY (ARRAY['product'::text, 'service'::text]))),
    CONSTRAINT products_unit_check CHECK ((unit = ANY (ARRAY['hour'::text, 'day'::text, 'piece'::text, 'month'::text, 'km'::text, 'flat'::text]))),
    CONSTRAINT products_unit_price_check CHECK ((unit_price >= 0)),
    CONSTRAINT products_vat_category_check CHECK ((vat_category = ANY (ARRAY['S'::text, 'Z'::text, 'E'::text, 'AE'::text, 'K'::text, 'G'::text, 'O'::text]))),
    CONSTRAINT products_vat_rate_check CHECK (((vat_rate >= 0) AND (vat_rate <= 10000)))
);

CREATE TABLE quote_counters (
    workspace_id text NOT NULL,
    year integer NOT NULL,
    seq bigint NOT NULL
);

CREATE TABLE quotes (
    id text NOT NULL,
    workspace_id text NOT NULL,
    client_id text NOT NULL,
    number text,
    revision integer DEFAULT 1 NOT NULL,
    status text NOT NULL,
    issue_date date NOT NULL,
    valid_until date NOT NULL,
    currency text NOT NULL,
    language text NOT NULL,
    vat_mode text NOT NULL,
    reference text,
    intro text,
    footer text,
    note text,
    discount_percent integer NOT NULL,
    lines jsonb NOT NULL,
    subtotal bigint NOT NULL,
    discount_amount bigint NOT NULL,
    net_total bigint NOT NULL,
    vat_total bigint NOT NULL,
    total bigint NOT NULL,
    rounding_amount bigint NOT NULL,
    vat_breakdown jsonb NOT NULL,
    pdf_key text,
    sent_at timestamp with time zone,
    decided_at timestamp with time zone,
    decided_by text,
    decision_note text,
    invoice_id text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT quotes_check CHECK ((valid_until >= issue_date)),
    CONSTRAINT quotes_check1 CHECK (((status = 'draft'::text) OR (number IS NOT NULL))),
    CONSTRAINT quotes_check2 CHECK (((status = ANY (ARRAY['accepted'::text, 'declined'::text])) = (decided_at IS NOT NULL))),
    CONSTRAINT quotes_check3 CHECK (((invoice_id IS NULL) OR (status = 'accepted'::text))),
    CONSTRAINT quotes_decided_by_check CHECK ((decided_by = ANY (ARRAY['staff'::text, 'client'::text]))),
    CONSTRAINT quotes_discount_percent_check CHECK (((discount_percent >= 0) AND (discount_percent <= 10000))),
    CONSTRAINT quotes_language_check CHECK ((language = ANY (ARRAY['de'::text, 'fr'::text, 'it'::text, 'en'::text]))),
    CONSTRAINT quotes_revision_check CHECK ((revision >= 1)),
    CONSTRAINT quotes_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'declined'::text]))),
    CONSTRAINT quotes_vat_mode_check CHECK ((vat_mode = ANY (ARRAY['exclusive'::text, 'inclusive'::text, 'none'::text])))
);

CREATE TABLE reminder_log (
    workspace_id text NOT NULL,
    target_id text NOT NULL,
    seq integer NOT NULL,
    kind text NOT NULL,
    offset_days integer NOT NULL,
    sent_at timestamp with time zone NOT NULL,
    CONSTRAINT reminder_log_kind_check CHECK ((kind = ANY (ARRAY['before'::text, 'after'::text])))
);

CREATE TABLE self_billing_agreements (
    id text NOT NULL,
    workspace_id text NOT NULL,
    client_id text NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    accepted_at timestamp with time zone,
    accepted_by text,
    note text,
    first_used_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT self_billing_agreements_check CHECK ((ends_on >= starts_on))
);

CREATE TABLE sessions (
    id text NOT NULL,
    token_hash text NOT NULL,
    csrf_token text NOT NULL,
    user_id text NOT NULL,
    workspace_id text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    ip text DEFAULT ''::text NOT NULL,
    last_active_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE signature_events (
    request_id text NOT NULL,
    seq integer NOT NULL,
    type text NOT NULL,
    signer_id text,
    at timestamp with time zone NOT NULL,
    ip text,
    user_agent text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    hash text NOT NULL
);

CREATE TABLE signature_fields (
    id text NOT NULL,
    request_id text NOT NULL,
    signer_id text NOT NULL,
    "position" integer NOT NULL,
    page integer NOT NULL,
    kind text NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    w double precision NOT NULL,
    h double precision NOT NULL,
    label text,
    value text,
    CONSTRAINT signature_fields_check CHECK (((w >= (0.01)::double precision) AND ((x + w) <= (1.000001)::double precision))),
    CONSTRAINT signature_fields_check1 CHECK (((h >= (0.01)::double precision) AND ((y + h) <= (1.000001)::double precision))),
    CONSTRAINT signature_fields_kind_check CHECK ((kind = ANY (ARRAY['signature'::text, 'date'::text, 'name'::text, 'text'::text]))),
    CONSTRAINT signature_fields_page_check CHECK ((page >= 1)),
    CONSTRAINT signature_fields_x_check CHECK (((x >= (0)::double precision) AND (x <= (1)::double precision))),
    CONSTRAINT signature_fields_y_check CHECK (((y >= (0)::double precision) AND (y <= (1)::double precision)))
);

CREATE TABLE signature_requests (
    id text NOT NULL,
    workspace_id text NOT NULL,
    document_id text,
    folder_id text,
    title text NOT NULL,
    message text,
    signing_order text NOT NULL,
    status text NOT NULL,
    original_key text NOT NULL,
    original_sha256 text NOT NULL,
    page_count integer NOT NULL,
    signed_document_id text,
    final_sha256 text,
    expires_at timestamp with time zone NOT NULL,
    created_by text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT signature_requests_signing_order_check CHECK ((signing_order = ANY (ARRAY['parallel'::text, 'sequential'::text]))),
    CONSTRAINT signature_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'declined'::text, 'revoked'::text])))
);

CREATE TABLE signature_signers (
    id text NOT NULL,
    request_id text NOT NULL,
    "position" integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    token_hash text,
    sent_at timestamp with time zone,
    viewed_at timestamp with time zone,
    viewed_ip text,
    viewed_ua text,
    signed_at timestamp with time zone,
    signed_ip text,
    signed_ua text,
    signature_method text,
    signature_png bytea,
    declined_at timestamp with time zone,
    decline_reason text,
    CONSTRAINT signature_signers_signature_method_check CHECK ((signature_method = ANY (ARRAY['typed'::text, 'drawn'::text])))
);

CREATE TABLE stripe_events (
    id text NOT NULL,
    type text NOT NULL,
    received_at timestamp with time zone NOT NULL
);

CREATE TABLE templates (
    id text NOT NULL,
    workspace_id text NOT NULL,
    name text NOT NULL,
    description text,
    document_id text,
    signers jsonb NOT NULL,
    fields jsonb NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT templates_description_check CHECK ((char_length(description) <= 500)),
    CONSTRAINT templates_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)))
);

CREATE TABLE transmission_credentials (
    workspace_id text NOT NULL,
    channel text NOT NULL,
    sealed bytea NOT NULL,
    updated_by text,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE user_identities (
    provider text NOT NULL,
    subject text NOT NULL,
    user_id text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT user_identities_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'email'::text])))
);

CREATE TABLE users (
    id text NOT NULL,
    email text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    avatar_url text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    notification_prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
    photo_key text,
    photo_type text,
    photo_size bigint,
    photo_sha256 text,
    CONSTRAINT users_photo_complete CHECK ((((photo_key IS NULL) = (photo_type IS NULL)) AND ((photo_key IS NULL) = (photo_size IS NULL)) AND ((photo_key IS NULL) = (photo_sha256 IS NULL)))),
    CONSTRAINT users_photo_sha256_check CHECK ((photo_sha256 ~ '^[0-9a-f]{64}$'::text))
);

CREATE TABLE vat_return_settings (
    workspace_id text NOT NULL,
    method text NOT NULL,
    period text NOT NULL,
    basis text NOT NULL,
    net_rates jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_by text,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT vat_return_settings_basis_check CHECK ((basis = ANY (ARRAY['agreed'::text, 'received'::text]))),
    CONSTRAINT vat_return_settings_method_check CHECK ((method = ANY (ARRAY['effective'::text, 'net_tax_rate'::text]))),
    CONSTRAINT vat_return_settings_period_check CHECK ((period = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'half_yearly'::text, 'yearly'::text])))
);

CREATE TABLE workspace_ai_consents (
    id bigint NOT NULL,
    workspace_id text NOT NULL,
    granted boolean NOT NULL,
    user_id text NOT NULL,
    at timestamp with time zone NOT NULL
);

ALTER TABLE workspace_ai_consents ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME workspace_ai_consents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE workspace_billing (
    workspace_id text NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    status text DEFAULT ''::text NOT NULL,
    plan text DEFAULT ''::text NOT NULL,
    billing_interval text DEFAULT ''::text NOT NULL,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    trial_end timestamp with time zone,
    trial_used boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    discount jsonb,
    per_seat boolean DEFAULT false NOT NULL,
    seats integer,
    CONSTRAINT workspace_billing_billing_interval_check CHECK ((billing_interval = ANY (ARRAY[''::text, 'month'::text, 'year'::text]))),
    CONSTRAINT workspace_billing_plan_check CHECK ((plan = ANY (ARRAY[''::text, 'basic'::text, 'pro'::text, 'business'::text]))),
    CONSTRAINT workspace_billing_seats_check CHECK ((seats >= 0))
);

CREATE TABLE workspace_counters (
    workspace_id text NOT NULL,
    clients_seq bigint DEFAULT 0 NOT NULL,
    expenses_seq bigint DEFAULT 0 NOT NULL,
    engagements_seq bigint DEFAULT 0 NOT NULL
);

CREATE TABLE workspace_invitations (
    id text NOT NULL,
    workspace_id text NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL,
    invited_by text,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by text,
    revoked_at timestamp with time zone,
    scopes text[],
    CONSTRAINT workspace_invitations_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);

CREATE TABLE workspace_members (
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    scopes text[],
    CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);

CREATE TABLE workspaces (
    id text NOT NULL,
    name text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    onboarded_at timestamp with time zone,
    deleted_at timestamp with time zone
);

ALTER TABLE ONLY account_login_challenges
    ADD CONSTRAINT account_login_challenges_pkey PRIMARY KEY (token_hash);

ALTER TABLE ONLY account_recovery_codes
    ADD CONSTRAINT account_recovery_codes_pkey PRIMARY KEY (user_id, code_hash);

ALTER TABLE ONLY account_two_factor
    ADD CONSTRAINT account_two_factor_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY ai_token_packs
    ADD CONSTRAINT ai_token_packs_pkey PRIMARY KEY (checkout_session_id);

ALTER TABLE ONLY api_tokens
    ADD CONSTRAINT api_tokens_pkey PRIMARY KEY (id);

ALTER TABLE ONLY api_tokens
    ADD CONSTRAINT api_tokens_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY client_change_requests
    ADD CONSTRAINT client_change_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY client_contacts
    ADD CONSTRAINT client_contacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY clients
    ADD CONSTRAINT clients_workspace_id_number_key UNIQUE (workspace_id, number);

ALTER TABLE ONLY closed_periods
    ADD CONSTRAINT closed_periods_pkey PRIMARY KEY (workspace_id, month);

ALTER TABLE ONLY digest_days
    ADD CONSTRAINT digest_days_pkey PRIMARY KEY (workspace_id, day);

ALTER TABLE ONLY document_folder_stars
    ADD CONSTRAINT document_folder_stars_pkey PRIMARY KEY (user_id, folder_id);

ALTER TABLE ONLY document_folders
    ADD CONSTRAINT document_folders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY document_links
    ADD CONSTRAINT document_links_pkey PRIMARY KEY (document_id, target_type, target_id);

ALTER TABLE ONLY document_shares
    ADD CONSTRAINT document_shares_pkey PRIMARY KEY (document_id, client_id);

ALTER TABLE ONLY documents
    ADD CONSTRAINT documents_object_key_key UNIQUE (object_key);

ALTER TABLE ONLY documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY dunning_notices
    ADD CONSTRAINT dunning_notices_pkey PRIMARY KEY (invoice_id, level);

ALTER TABLE ONLY einvoice_transmissions
    ADD CONSTRAINT einvoice_transmissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY email_codes
    ADD CONSTRAINT email_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY engagement_entries
    ADD CONSTRAINT engagement_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY engagement_invoices
    ADD CONSTRAINT engagement_invoices_pkey PRIMARY KEY (period_id, invoice_id);

ALTER TABLE ONLY engagement_notices
    ADD CONSTRAINT engagement_notices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY engagement_periods
    ADD CONSTRAINT engagement_periods_engagement_id_idx_key UNIQUE (engagement_id, idx);

ALTER TABLE ONLY engagement_periods
    ADD CONSTRAINT engagement_periods_pkey PRIMARY KEY (id);

ALTER TABLE ONLY engagement_settings
    ADD CONSTRAINT engagement_settings_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY engagements
    ADD CONSTRAINT engagements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY engagements
    ADD CONSTRAINT engagements_workspace_id_number_key UNIQUE (workspace_id, number);

ALTER TABLE ONLY expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY expense_lines
    ADD CONSTRAINT expense_lines_expense_id_position_key UNIQUE (expense_id, "position");

ALTER TABLE ONLY expense_lines
    ADD CONSTRAINT expense_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY expense_receipts
    ADD CONSTRAINT expense_receipts_object_key_key UNIQUE (object_key);

ALTER TABLE ONLY expense_receipts
    ADD CONSTRAINT expense_receipts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY expenses
    ADD CONSTRAINT expenses_workspace_id_number_key UNIQUE (workspace_id, number);

ALTER TABLE ONLY financial_events
    ADD CONSTRAINT financial_events_pkey PRIMARY KEY (workspace_id, seq);

ALTER TABLE ONLY heidi_confirmations
    ADD CONSTRAINT heidi_confirmations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY heidi_confirmations
    ADD CONSTRAINT heidi_confirmations_workspace_id_user_id_conversation_id_key UNIQUE (workspace_id, user_id, conversation_id);

ALTER TABLE ONLY heidi_conversations
    ADD CONSTRAINT heidi_conversations_pkey PRIMARY KEY (workspace_id, user_id, id);

ALTER TABLE ONLY heidi_messages
    ADD CONSTRAINT heidi_messages_id_key UNIQUE (id);

ALTER TABLE ONLY heidi_messages
    ADD CONSTRAINT heidi_messages_pkey PRIMARY KEY ("position");

ALTER TABLE ONLY heidi_usage
    ADD CONSTRAINT heidi_usage_pkey PRIMARY KEY (workspace_id, period);

ALTER TABLE ONLY import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY import_files
    ADD CONSTRAINT import_files_batch_id_position_key UNIQUE (batch_id, "position");

ALTER TABLE ONLY import_files
    ADD CONSTRAINT import_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY import_records
    ADD CONSTRAINT import_records_batch_id_position_key UNIQUE (batch_id, "position");

ALTER TABLE ONLY import_records
    ADD CONSTRAINT import_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY instalment_plan_items
    ADD CONSTRAINT instalment_plan_items_pkey PRIMARY KEY (plan_id, seq);

ALTER TABLE ONLY instalment_plans
    ADD CONSTRAINT instalment_plans_pkey PRIMARY KEY (id);

ALTER TABLE ONLY invoice_counters
    ADD CONSTRAINT invoice_counters_pkey PRIMARY KEY (workspace_id, kind, year);

ALTER TABLE ONLY invoice_deliveries
    ADD CONSTRAINT invoice_deliveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY invoice_instalments
    ADD CONSTRAINT invoice_instalments_pkey PRIMARY KEY (invoice_id, seq);

ALTER TABLE ONLY invoice_lines
    ADD CONSTRAINT invoice_lines_invoice_id_position_key UNIQUE (invoice_id, "position");

ALTER TABLE ONLY invoice_lines
    ADD CONSTRAINT invoice_lines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY invoice_payments
    ADD CONSTRAINT invoice_payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY invoice_prepayments
    ADD CONSTRAINT invoice_prepayments_pkey PRIMARY KEY (invoice_id, prepayment_id);

ALTER TABLE ONLY invoice_refunds
    ADD CONSTRAINT invoice_refunds_pkey PRIMARY KEY (id);

ALTER TABLE ONLY invoice_settings
    ADD CONSTRAINT invoice_settings_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY invoice_xml_exports
    ADD CONSTRAINT invoice_xml_exports_object_key_key UNIQUE (object_key);

ALTER TABLE ONLY invoice_xml_exports
    ADD CONSTRAINT invoice_xml_exports_pkey PRIMARY KEY (invoice_id, format);

ALTER TABLE ONLY invoice_xml_retention
    ADD CONSTRAINT invoice_xml_retention_pkey PRIMARY KEY (invoice_id, format);

ALTER TABLE ONLY invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY invoices
    ADD CONSTRAINT invoices_workspace_id_kind_number_key UNIQUE (workspace_id, kind, number);

ALTER TABLE ONLY invoices
    ADD CONSTRAINT invoices_workspace_id_payment_reference_key UNIQUE (workspace_id, payment_reference);

ALTER TABLE ONLY ledger_settings
    ADD CONSTRAINT ledger_settings_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY object_retention
    ADD CONSTRAINT object_retention_pkey PRIMARY KEY (object_key);

ALTER TABLE ONLY object_versions
    ADD CONSTRAINT object_versions_pkey PRIMARY KEY (object_key);

ALTER TABLE ONLY passkey_challenges
    ADD CONSTRAINT passkey_challenges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY passkeys
    ADD CONSTRAINT passkeys_credential_id_key UNIQUE (credential_id);

ALTER TABLE ONLY passkeys
    ADD CONSTRAINT passkeys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY plan_limits
    ADD CONSTRAINT plan_limits_pkey PRIMARY KEY (plan, limit_key);

ALTER TABLE ONLY portal_avatars
    ADD CONSTRAINT portal_avatars_pkey PRIMARY KEY (client_id, email);

ALTER TABLE ONLY portal_sessions
    ADD CONSTRAINT portal_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY portal_sessions
    ADD CONSTRAINT portal_sessions_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY product_feedback_files
    ADD CONSTRAINT product_feedback_files_feedback_id_sha256_key UNIQUE (feedback_id, sha256);

ALTER TABLE ONLY product_feedback_files
    ADD CONSTRAINT product_feedback_files_pkey PRIMARY KEY (feedback_id, "position");

ALTER TABLE ONLY product_feedback
    ADD CONSTRAINT product_feedback_pkey PRIMARY KEY (id);

ALTER TABLE ONLY products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY quote_counters
    ADD CONSTRAINT quote_counters_pkey PRIMARY KEY (workspace_id, year);

ALTER TABLE ONLY quotes
    ADD CONSTRAINT quotes_invoice_id_key UNIQUE (invoice_id);

ALTER TABLE ONLY quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY quotes
    ADD CONSTRAINT quotes_workspace_id_number_key UNIQUE (workspace_id, number);

ALTER TABLE ONLY reminder_log
    ADD CONSTRAINT reminder_log_pkey PRIMARY KEY (target_id, seq, kind, offset_days);

ALTER TABLE ONLY self_billing_agreements
    ADD CONSTRAINT self_billing_agreements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY sessions
    ADD CONSTRAINT sessions_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY signature_events
    ADD CONSTRAINT signature_events_pkey PRIMARY KEY (request_id, seq);

ALTER TABLE ONLY signature_fields
    ADD CONSTRAINT signature_fields_pkey PRIMARY KEY (id);

ALTER TABLE ONLY signature_requests
    ADD CONSTRAINT signature_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY signature_signers
    ADD CONSTRAINT signature_signers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY signature_signers
    ADD CONSTRAINT signature_signers_request_id_position_key UNIQUE (request_id, "position");

ALTER TABLE ONLY signature_signers
    ADD CONSTRAINT signature_signers_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY stripe_events
    ADD CONSTRAINT stripe_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY transmission_credentials
    ADD CONSTRAINT transmission_credentials_pkey PRIMARY KEY (workspace_id, channel);

ALTER TABLE ONLY user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (provider, subject);

ALTER TABLE ONLY users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY vat_return_settings
    ADD CONSTRAINT vat_return_settings_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY workspace_ai_consents
    ADD CONSTRAINT workspace_ai_consents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY workspace_billing
    ADD CONSTRAINT workspace_billing_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY workspace_billing
    ADD CONSTRAINT workspace_billing_stripe_customer_id_key UNIQUE (stripe_customer_id);

ALTER TABLE ONLY workspace_counters
    ADD CONSTRAINT workspace_counters_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY workspace_invitations
    ADD CONSTRAINT workspace_invitations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY workspace_invitations
    ADD CONSTRAINT workspace_invitations_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id);

ALTER TABLE ONLY workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);

CREATE INDEX account_login_challenges_expires ON account_login_challenges USING btree (expires_at);

CREATE INDEX ai_token_packs_workspace_period ON ai_token_packs USING btree (workspace_id, period);

CREATE INDEX api_tokens_user ON api_tokens USING btree (user_id);

CREATE INDEX api_tokens_workspace ON api_tokens USING btree (workspace_id);

CREATE UNIQUE INDEX client_change_requests_pending ON client_change_requests USING btree (client_id) WHERE (status = 'pending'::text);

CREATE INDEX client_contacts_client ON client_contacts USING btree (client_id, created_at);

CREATE UNIQUE INDEX client_contacts_one_primary ON client_contacts USING btree (client_id) WHERE is_primary;

CREATE INDEX clients_workspace_created ON clients USING btree (workspace_id, created_at) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX document_folders_name ON document_folders USING btree (workspace_id, COALESCE(parent_id, ''::text), lower(name)) WHERE (deleted_at IS NULL);

CREATE INDEX document_folders_parent ON document_folders USING btree (parent_id);

CREATE INDEX document_folders_trashed_with ON document_folders USING btree (trashed_with) WHERE (trashed_with IS NOT NULL);

CREATE INDEX document_links_target ON document_links USING btree (target_type, target_id);

CREATE INDEX document_shares_client ON document_shares USING btree (workspace_id, client_id, created_at DESC);

CREATE INDEX documents_folder ON documents USING btree (workspace_id, folder_id) WHERE (deleted_at IS NULL);

CREATE INDEX documents_trash ON documents USING btree (workspace_id, deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX documents_trashed_with ON documents USING btree (trashed_with) WHERE (trashed_with IS NOT NULL);

CREATE INDEX documents_workspace_sha256 ON documents USING btree (workspace_id, sha256) WHERE ((sha256 IS NOT NULL) AND (deleted_at IS NULL));

CREATE INDEX dunning_notices_recent ON dunning_notices USING btree (workspace_id, sent_at);

CREATE INDEX einvoice_transmissions_due ON einvoice_transmissions USING btree (next_attempt_at) WHERE (status = 'queued'::text);

CREATE INDEX einvoice_transmissions_invoice ON einvoice_transmissions USING btree (workspace_id, invoice_id);

CREATE UNIQUE INDEX einvoice_transmissions_once ON einvoice_transmissions USING btree (invoice_id, channel, format);

CREATE INDEX email_codes_email ON email_codes USING btree (email, created_at);

CREATE INDEX engagement_entries_period ON engagement_entries USING btree (period_id, date DESC);

CREATE UNIQUE INDEX engagement_notices_once ON engagement_notices USING btree (period_id, kind, COALESCE(invoice_id, ''::text));

CREATE INDEX engagement_notices_pending ON engagement_notices USING btree (engagement_id) WHERE (notified_at IS NULL);

CREATE INDEX engagements_workspace_client ON engagements USING btree (workspace_id, client_id) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX expense_categories_name ON expense_categories USING btree (workspace_id, lower(name));

CREATE INDEX expense_receipts_expense ON expense_receipts USING btree (expense_id, created_at);

CREATE INDEX expense_receipts_workspace_sha256 ON expense_receipts USING btree (workspace_id, sha256) WHERE (sha256 IS NOT NULL);

CREATE INDEX expenses_category ON expenses USING btree (category_id) WHERE (category_id IS NOT NULL);

CREATE INDEX expenses_workspace_date ON expenses USING btree (workspace_id, document_date DESC, number DESC) WHERE (deleted_at IS NULL);

CREATE INDEX heidi_messages_conversation ON heidi_messages USING btree (workspace_id, user_id, conversation_id, "position");

CREATE INDEX import_batches_owner ON import_batches USING btree (workspace_id, user_id, kind, created_at DESC);

CREATE INDEX import_files_due ON import_files USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['queued'::text, 'extracting'::text]));

CREATE INDEX instalment_plan_items_due ON instalment_plan_items USING btree (issue_on) WHERE (invoice_id IS NULL);

CREATE INDEX instalment_plans_source ON instalment_plans USING btree (source_invoice_id);

CREATE INDEX instalment_plans_workspace ON instalment_plans USING btree (workspace_id, client_id);

CREATE INDEX invoice_deliveries_invoice ON invoice_deliveries USING btree (invoice_id, sent_at);

CREATE INDEX invoice_payments_invoice ON invoice_payments USING btree (invoice_id, paid_on);

CREATE INDEX invoice_refunds_invoice ON invoice_refunds USING btree (invoice_id, refunded_on);

CREATE INDEX invoices_client ON invoices USING btree (client_id);

CREATE INDEX invoices_credited ON invoices USING btree (credited_invoice_id) WHERE (credited_invoice_id IS NOT NULL);

CREATE INDEX invoices_open_plan ON invoices USING btree (plan_id) WHERE ((status = 'open'::text) AND (plan_id IS NOT NULL));

CREATE INDEX invoices_open_scheduled ON invoices USING btree (id) WHERE ((status = 'open'::text) AND (instalment_interval IS NOT NULL));

CREATE INDEX invoices_workspace_issue ON invoices USING btree (workspace_id, issue_date DESC, created_at DESC);

CREATE INDEX notifications_email_due ON notifications USING btree (created_at) WHERE (emailed_at IS NULL);

CREATE INDEX notifications_inbox ON notifications USING btree (user_id, workspace_id, id DESC) WHERE in_app;

CREATE UNIQUE INDEX notifications_once ON notifications USING btree (user_id, workspace_id, once_key) WHERE (once_key IS NOT NULL);

CREATE INDEX notifications_unread ON notifications USING btree (user_id, workspace_id) WHERE (in_app AND (read_at IS NULL));

CREATE INDEX object_retention_due ON object_retention USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));

CREATE INDEX object_retention_workspace ON object_retention USING btree (workspace_id, status);

CREATE INDEX passkey_challenges_created ON passkey_challenges USING btree (created_at);

CREATE INDEX passkeys_user ON passkeys USING btree (user_id);

CREATE INDEX portal_avatars_workspace ON portal_avatars USING btree (workspace_id);

CREATE INDEX portal_sessions_client ON portal_sessions USING btree (client_id);

CREATE INDEX product_feedback_user ON product_feedback USING btree (user_id, created_at);

CREATE UNIQUE INDEX products_sku ON products USING btree (workspace_id, lower(sku)) WHERE ((sku IS NOT NULL) AND (deleted_at IS NULL) AND (archived_at IS NULL));

CREATE INDEX products_workspace_name ON products USING btree (workspace_id, lower(name)) WHERE (deleted_at IS NULL);

CREATE INDEX quotes_client ON quotes USING btree (client_id);

CREATE INDEX quotes_workspace ON quotes USING btree (workspace_id, created_at DESC);

CREATE INDEX self_billing_agreements_client ON self_billing_agreements USING btree (workspace_id, client_id, starts_on);

CREATE INDEX sessions_expires ON sessions USING btree (expires_at);

CREATE INDEX sessions_user ON sessions USING btree (user_id);

CREATE INDEX signature_fields_request ON signature_fields USING btree (request_id, "position");

CREATE INDEX signature_requests_document ON signature_requests USING btree (document_id);

CREATE INDEX signature_requests_workspace ON signature_requests USING btree (workspace_id, created_at DESC);

CREATE INDEX templates_document ON templates USING btree (document_id);

CREATE INDEX templates_workspace ON templates USING btree (workspace_id, updated_at DESC);

CREATE INDEX user_identities_user ON user_identities USING btree (user_id);

CREATE INDEX workspace_ai_consents_latest ON workspace_ai_consents USING btree (workspace_id, id DESC);

CREATE INDEX workspace_invitations_email ON workspace_invitations USING btree (email);

CREATE UNIQUE INDEX workspace_invitations_open ON workspace_invitations USING btree (workspace_id, email) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));

CREATE INDEX workspace_members_user ON workspace_members USING btree (user_id);

CREATE TRIGGER financial_events_append_only BEFORE DELETE OR UPDATE ON financial_events FOR EACH ROW EXECUTE FUNCTION financial_events_append_only();

CREATE TRIGGER financial_events_no_truncate BEFORE TRUNCATE ON financial_events FOR EACH STATEMENT EXECUTE FUNCTION financial_events_append_only();

CREATE TRIGGER identity_active_account BEFORE INSERT OR UPDATE OF user_id ON user_identities FOR EACH ROW EXECUTE FUNCTION require_active_account();

CREATE TRIGGER invoice_xml_exports_append_only BEFORE DELETE OR UPDATE ON invoice_xml_exports FOR EACH ROW EXECUTE FUNCTION invoice_xml_append_only();

CREATE TRIGGER invoice_xml_exports_no_truncate BEFORE TRUNCATE ON invoice_xml_exports FOR EACH STATEMENT EXECUTE FUNCTION invoice_xml_append_only();

CREATE TRIGGER invoice_xml_retention_append_only BEFORE DELETE OR UPDATE ON invoice_xml_retention FOR EACH ROW EXECUTE FUNCTION invoice_xml_append_only();

CREATE TRIGGER invoice_xml_retention_no_truncate BEFORE TRUNCATE ON invoice_xml_retention FOR EACH STATEMENT EXECUTE FUNCTION invoice_xml_append_only();

CREATE TRIGGER login_challenge_active_account BEFORE INSERT OR UPDATE OF user_id ON account_login_challenges FOR EACH ROW EXECUTE FUNCTION require_active_account();

CREATE TRIGGER passkey_active_account BEFORE INSERT OR UPDATE OF user_id ON passkeys FOR EACH ROW EXECUTE FUNCTION require_active_account();

CREATE TRIGGER passkey_challenge_active_account BEFORE INSERT OR UPDATE OF user_id ON passkey_challenges FOR EACH ROW EXECUTE FUNCTION require_active_account();

CREATE TRIGGER recovery_code_active_account BEFORE INSERT OR UPDATE OF user_id ON account_recovery_codes FOR EACH ROW EXECUTE FUNCTION require_active_account();

CREATE TRIGGER session_active_account BEFORE INSERT OR UPDATE OF user_id ON sessions FOR EACH ROW EXECUTE FUNCTION require_active_account();

CREATE TRIGGER signature_events_append_only BEFORE DELETE OR UPDATE ON signature_events FOR EACH ROW EXECUTE FUNCTION signature_events_append_only();

CREATE TRIGGER signature_events_no_truncate BEFORE TRUNCATE ON signature_events FOR EACH STATEMENT EXECUTE FUNCTION signature_events_append_only();

CREATE TRIGGER two_factor_active_account BEFORE INSERT OR UPDATE OF user_id ON account_two_factor FOR EACH ROW EXECUTE FUNCTION require_active_account();

CREATE TRIGGER workspace_member_active_account BEFORE INSERT OR UPDATE OF user_id ON workspace_members FOR EACH ROW EXECUTE FUNCTION require_active_account();

ALTER TABLE ONLY account_login_challenges
    ADD CONSTRAINT account_login_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY account_login_challenges
    ADD CONSTRAINT account_login_challenges_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY account_recovery_codes
    ADD CONSTRAINT account_recovery_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY account_two_factor
    ADD CONSTRAINT account_two_factor_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY ai_token_packs
    ADD CONSTRAINT ai_token_packs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY api_tokens
    ADD CONSTRAINT api_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY api_tokens
    ADD CONSTRAINT api_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY client_change_requests
    ADD CONSTRAINT client_change_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE ONLY client_change_requests
    ADD CONSTRAINT client_change_requests_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES client_contacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY client_change_requests
    ADD CONSTRAINT client_change_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY client_change_requests
    ADD CONSTRAINT client_change_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY client_contacts
    ADD CONSTRAINT client_contacts_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE ONLY client_contacts
    ADD CONSTRAINT client_contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY clients
    ADD CONSTRAINT clients_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY closed_periods
    ADD CONSTRAINT closed_periods_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY closed_periods
    ADD CONSTRAINT closed_periods_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY digest_days
    ADD CONSTRAINT digest_days_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY document_folder_stars
    ADD CONSTRAINT document_folder_stars_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES document_folders(id) ON DELETE CASCADE;

ALTER TABLE ONLY document_folder_stars
    ADD CONSTRAINT document_folder_stars_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY document_folder_stars
    ADD CONSTRAINT document_folder_stars_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY document_folders
    ADD CONSTRAINT document_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY document_folders
    ADD CONSTRAINT document_folders_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY document_folders
    ADD CONSTRAINT document_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES document_folders(id) ON DELETE SET NULL;

ALTER TABLE ONLY document_folders
    ADD CONSTRAINT document_folders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY document_links
    ADD CONSTRAINT document_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY document_links
    ADD CONSTRAINT document_links_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY document_links
    ADD CONSTRAINT document_links_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY document_shares
    ADD CONSTRAINT document_shares_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE ONLY document_shares
    ADD CONSTRAINT document_shares_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

ALTER TABLE ONLY document_shares
    ADD CONSTRAINT document_shares_shared_by_fkey FOREIGN KEY (shared_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY document_shares
    ADD CONSTRAINT document_shares_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY documents
    ADD CONSTRAINT documents_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY documents
    ADD CONSTRAINT documents_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES document_folders(id) ON DELETE SET NULL;

ALTER TABLE ONLY documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY documents
    ADD CONSTRAINT documents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY dunning_notices
    ADD CONSTRAINT dunning_notices_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);

ALTER TABLE ONLY dunning_notices
    ADD CONSTRAINT dunning_notices_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY dunning_notices
    ADD CONSTRAINT dunning_notices_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY einvoice_transmissions
    ADD CONSTRAINT einvoice_transmissions_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

ALTER TABLE ONLY einvoice_transmissions
    ADD CONSTRAINT einvoice_transmissions_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);

ALTER TABLE ONLY einvoice_transmissions
    ADD CONSTRAINT einvoice_transmissions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY engagement_entries
    ADD CONSTRAINT engagement_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY engagement_entries
    ADD CONSTRAINT engagement_entries_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE;

ALTER TABLE ONLY engagement_entries
    ADD CONSTRAINT engagement_entries_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE ONLY engagement_entries
    ADD CONSTRAINT engagement_entries_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY engagement_entries
    ADD CONSTRAINT engagement_entries_period_id_fkey FOREIGN KEY (period_id) REFERENCES engagement_periods(id) ON DELETE CASCADE;

ALTER TABLE ONLY engagement_invoices
    ADD CONSTRAINT engagement_invoices_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY engagement_invoices
    ADD CONSTRAINT engagement_invoices_period_id_fkey FOREIGN KEY (period_id) REFERENCES engagement_periods(id) ON DELETE CASCADE;

ALTER TABLE ONLY engagement_notices
    ADD CONSTRAINT engagement_notices_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE;

ALTER TABLE ONLY engagement_notices
    ADD CONSTRAINT engagement_notices_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE ONLY engagement_notices
    ADD CONSTRAINT engagement_notices_period_id_fkey FOREIGN KEY (period_id) REFERENCES engagement_periods(id) ON DELETE CASCADE;

ALTER TABLE ONLY engagement_periods
    ADD CONSTRAINT engagement_periods_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE;

ALTER TABLE ONLY engagement_settings
    ADD CONSTRAINT engagement_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY engagements
    ADD CONSTRAINT engagements_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);

ALTER TABLE ONLY engagements
    ADD CONSTRAINT engagements_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;

ALTER TABLE ONLY engagements
    ADD CONSTRAINT engagements_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE ONLY engagements
    ADD CONSTRAINT engagements_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY expense_categories
    ADD CONSTRAINT expense_categories_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY expense_lines
    ADD CONSTRAINT expense_lines_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE;

ALTER TABLE ONLY expense_receipts
    ADD CONSTRAINT expense_receipts_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE;

ALTER TABLE ONLY expense_receipts
    ADD CONSTRAINT expense_receipts_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY expense_receipts
    ADD CONSTRAINT expense_receipts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY expenses
    ADD CONSTRAINT expenses_booked_by_fkey FOREIGN KEY (booked_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY expenses
    ADD CONSTRAINT expenses_category_id_fkey FOREIGN KEY (category_id) REFERENCES expense_categories(id);

ALTER TABLE ONLY expenses
    ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY expenses
    ADD CONSTRAINT expenses_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY expenses
    ADD CONSTRAINT expenses_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY expenses
    ADD CONSTRAINT expenses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY financial_events
    ADD CONSTRAINT financial_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY heidi_confirmations
    ADD CONSTRAINT heidi_confirmations_workspace_id_user_id_conversation_id_fkey FOREIGN KEY (workspace_id, user_id, conversation_id) REFERENCES heidi_conversations(workspace_id, user_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY heidi_conversations
    ADD CONSTRAINT heidi_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY heidi_conversations
    ADD CONSTRAINT heidi_conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY heidi_messages
    ADD CONSTRAINT heidi_messages_workspace_id_user_id_conversation_id_fkey FOREIGN KEY (workspace_id, user_id, conversation_id) REFERENCES heidi_conversations(workspace_id, user_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY heidi_usage
    ADD CONSTRAINT heidi_usage_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY import_batches
    ADD CONSTRAINT import_batches_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY import_batches
    ADD CONSTRAINT import_batches_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY import_files
    ADD CONSTRAINT import_files_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE;

ALTER TABLE ONLY import_files
    ADD CONSTRAINT import_files_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY import_records
    ADD CONSTRAINT import_records_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE;

ALTER TABLE ONLY import_records
    ADD CONSTRAINT import_records_file_id_fkey FOREIGN KEY (file_id) REFERENCES import_files(id) ON DELETE CASCADE;

ALTER TABLE ONLY import_records
    ADD CONSTRAINT import_records_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY instalment_plan_items
    ADD CONSTRAINT instalment_plan_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);

ALTER TABLE ONLY instalment_plan_items
    ADD CONSTRAINT instalment_plan_items_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES instalment_plans(id) ON DELETE CASCADE;

ALTER TABLE ONLY instalment_plans
    ADD CONSTRAINT instalment_plans_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);

ALTER TABLE ONLY instalment_plans
    ADD CONSTRAINT instalment_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY instalment_plans
    ADD CONSTRAINT instalment_plans_source_invoice_id_fkey FOREIGN KEY (source_invoice_id) REFERENCES invoices(id);

ALTER TABLE ONLY instalment_plans
    ADD CONSTRAINT instalment_plans_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_counters
    ADD CONSTRAINT invoice_counters_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_deliveries
    ADD CONSTRAINT invoice_deliveries_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_deliveries
    ADD CONSTRAINT invoice_deliveries_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY invoice_instalments
    ADD CONSTRAINT invoice_instalments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_lines
    ADD CONSTRAINT invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_payments
    ADD CONSTRAINT invoice_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY invoice_payments
    ADD CONSTRAINT invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_prepayments
    ADD CONSTRAINT invoice_prepayments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_prepayments
    ADD CONSTRAINT invoice_prepayments_prepayment_id_fkey FOREIGN KEY (prepayment_id) REFERENCES invoices(id);

ALTER TABLE ONLY invoice_refunds
    ADD CONSTRAINT invoice_refunds_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY invoice_refunds
    ADD CONSTRAINT invoice_refunds_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_settings
    ADD CONSTRAINT invoice_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_xml_exports
    ADD CONSTRAINT invoice_xml_exports_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;

ALTER TABLE ONLY invoice_xml_retention
    ADD CONSTRAINT invoice_xml_retention_invoice_id_format_fkey FOREIGN KEY (invoice_id, format) REFERENCES invoice_xml_exports(invoice_id, format) ON DELETE CASCADE;

ALTER TABLE ONLY invoices
    ADD CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);

ALTER TABLE ONLY invoices
    ADD CONSTRAINT invoices_credited_invoice_id_fkey FOREIGN KEY (credited_invoice_id) REFERENCES invoices(id);

ALTER TABLE ONLY invoices
    ADD CONSTRAINT invoices_deducted_on_invoice_id_fkey FOREIGN KEY (deducted_on_invoice_id) REFERENCES invoices(id);

ALTER TABLE ONLY invoices
    ADD CONSTRAINT invoices_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES instalment_plans(id);

ALTER TABLE ONLY invoices
    ADD CONSTRAINT invoices_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES documents(id);

ALTER TABLE ONLY invoices
    ADD CONSTRAINT invoices_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY ledger_settings
    ADD CONSTRAINT ledger_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY ledger_settings
    ADD CONSTRAINT ledger_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY passkey_challenges
    ADD CONSTRAINT passkey_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY passkeys
    ADD CONSTRAINT passkeys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY portal_avatars
    ADD CONSTRAINT portal_avatars_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE ONLY portal_avatars
    ADD CONSTRAINT portal_avatars_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY portal_sessions
    ADD CONSTRAINT portal_sessions_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE ONLY portal_sessions
    ADD CONSTRAINT portal_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY product_feedback_files
    ADD CONSTRAINT product_feedback_files_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES product_feedback(id) ON DELETE CASCADE;

ALTER TABLE ONLY product_feedback
    ADD CONSTRAINT product_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY product_feedback
    ADD CONSTRAINT product_feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY products
    ADD CONSTRAINT products_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY quote_counters
    ADD CONSTRAINT quote_counters_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY quotes
    ADD CONSTRAINT quotes_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);

ALTER TABLE ONLY quotes
    ADD CONSTRAINT quotes_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE ONLY quotes
    ADD CONSTRAINT quotes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY reminder_log
    ADD CONSTRAINT reminder_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY self_billing_agreements
    ADD CONSTRAINT self_billing_agreements_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE ONLY self_billing_agreements
    ADD CONSTRAINT self_billing_agreements_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY sessions
    ADD CONSTRAINT sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY signature_events
    ADD CONSTRAINT signature_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES signature_requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY signature_fields
    ADD CONSTRAINT signature_fields_request_id_fkey FOREIGN KEY (request_id) REFERENCES signature_requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY signature_fields
    ADD CONSTRAINT signature_fields_signer_id_fkey FOREIGN KEY (signer_id) REFERENCES signature_signers(id) ON DELETE CASCADE;

ALTER TABLE ONLY signature_requests
    ADD CONSTRAINT signature_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY signature_requests
    ADD CONSTRAINT signature_requests_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;

ALTER TABLE ONLY signature_requests
    ADD CONSTRAINT signature_requests_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES document_folders(id) ON DELETE SET NULL;

ALTER TABLE ONLY signature_requests
    ADD CONSTRAINT signature_requests_signed_document_id_fkey FOREIGN KEY (signed_document_id) REFERENCES documents(id) ON DELETE SET NULL;

ALTER TABLE ONLY signature_requests
    ADD CONSTRAINT signature_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY signature_signers
    ADD CONSTRAINT signature_signers_request_id_fkey FOREIGN KEY (request_id) REFERENCES signature_requests(id) ON DELETE CASCADE;

ALTER TABLE ONLY templates
    ADD CONSTRAINT templates_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;

ALTER TABLE ONLY templates
    ADD CONSTRAINT templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY transmission_credentials
    ADD CONSTRAINT transmission_credentials_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);

ALTER TABLE ONLY transmission_credentials
    ADD CONSTRAINT transmission_credentials_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY user_identities
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY vat_return_settings
    ADD CONSTRAINT vat_return_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY vat_return_settings
    ADD CONSTRAINT vat_return_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY workspace_ai_consents
    ADD CONSTRAINT workspace_ai_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE ONLY workspace_ai_consents
    ADD CONSTRAINT workspace_ai_consents_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

ALTER TABLE ONLY workspace_billing
    ADD CONSTRAINT workspace_billing_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY workspace_counters
    ADD CONSTRAINT workspace_counters_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY workspace_invitations
    ADD CONSTRAINT workspace_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY workspace_invitations
    ADD CONSTRAINT workspace_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE ONLY workspace_invitations
    ADD CONSTRAINT workspace_invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

INSERT INTO plan_limits VALUES
	('basic', 'members', 2),
	('basic', 'clients', 50),
	('basic', 'invoices_per_month', 30),
	('basic', 'expenses_per_month', 60),
	('basic', 'products', 25),
	('basic', 'engagements', 3),
	('basic', 'signatures_per_month', 5),
	('basic', 'storage_bytes', 5368709120),
	('pro', 'members', 10),
	('pro', 'clients', 1000),
	('pro', 'invoices_per_month', 300),
	('pro', 'expenses_per_month', 600),
	('pro', 'products', 500),
	('pro', 'engagements', 50),
	('pro', 'signatures_per_month', 50),
	('pro', 'storage_bytes', 107374182400),
	('business', 'members', NULL),
	('business', 'clients', NULL),
	('business', 'invoices_per_month', NULL),
	('business', 'expenses_per_month', NULL),
	('business', 'products', NULL),
	('business', 'engagements', NULL),
	('business', 'signatures_per_month', NULL),
	('business', 'storage_bytes', 1099511627776),
	('basic', 'ai_tokens_per_month', 1000000),
	('pro', 'ai_tokens_per_month', 5000000),
	('business', 'ai_tokens_per_month', 20000000);

-- +goose Down
DROP TABLE account_login_challenges, account_recovery_codes, account_two_factor, ai_token_packs, api_tokens, client_change_requests, client_contacts, clients, closed_periods, digest_days, document_folder_stars, document_folders, document_links, document_shares, documents, dunning_notices, einvoice_transmissions, email_codes, engagement_entries, engagement_invoices, engagement_notices, engagement_periods, engagement_settings, engagements, expense_categories, expense_lines, expense_receipts, expenses, financial_events, heidi_confirmations, heidi_conversations, heidi_messages, heidi_usage, import_batches, import_files, import_records, instalment_plan_items, instalment_plans, invoice_counters, invoice_deliveries, invoice_instalments, invoice_lines, invoice_payments, invoice_prepayments, invoice_refunds, invoice_settings, invoice_xml_exports, invoice_xml_retention, invoices, ledger_settings, notifications, object_retention, object_versions, passkey_challenges, passkeys, plan_limits, portal_avatars, portal_sessions, product_feedback, product_feedback_files, products, quote_counters, quotes, reminder_log, self_billing_agreements, sessions, signature_events, signature_fields, signature_requests, signature_signers, stripe_events, templates, transmission_credentials, user_identities, users, vat_return_settings, workspace_ai_consents, workspace_billing, workspace_counters, workspace_invitations, workspace_members, workspaces CASCADE;
DROP FUNCTION financial_events_append_only();
DROP FUNCTION invoice_xml_append_only();
DROP FUNCTION require_active_account();
DROP FUNCTION signature_events_append_only();
