-- Automatic tags (internal/tags/auto.go, store/queries_document_autotags.go): what a file is, computed from its record
-- and its system folder (kind, year, client, number, …) and kept in its tags like any other. auto_tags names the
-- tags the app put there (shown muted); a person who removes one adds it to removed_auto_tags and it never comes
-- back. auto_tagged_at: when the file was last tagged, NULL for files the start-up backfill has not seen yet.

-- +goose Up
ALTER TABLE documents
    ADD COLUMN auto_tags text[] NOT NULL DEFAULT '{}',
    ADD COLUMN removed_auto_tags text[] NOT NULL DEFAULT '{}',
    ADD COLUMN auto_tagged_at timestamp with time zone;

CREATE INDEX documents_auto_untagged ON documents (id) WHERE auto_tagged_at IS NULL AND deleted_at IS NULL;

-- +goose Down
DROP INDEX documents_auto_untagged;
ALTER TABLE documents DROP COLUMN auto_tags, DROP COLUMN removed_auto_tags, DROP COLUMN auto_tagged_at;
