-- +goose Up
ALTER TABLE expense_receipts ADD COLUMN sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');
CREATE INDEX expense_receipts_workspace_sha256 ON expense_receipts (workspace_id, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX documents_workspace_sha256 ON documents (workspace_id, sha256) WHERE sha256 IS NOT NULL AND deleted_at IS NULL;

-- +goose Down
DROP INDEX documents_workspace_sha256;
DROP INDEX expense_receipts_workspace_sha256;
ALTER TABLE expense_receipts DROP COLUMN sha256;
