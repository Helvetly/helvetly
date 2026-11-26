-- Existing files are retagged in bounded transactions by BackfillAutoTags.
-- +goose Up
ALTER TABLE documents ADD COLUMN record_tags_current boolean NOT NULL DEFAULT false;
CREATE INDEX documents_record_tags_pending ON documents (id) WHERE (NOT record_tags_current OR auto_tagged_at IS NULL) AND deleted_at IS NULL AND NOT hr_private;

CREATE INDEX engagements_document ON engagements (workspace_id, document_id) WHERE document_id IS NOT NULL;

-- +goose Down
DROP INDEX engagements_document;
DROP INDEX documents_record_tags_pending;
ALTER TABLE documents DROP COLUMN record_tags_current;
