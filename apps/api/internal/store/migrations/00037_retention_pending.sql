-- +goose Up
-- Objects that must get S3 Object Lock (GeBüV): written in the transaction that commits their record, removed once
-- locked, so a failed or interrupted lock after the commit is retried by the retention job.
CREATE TABLE retention_pending (
    object_key      text PRIMARY KEY,
    workspace_id    text NOT NULL,
    created_at      timestamptz NOT NULL,
    next_attempt_at timestamptz NOT NULL,
    attempts        integer NOT NULL DEFAULT 0,
    last_error      text
);
CREATE INDEX retention_pending_due ON retention_pending (next_attempt_at);

-- +goose Down
DROP TABLE retention_pending;
