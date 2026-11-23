-- The language of whoever uploaded a file (?lang, else Accept-Language of the upload), so the folders AI filing makes
-- for it are named in their language, not the document's. Null: none was given; filing falls back to the workspace's
-- document language.

-- +goose Up
ALTER TABLE document_filings ADD COLUMN language text;

-- +goose Down
ALTER TABLE document_filings DROP COLUMN language;
