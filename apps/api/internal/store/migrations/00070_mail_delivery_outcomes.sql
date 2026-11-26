-- +goose Up
ALTER TABLE invoices ADD COLUMN send_uncertain_at timestamptz, ADD COLUMN send_started_at timestamptz;
ALTER TABLE reminder_log ADD COLUMN confirmed boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE reminder_log DROP COLUMN confirmed;
ALTER TABLE invoices DROP COLUMN send_uncertain_at, DROP COLUMN send_started_at;
