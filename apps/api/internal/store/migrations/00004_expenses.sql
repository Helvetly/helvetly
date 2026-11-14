-- +goose Up
-- Expenses, their VAT lines and receipts, and the workspace's expense categories (internal/expenses,
-- docs/expenses-contract.md). Money in minor units, VAT rates and percentages in hundredths of a percent,
-- exchange rates in millionths: exact, never floating point.

ALTER TABLE workspace_counters ADD COLUMN expenses_seq bigint NOT NULL DEFAULT 0;

-- Seeded with KMU-Kontenrahmen defaults on a workspace's first read; archived, never deleted, once used.
CREATE TABLE expense_categories (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name         text NOT NULL,
    account_code text NOT NULL,
    archived_at  timestamptz,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX expense_categories_name ON expense_categories (workspace_id, lower(name));

CREATE TABLE expenses (
    id                   text PRIMARY KEY,
    workspace_id         text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    number               bigint NOT NULL,
    status               text NOT NULL CHECK (status IN ('draft', 'booked', 'void')),
    source               text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
    supplier_name        text,
    supplier_vat_number  text,
    reference            text,
    description          text,
    category_id          text REFERENCES expense_categories (id),
    document_date        date,
    due_date             date,
    currency             text NOT NULL,
    amount_mode          text NOT NULL CHECK (amount_mode IN ('gross', 'net')),
    input_tax            text NOT NULL CHECK (input_tax IN ('full', 'partial', 'none')),
    deductible_percent   integer NOT NULL CHECK (deductible_percent BETWEEN 0 AND 10000),
    net_total            bigint NOT NULL,
    vat_total            bigint NOT NULL,
    total                bigint NOT NULL,
    deductible_vat       bigint NOT NULL,
    vat_breakdown        jsonb NOT NULL,
    exchange_rate        bigint NOT NULL CHECK (exchange_rate > 0),
    exchange_rate_date   date,
    exchange_rate_source text CHECK (exchange_rate_source IN ('estv_monthly', 'estv_daily', 'bank', 'manual')),
    base_currency        text NOT NULL, -- the workspace currency when last computed; the base amounts are in it
    base_net_total       bigint NOT NULL,
    base_vat_total       bigint NOT NULL,
    base_total           bigint NOT NULL,
    base_deductible_vat  bigint NOT NULL,
    payment_status       text NOT NULL CHECK (payment_status IN ('unpaid', 'paid')),
    paid_on              date,
    payment_method       text CHECK (payment_method IN ('bank_transfer', 'cash', 'card', 'twint', 'other')),
    paid_by              text REFERENCES users (id) ON DELETE SET NULL, -- a member who paid out of pocket
    reimbursed_on        date,
    note                 text,
    receipt_missing_reason text,
    created_by           text REFERENCES users (id) ON DELETE SET NULL,
    booked_at            timestamptz,
    booked_by            text REFERENCES users (id) ON DELETE SET NULL,
    voided_at            timestamptz,
    voided_by            text REFERENCES users (id) ON DELETE SET NULL,
    void_reason          text,
    created_at           timestamptz NOT NULL,
    updated_at           timestamptz NOT NULL,
    deleted_at           timestamptz, -- drafts only; booked and void expenses are kept (GeBüV)
    UNIQUE (workspace_id, number),
    CHECK ((status = 'draft') = (booked_at IS NULL)),
    CHECK (deleted_at IS NULL OR status = 'draft')
);
CREATE INDEX expenses_workspace_date ON expenses (workspace_id, document_date DESC, number DESC) WHERE deleted_at IS NULL;
CREATE INDEX expenses_category ON expenses (category_id) WHERE category_id IS NOT NULL;

CREATE TABLE expense_lines (
    id          text PRIMARY KEY,
    expense_id  text NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
    position    integer NOT NULL,
    description text,
    amount      bigint NOT NULL CHECK (amount >= 0),
    vat_rate    integer NOT NULL CHECK (vat_rate BETWEEN 0 AND 10000),
    UNIQUE (expense_id, position)
);

CREATE TABLE expense_receipts (
    id           text PRIMARY KEY,
    expense_id   text NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    object_key   text NOT NULL UNIQUE,
    name         text NOT NULL,
    size         bigint NOT NULL,
    content_type text NOT NULL,
    uploaded_by  text REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL
);
CREATE INDEX expense_receipts_expense ON expense_receipts (expense_id, created_at);

-- +goose Down
DROP TABLE expense_receipts, expense_lines, expenses, expense_categories;
ALTER TABLE workspace_counters DROP COLUMN expenses_seq;
