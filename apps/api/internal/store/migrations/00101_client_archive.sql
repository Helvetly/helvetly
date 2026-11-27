-- +goose Up
ALTER TABLE clients ADD COLUMN archived_at timestamptz;

-- +goose Down
ALTER TABLE clients DROP COLUMN archived_at;
