-- locked_tags: those of a file's automatic tags that only its record or filing sets (tags.Locked: its kind, signed,
-- its date and its record's number); people cannot remove them. filed_kind: the kind (tags.Kinds) AI filing or
-- organizing found, or the type a client document was uploaded as, used when no record or system folder says what the
-- file is. Every file is retagged once by BackfillAutoTags, which also turns the automatic client-<name> tags into
-- <name> (tags.ClientTag).

-- +goose Up
ALTER TABLE documents
    ADD COLUMN locked_tags text[] NOT NULL DEFAULT '{}',
    ADD COLUMN filed_kind text;
UPDATE documents SET record_tags_current = false WHERE deleted_at IS NULL AND NOT hr_private;

-- +goose Down
ALTER TABLE documents DROP COLUMN locked_tags, DROP COLUMN filed_kind;
