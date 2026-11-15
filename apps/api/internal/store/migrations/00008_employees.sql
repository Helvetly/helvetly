-- Employees: the workspace company's own staff (not members), their pay terms, private employment documents and a
-- payroll register with approval separate from payment. Approved payroll figures never change: a correction is a new
-- entry, and the triggers below refuse edits and deletes of approved entries outside a workspace purge. Child rows
-- cascade so a purge can delete a workspace; the API itself deletes only employees and entries without history.

-- +goose Up
CREATE TABLE employment_settings (
    workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    employing_entity text,
    country text CHECK (country ~ '^[A-Z]{2}$'),
    region text,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE employees (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    member_user_id text REFERENCES users(id) ON DELETE SET NULL,
    employee_number text,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    phone text,
    street text,
    postal_code text,
    city text,
    address_country text CHECK (address_country ~ '^[A-Z]{2}$'),
    position text,
    department text,
    employment_type text NOT NULL CHECK (employment_type IN ('permanent', 'fixed_term', 'temporary', 'apprentice', 'other')),
    working_time_percent integer CHECK (working_time_percent BETWEEN 1 AND 10000),
    employment_start date NOT NULL,
    employment_end date CHECK (employment_end >= employment_start),
    employing_entity text NOT NULL,
    employer_country text NOT NULL CHECK (employer_country ~ '^[A-Z]{2}$'),
    work_country text NOT NULL CHECK (work_country ~ '^[A-Z]{2}$'),
    work_region text,
    work_locality text,
    place_of_work text,
    residence_country text CHECK (residence_country ~ '^[A-Z]{2}$'),
    social_security_country text CHECK (social_security_country ~ '^[A-Z]{2}$'),
    cross_border boolean NOT NULL DEFAULT false,
    cross_border_note text,
    bank_account_sealed bytea,
    bank_account_hint text,
    tax_id_sealed bytea,
    tax_id_hint text,
    legal_hold boolean NOT NULL DEFAULT false,
    legal_hold_reason text,
    restricted boolean NOT NULL DEFAULT false,
    erased_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_by text REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX employees_number ON employees (workspace_id, lower(employee_number)) WHERE employee_number IS NOT NULL;
CREATE INDEX employees_workspace ON employees (workspace_id, lower(last_name), lower(first_name));
CREATE UNIQUE INDEX employees_member ON employees (workspace_id, member_user_id) WHERE member_user_id IS NOT NULL;

CREATE TABLE employee_pay_terms (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    effective_from date NOT NULL,
    basis text NOT NULL CHECK (basis IN ('monthly', 'hourly')),
    amount bigint NOT NULL CHECK (amount > 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    frequency text NOT NULL CHECK (frequency IN ('monthly', 'semimonthly', 'biweekly', 'weekly')),
    note text,
    created_by text REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL,
    UNIQUE (employee_id, effective_from)
);

-- +goose StatementBegin
CREATE FUNCTION pay_terms_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; -- the API deletes only terms not yet in effect
    RAISE EXCEPTION 'pay terms are append-only';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER pay_terms_append_only BEFORE UPDATE ON employee_pay_terms FOR EACH ROW EXECUTE FUNCTION pay_terms_append_only();

ALTER TABLE documents ADD COLUMN employee_id text REFERENCES employees(id) ON DELETE CASCADE,
    ADD COLUMN hr_private boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT documents_employee_private CHECK (employee_id IS NULL OR hr_private);
CREATE INDEX documents_employee ON documents (employee_id) WHERE employee_id IS NOT NULL;

CREATE TABLE employee_documents (
    document_id text PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('employment_contract', 'contract_amendment', 'termination_document', 'personnel_file',
        'payslip', 'payroll_record', 'tax_withholding_record', 'social_security_record', 'time_record', 'work_permit_copy',
        'id_document_copy', 'other')),
    document_date date,
    retain_until date,
    retention_rule text,
    legal_hold boolean NOT NULL DEFAULT false
);
CREATE INDEX employee_documents_employee ON employee_documents (employee_id);

CREATE TABLE payroll_entries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    employing_entity text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL CHECK (period_end >= period_start),
    pay_date date,
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    gross bigint CHECK (gross >= 0),
    deductions bigint CHECK (deductions >= 0),
    net bigint,
    employer_costs bigint CHECK (employer_costs >= 0),
    source text NOT NULL CHECK (source IN ('manual', 'import', 'external')),
    source_ref text,
    document_id text REFERENCES documents(id) ON DELETE SET NULL, -- the employee's HR file behind the figures
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
    payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
    paid_on date,
    approved_by text REFERENCES users(id) ON DELETE SET NULL,
    approved_at timestamp with time zone,
    supersedes_id text UNIQUE REFERENCES payroll_entries(id) ON DELETE CASCADE,
    superseded_by text REFERENCES payroll_entries(id) ON DELETE CASCADE,
    version integer NOT NULL DEFAULT 1,
    note text,
    created_by text REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CHECK ((payment_status = 'paid') = (paid_on IS NOT NULL)),
    CHECK (payment_status = 'unpaid' OR status = 'approved'),
    CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);
-- One original entry per employee and period; corrections hang off it.
CREATE UNIQUE INDEX payroll_entries_period ON payroll_entries (workspace_id, employee_id, period_start, period_end)
    WHERE supersedes_id IS NULL;
CREATE INDEX payroll_entries_month ON payroll_entries (workspace_id, period_end);

CREATE TABLE payroll_components (
    entry_id text NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
    position integer NOT NULL,
    kind text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_cost')),
    label text NOT NULL,
    amount bigint NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (entry_id, position)
);

-- +goose StatementBegin
CREATE FUNCTION payroll_approved_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF current_setting('helvetly.purge', true) = 'on' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'approved' THEN RAISE EXCEPTION 'an approved payroll entry cannot be deleted'; END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'approved' AND (NEW.status, NEW.employee_id, NEW.employing_entity, NEW.period_start, NEW.period_end,
        NEW.pay_date, NEW.currency, NEW.gross, NEW.deductions, NEW.net, NEW.employer_costs, NEW.source, NEW.source_ref,
        NEW.supersedes_id, NEW.approved_by, NEW.approved_at, NEW.note)
        IS DISTINCT FROM (OLD.status, OLD.employee_id, OLD.employing_entity, OLD.period_start, OLD.period_end,
        OLD.pay_date, OLD.currency, OLD.gross, OLD.deductions, OLD.net, OLD.employer_costs, OLD.source, OLD.source_ref,
        OLD.supersedes_id, OLD.approved_by, OLD.approved_at, OLD.note) THEN
        RAISE EXCEPTION 'an approved payroll entry cannot be changed; record a correction';
    END IF;
    IF OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
        RAISE EXCEPTION 'a superseded payroll entry stays superseded';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER payroll_approved_immutable BEFORE UPDATE OR DELETE ON payroll_entries FOR EACH ROW EXECUTE FUNCTION payroll_approved_immutable();

-- +goose StatementBegin
CREATE FUNCTION payroll_components_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE entry text := CASE WHEN TG_OP = 'INSERT' THEN NEW.entry_id ELSE OLD.entry_id END;
BEGIN
    IF current_setting('helvetly.purge', true) = 'on' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    PERFORM 1 FROM payroll_entries WHERE id = entry AND status = 'approved';
    IF FOUND THEN RAISE EXCEPTION 'an approved payroll entry cannot be changed; record a correction'; END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER payroll_components_immutable BEFORE INSERT OR UPDATE OR DELETE ON payroll_components FOR EACH ROW EXECUTE FUNCTION payroll_components_immutable();

CREATE TABLE payroll_bookings (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    up_to date NOT NULL,
    base_currency text NOT NULL,
    accounts jsonb NOT NULL,
    created_by text REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL
);

-- An entry is booked once per kind: the accrual, the payment, and the reversal of an accrual a correction replaced.
CREATE TABLE payroll_booking_items (
    booking_id text NOT NULL REFERENCES payroll_bookings(id) ON DELETE CASCADE,
    entry_id text NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('accrual', 'payment', 'reversal')),
    PRIMARY KEY (entry_id, kind)
);
CREATE INDEX payroll_booking_items_booking ON payroll_booking_items (booking_id);

ALTER TABLE import_batches DROP CONSTRAINT import_batches_kind_check,
    ADD CONSTRAINT import_batches_kind_check CHECK ((kind = ANY (ARRAY['clients'::text, 'products'::text, 'expenses'::text, 'invoices'::text, 'engagements'::text, 'auto'::text, 'payroll'::text])));

-- +goose Down
DELETE FROM import_batches WHERE kind = 'payroll';
ALTER TABLE import_batches DROP CONSTRAINT import_batches_kind_check,
    ADD CONSTRAINT import_batches_kind_check CHECK ((kind = ANY (ARRAY['clients'::text, 'products'::text, 'expenses'::text, 'invoices'::text, 'engagements'::text, 'auto'::text])));
DROP TABLE payroll_booking_items, payroll_bookings, payroll_components, payroll_entries, employee_documents;
DROP FUNCTION payroll_components_immutable(), payroll_approved_immutable();
DELETE FROM documents WHERE hr_private;
ALTER TABLE documents DROP COLUMN hr_private, DROP COLUMN employee_id;
DROP TABLE employee_pay_terms, employees, employment_settings;
DROP FUNCTION pay_terms_append_only();
