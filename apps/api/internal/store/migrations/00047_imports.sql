-- +goose Up
-- AI-assisted import (docs/imports-contract.md): uploaded files, read by the model into records of one kind, reviewed
-- and created by a person. Every kind is listed now, so a new kind needs no migration.
CREATE TABLE import_batches (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id),
    user_id      text NOT NULL REFERENCES users (id),
    kind         text NOT NULL CHECK (kind IN ('clients', 'products', 'expenses', 'invoices', 'engagements')),
    created_at   timestamptz NOT NULL
);
CREATE INDEX import_batches_owner ON import_batches (workspace_id, user_id, kind, created_at DESC);

-- One file to read: an uploaded file, or one entry of an uploaded ZIP (entry_index set). object_key is the stored
-- upload (the ZIP for an entry); document_id the Document holding it (an existing one when the bytes were reused).
CREATE TABLE import_files (
    id              text PRIMARY KEY,
    batch_id        text NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
    workspace_id    text NOT NULL REFERENCES workspaces (id),
    position        integer NOT NULL,
    name            text NOT NULL,
    size            bigint NOT NULL CHECK (size >= 0),
    content_type    text NOT NULL,
    object_key      text,
    entry_index     integer,
    document_id     text,
    reused          boolean NOT NULL DEFAULT false,
    status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'extracting', 'done', 'failed')),
    error           text,
    chunks_done     integer NOT NULL DEFAULT 0,
    chunks_total    integer,
    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz,
    claimed_until   timestamptz,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    UNIQUE (batch_id, position)
);
CREATE INDEX import_files_due ON import_files (next_attempt_at) WHERE status IN ('queued', 'extracting');

-- One extracted record: the kind's create input (data), the create rules' messages (issues), a possible existing
-- duplicate, and once created the new entity's id (a retried commit never creates it twice).
CREATE TABLE import_records (
    id           text PRIMARY KEY,
    batch_id     text NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
    file_id      text NOT NULL REFERENCES import_files (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id),
    position     integer NOT NULL,
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'created', 'failed')),
    data         jsonb NOT NULL,
    issues       jsonb NOT NULL DEFAULT '{}',
    duplicate    jsonb,
    entity_id    text,
    error        text,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL,
    UNIQUE (batch_id, position),
    CHECK ((status = 'created') = (entity_id IS NOT NULL))
);

-- +goose Down
DROP TABLE import_records;
DROP TABLE import_files;
DROP TABLE import_batches;
