-- +goose Up
-- Invoices and credit notes, their lines, payments and email deliveries, and the seller profile
-- (internal/invoices, docs/invoices-contract.md). Money is in minor units (bigint cents), quantities in
-- thousandths, VAT rates and discounts in hundredths of a percent: exact, never floating point.

-- The seller profile and defaults, one JSON document per workspace (validated by the API).
CREATE TABLE invoice_settings (
    workspace_id text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    settings     jsonb NOT NULL,
    updated_at   timestamptz NOT NULL
);

-- Gapless numbers per workspace, document kind and year of issue_date, bumped inside the issuing transaction.
CREATE TABLE invoice_counters (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
    year         integer NOT NULL,
    seq          bigint NOT NULL,
    PRIMARY KEY (workspace_id, kind, year)
);

CREATE TABLE invoices (
    id                  text PRIMARY KEY,
    workspace_id        text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    kind                text NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
    status              text NOT NULL CHECK (status IN ('draft', 'open', 'paid', 'void')),
    number              text,   -- set on issue
    seq                 bigint, -- the counter value behind number
    client_id           text NOT NULL REFERENCES clients (id), -- clients are only soft-deleted
    credited_invoice_id text REFERENCES invoices (id),
    issue_date          date NOT NULL,
    due_date            date NOT NULL,
    service_date        date,
    service_date_end    date,
    currency            text NOT NULL,
    language            text NOT NULL CHECK (language IN ('de', 'fr', 'it', 'en')),
    vat_mode            text NOT NULL CHECK (vat_mode IN ('exclusive', 'inclusive', 'none')),
    reference           text,
    intro               text,
    footer              text,
    note                text,
    discount_percent    integer NOT NULL CHECK (discount_percent BETWEEN 0 AND 10000),
    subtotal            bigint NOT NULL,
    discount_amount     bigint NOT NULL,
    net_total           bigint NOT NULL,
    vat_total           bigint NOT NULL,
    total               bigint NOT NULL,
    rounding_amount     bigint NOT NULL,
    vat_breakdown       jsonb NOT NULL,
    amount_paid         bigint NOT NULL DEFAULT 0, -- Σ payments, kept by the API in the payment's transaction
    amount_credited     bigint NOT NULL DEFAULT 0, -- Σ payable of the issued credit notes against it
    iban                text,  -- the rest is the snapshot taken on issue
    reference_type      text CHECK (reference_type IN ('QRR', 'SCOR', 'NON')),
    payment_reference   text,
    qr_bill             boolean NOT NULL DEFAULT false,
    seller              jsonb,
    buyer               jsonb,
    pdf_key             text,
    issued_at           timestamptz,
    sent_at             timestamptz,
    created_at          timestamptz NOT NULL,
    updated_at          timestamptz NOT NULL,
    UNIQUE (workspace_id, kind, number),
    UNIQUE (workspace_id, payment_reference),
    CHECK ((status = 'draft') = (number IS NULL))
);
CREATE INDEX invoices_workspace_issue ON invoices (workspace_id, issue_date DESC, created_at DESC);
CREATE INDEX invoices_client ON invoices (client_id);
CREATE INDEX invoices_credited ON invoices (credited_invoice_id) WHERE credited_invoice_id IS NOT NULL;

CREATE TABLE invoice_lines (
    id               text PRIMARY KEY,
    invoice_id       text NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    position         integer NOT NULL,
    description      text NOT NULL,
    quantity         bigint NOT NULL CHECK (quantity > 0),
    unit             text CHECK (unit IN ('hour', 'day', 'piece', 'month', 'km', 'flat')),
    unit_price       bigint NOT NULL CHECK (unit_price >= 0),
    discount_percent integer NOT NULL CHECK (discount_percent BETWEEN 0 AND 10000),
    vat_category     text NOT NULL CHECK (vat_category IN ('S', 'Z', 'E', 'AE', 'K', 'G', 'O')),
    vat_rate         integer NOT NULL CHECK (vat_rate BETWEEN 0 AND 10000),
    amount           bigint NOT NULL,
    UNIQUE (invoice_id, position)
);

CREATE TABLE invoice_payments (
    id         text PRIMARY KEY,
    invoice_id text NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    amount     bigint NOT NULL CHECK (amount > 0),
    paid_on    date NOT NULL,
    method     text NOT NULL CHECK (method IN ('bank_transfer', 'cash', 'card', 'twint', 'other')),
    note       text,
    created_by text REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX invoice_payments_invoice ON invoice_payments (invoice_id, paid_on);

CREATE TABLE invoice_deliveries (
    id         text PRIMARY KEY,
    invoice_id text NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    recipients text[] NOT NULL,
    cc         text[] NOT NULL DEFAULT '{}',
    sent_by    text REFERENCES users (id) ON DELETE SET NULL,
    sent_at    timestamptz NOT NULL
);
CREATE INDEX invoice_deliveries_invoice ON invoice_deliveries (invoice_id, sent_at);

-- +goose Down
DROP TABLE invoice_deliveries, invoice_payments, invoice_lines, invoices, invoice_counters, invoice_settings;
