-- +goose Up
-- The version of each object the API wrote, as the PUT or COPY answered it (S3 VersionID). Only a real version is
-- recorded: an unversioned bucket answers none and a suspended one "null", which pins nothing. Reads, presigned links,
-- copies and deletes of the key then name this version, so a later overwrite of the key never changes what is served.
CREATE TABLE object_versions (
    object_key text PRIMARY KEY,
    version_id text NOT NULL CHECK (version_id <> '' AND version_id <> 'null'),
    recorded_at timestamptz NOT NULL
);

-- The storage protection (S3 Object Lock) of each business-record object, kept after the work is done, unlike the
-- queue it replaces. status: not_requested (protection off when the record was made), pending, failed (retried by the
-- job; last_error says why), confirmed (the lock was read back from storage: locked_* and version_id are what it said).
-- requested_until is the business deadline (ten years from the end of the record's year), NULL when unknown; the job
-- also keeps S3_OBJECT_LOCK_DAYS from requested_at as a floor.
CREATE TABLE object_retention (
    object_key      text PRIMARY KEY,
    workspace_id    text NOT NULL,
    status          text NOT NULL CHECK (status IN ('not_requested', 'pending', 'failed', 'confirmed')),
    requested_at    timestamptz NOT NULL,
    requested_until timestamptz,
    requested_mode  text CHECK (requested_mode IN ('GOVERNANCE', 'COMPLIANCE')),
    version_id      text,
    locked_mode     text,
    locked_until    timestamptz,
    confirmed_at    timestamptz,
    next_attempt_at timestamptz,
    attempts        integer NOT NULL DEFAULT 0,
    last_error      text,
    CHECK (status <> 'confirmed' OR (locked_mode IS NOT NULL AND locked_until IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE INDEX object_retention_due ON object_retention (next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX object_retention_workspace ON object_retention (workspace_id, status);

-- Still-pending locks carry over as pending: nothing proves they were applied. Done rows were deleted by the old
-- queue, which also counted a no-op (S3_OBJECT_LOCK_DAYS=0) as done, so nothing is confirmed here; the explicit
-- `helvetly retention backfill` re-queues those records and the job verifies them against storage.
INSERT INTO object_retention (object_key, workspace_id, status, requested_at, next_attempt_at, attempts, last_error)
SELECT object_key, workspace_id, 'pending', created_at, next_attempt_at, attempts, last_error FROM retention_pending;
DROP TABLE retention_pending;
-- invoice_xml_retention stays as history (append-only); it no longer means the XML is protected.

-- +goose Down
CREATE TABLE retention_pending (
    object_key      text PRIMARY KEY,
    workspace_id    text NOT NULL,
    created_at      timestamptz NOT NULL,
    next_attempt_at timestamptz NOT NULL,
    attempts        integer NOT NULL DEFAULT 0,
    last_error      text
);
CREATE INDEX retention_pending_due ON retention_pending (next_attempt_at);
INSERT INTO retention_pending (object_key, workspace_id, created_at, next_attempt_at, attempts, last_error)
SELECT object_key, workspace_id, requested_at, coalesce(next_attempt_at, requested_at), attempts, last_error
FROM object_retention WHERE status IN ('pending', 'failed');
DROP TABLE object_retention, object_versions;
