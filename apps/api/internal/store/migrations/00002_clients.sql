-- +goose Up
-- Clients of a workspace, their contact persons and attached files (internal/clients).

-- Per-workspace sequences, bumped in the statement that uses them so a number is never handed out twice.
CREATE TABLE workspace_counters (
    workspace_id text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    clients_seq  bigint NOT NULL DEFAULT 0
);

CREATE TABLE clients (
    id                 text PRIMARY KEY,
    workspace_id       text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    number             bigint NOT NULL,
    name               text NOT NULL,
    preferred_name     text,
    is_company         boolean NOT NULL DEFAULT false,
    is_active          boolean NOT NULL DEFAULT true,
    email              text,
    billing_email      text,
    phone              text,
    website            text,
    street             text,
    street_number      text,
    apt                text,
    zip                text,
    city               text,
    country            text,
    vat_number         text,
    language           text CHECK (language IN ('de', 'fr', 'it', 'en')),
    currency           text,
    payment_terms_days integer CHECK (payment_terms_days BETWEEN 0 AND 365),
    internal_id        text,
    note               text,
    tags               text[] NOT NULL DEFAULT '{}', -- kept as typed, unique case-insensitively
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    deleted_at         timestamptz, -- soft delete: invoices and documents keep their reference
    UNIQUE (workspace_id, number)
);
-- The list's default sort; the other sorts and the contains-search scan one workspace's live clients.
CREATE INDEX clients_workspace_created ON clients (workspace_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE client_contacts (
    id           text PRIMARY KEY,
    client_id    text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name         text NOT NULL,
    role         text,
    email        text,
    phone        text,
    is_primary   boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL
);
CREATE INDEX client_contacts_client ON client_contacts (client_id, created_at);
CREATE UNIQUE INDEX client_contacts_one_primary ON client_contacts (client_id) WHERE is_primary;

CREATE TABLE client_files (
    id           text PRIMARY KEY,
    client_id    text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    object_key   text NOT NULL UNIQUE,
    name         text NOT NULL,
    size         bigint NOT NULL,
    content_type text NOT NULL,
    uploaded_by  text REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL
);
CREATE INDEX client_files_client ON client_files (client_id, created_at);

-- +goose Down
DROP TABLE client_files, client_contacts, clients, workspace_counters;
