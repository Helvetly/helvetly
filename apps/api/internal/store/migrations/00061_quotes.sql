-- +goose Up
-- Quotes (Offerten): an offer to a client with lines like an invoice, sent, accepted or declined, and turned into an
-- invoice draft (internal/quotes, docs/quotes-contract.md). A quote is not a financial record: no audit events, no
-- closed-period checks. Amounts follow the invoices' units (minor units, thousandths, hundredths of a percent).

-- Numbers per workspace and year of the first send; a sent quote cannot be deleted, so none is reused.
CREATE TABLE quote_counters (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    year         integer NOT NULL,
    seq          bigint NOT NULL,
    PRIMARY KEY (workspace_id, year)
);

CREATE TABLE quotes (
    id               text PRIMARY KEY,
    workspace_id     text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    client_id        text NOT NULL REFERENCES clients (id), -- clients are only soft-deleted
    number           text,    -- set on the first send
    revision         integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
    -- expired is derived: sent and valid_until before today in the workspace's time zone
    status           text NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'declined')),
    issue_date       date NOT NULL,
    valid_until      date NOT NULL CHECK (valid_until >= issue_date),
    currency         text NOT NULL,
    language         text NOT NULL CHECK (language IN ('de', 'fr', 'it', 'en')),
    vat_mode         text NOT NULL CHECK (vat_mode IN ('exclusive', 'inclusive', 'none')),
    reference        text,
    intro            text,
    footer           text,
    note             text,
    discount_percent integer NOT NULL CHECK (discount_percent BETWEEN 0 AND 10000),
    lines            jsonb NOT NULL, -- the invoice line shape, amounts from internal/invoicecalc
    subtotal         bigint NOT NULL,
    discount_amount  bigint NOT NULL,
    net_total        bigint NOT NULL,
    vat_total        bigint NOT NULL,
    total            bigint NOT NULL,
    rounding_amount  bigint NOT NULL,
    vat_breakdown    jsonb NOT NULL,
    pdf_key          text,    -- the PDF of the last send, what the client sees in the portal
    sent_at          timestamptz,
    decided_at       timestamptz,
    decided_by       text CHECK (decided_by IN ('staff', 'client')),
    decision_note    text,
    invoice_id       text UNIQUE REFERENCES invoices (id) ON DELETE SET NULL, -- the draft it became; deleting it frees the quote
    created_at       timestamptz NOT NULL,
    updated_at       timestamptz NOT NULL,
    UNIQUE (workspace_id, number),
    CHECK (status = 'draft' OR number IS NOT NULL),
    CHECK ((status IN ('accepted', 'declined')) = (decided_at IS NOT NULL)),
    CHECK (invoice_id IS NULL OR status = 'accepted')
);
CREATE INDEX quotes_workspace ON quotes (workspace_id, created_at DESC);
CREATE INDEX quotes_client ON quotes (client_id);

-- +goose Down
DROP TABLE quotes, quote_counters;
