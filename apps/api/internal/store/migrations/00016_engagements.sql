-- +goose Up
-- Engagements: committed work per client, their periods, the delivery log and the invoices made from them
-- (internal/engagements, docs/engagements-contract.md). Quantities in thousandths, money in minor units,
-- VAT rates in hundredths of a percent.

ALTER TABLE workspace_counters ADD COLUMN engagements_seq bigint NOT NULL DEFAULT 0;

CREATE TABLE engagements (
    id                 text PRIMARY KEY,
    workspace_id       text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    number             bigint NOT NULL,
    client_id          text NOT NULL REFERENCES clients (id), -- clients are only soft-deleted
    title              text NOT NULL,
    description        text,
    product_id         text REFERENCES products (id) ON DELETE SET NULL,
    unit               text CHECK (unit IN ('hour', 'day', 'piece', 'month', 'km', 'flat')),
    quantity           bigint NOT NULL CHECK (quantity > 0),
    billing            text NOT NULL CHECK (billing IN ('advance', 'arrears')),
    price_basis        text NOT NULL CHECK (price_basis IN ('net', 'gross')),
    unit_price         bigint NOT NULL CHECK (unit_price >= 0),
    overage_unit_price bigint CHECK (overage_unit_price >= 0),
    currency           text NOT NULL,
    vat_category       text NOT NULL CHECK (vat_category IN ('S', 'Z', 'E', 'AE', 'K', 'G', 'O')),
    vat_rate           integer NOT NULL CHECK (vat_rate BETWEEN 0 AND 10000),
    start_date         date NOT NULL,
    recurrence         text NOT NULL CHECK (recurrence IN ('none', 'weekly', 'monthly', 'quarterly', 'yearly')),
    interval           integer NOT NULL CHECK (interval BETWEEN 1 AND 12),
    end_date           date,
    reference          text,
    document_id        text REFERENCES documents (id) ON DELETE SET NULL,
    cancelled_on       date,
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    deleted_at         timestamptz, -- soft delete; the number is never reused
    UNIQUE (workspace_id, number)
);
CREATE INDEX engagements_workspace_client ON engagements (workspace_id, client_id) WHERE deleted_at IS NULL;

CREATE TABLE engagement_periods (
    id                 text PRIMARY KEY,
    engagement_id      text NOT NULL REFERENCES engagements (id) ON DELETE CASCADE,
    idx                integer NOT NULL CHECK (idx >= 1),
    starts_on          date NOT NULL,
    ends_on            date NOT NULL,
    quantity           bigint NOT NULL CHECK (quantity > 0),
    unit_price         bigint NOT NULL CHECK (unit_price >= 0),
    overage_unit_price bigint NOT NULL CHECK (overage_unit_price >= 0),
    UNIQUE (engagement_id, idx)
);

CREATE TABLE engagement_entries (
    id            text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements (id) ON DELETE CASCADE,
    period_id     text NOT NULL REFERENCES engagement_periods (id) ON DELETE CASCADE,
    date          date NOT NULL,
    quantity      bigint NOT NULL CHECK (quantity > 0),
    note          text,
    performed_by  text REFERENCES users (id) ON DELETE SET NULL,
    invoice_id    text REFERENCES invoices (id) ON DELETE SET NULL, -- the invoice covering it; void ones are ignored when reading
    created_by    text REFERENCES users (id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL
);
CREATE INDEX engagement_entries_period ON engagement_entries (period_id, date DESC);

CREATE TABLE engagement_invoices (
    period_id  text NOT NULL REFERENCES engagement_periods (id) ON DELETE CASCADE,
    invoice_id text NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN ('advance', 'usage')),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (period_id, invoice_id)
);

-- +goose Down
DROP TABLE engagement_invoices, engagement_entries, engagement_periods, engagements;
ALTER TABLE workspace_counters DROP COLUMN engagements_seq;
