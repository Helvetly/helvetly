-- +goose Up
-- An invoice import started from a client's page: every invoice it reads is that client's.
ALTER TABLE import_batches ADD COLUMN client_id text REFERENCES clients(id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE import_batches DROP COLUMN client_id;
