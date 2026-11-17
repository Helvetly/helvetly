-- +goose Up
-- One row per deletion of a workspace: who deleted it, the members it had (so the deleting owner can restore it for 30
-- days) and the ZIP archive of its records and files the job stores for disputes.
CREATE TABLE workspace_deletions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    deleted_by text NOT NULL,
    deleted_at timestamp with time zone NOT NULL,
    members jsonb NOT NULL,
    backup_key text,
    backup_size bigint,
    backed_up_at timestamp with time zone,
    backup_tried_at timestamp with time zone,
    backup_error text,
    restored_at timestamp with time zone
);

CREATE INDEX workspace_deletions_by ON workspace_deletions (deleted_by, deleted_at DESC) WHERE restored_at IS NULL;
CREATE INDEX workspace_deletions_backup ON workspace_deletions (deleted_at) WHERE backed_up_at IS NULL;

-- +goose Down
DROP TABLE workspace_deletions;
