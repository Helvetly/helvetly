-- +goose Up
-- How a client wants its e-invoices (docs/delivery-contract.md): the XML format to attach to invoice emails, and a
-- German public body's Leitweg-ID, copied into a new invoice's buyer reference (BT-10).
ALTER TABLE clients
    ADD COLUMN einvoice_format text NOT NULL DEFAULT 'none'
        CHECK (einvoice_format IN ('none', 'xrechnung_ubl', 'xrechnung_cii', 'peppol')),
    ADD COLUMN leitweg_id text;

-- One e-document of an issued invoice sent through a channel (invoice_deliveries records emails): a file to upload
-- (export), a government API (national) or a Peppol / access-point provider (intermediary). The job sends queued
-- rows and retries failures.
CREATE TABLE einvoice_transmissions (
    id              text PRIMARY KEY,
    workspace_id    text NOT NULL REFERENCES workspaces (id),
    invoice_id      text NOT NULL REFERENCES invoices (id),
    channel         text NOT NULL,
    format          text NOT NULL,
    status          text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sent', 'accepted', 'rejected', 'failed')),
    external_id     text,
    attempts        integer NOT NULL DEFAULT 0,
    last_error      text,
    next_attempt_at timestamptz,
    created_by      text REFERENCES users (id),
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL
);
CREATE INDEX einvoice_transmissions_invoice ON einvoice_transmissions (workspace_id, invoice_id);
CREATE INDEX einvoice_transmissions_due ON einvoice_transmissions (next_attempt_at) WHERE status = 'queued';
-- one delivery per invoice, channel and format: a retry re-queues the same row
CREATE UNIQUE INDEX einvoice_transmissions_once ON einvoice_transmissions (invoice_id, channel, format);

-- A workspace's credentials for a channel, sealed with AES-GCM (key derived from SECRET_KEY); never returned.
CREATE TABLE transmission_credentials (
    workspace_id text NOT NULL REFERENCES workspaces (id),
    channel      text NOT NULL,
    sealed       bytea NOT NULL,
    updated_by   text REFERENCES users (id),
    updated_at   timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, channel)
);

-- +goose Down
DROP TABLE transmission_credentials;
DROP TABLE einvoice_transmissions;
ALTER TABLE clients DROP COLUMN leitweg_id, DROP COLUMN einvoice_format;
