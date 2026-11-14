-- +goose Up
-- Consecutive wrong second-factor codes, kept across restarts; locked_until blocks verification until then.
ALTER TABLE account_two_factor ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0, ADD COLUMN locked_until timestamptz;

-- +goose Down
ALTER TABLE account_two_factor DROP COLUMN locked_until, DROP COLUMN failed_attempts;
