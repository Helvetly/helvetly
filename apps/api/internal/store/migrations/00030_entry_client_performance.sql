-- +goose Up
-- An internal note on how the client did in a logged delivery; never on invoices or in the portal.
ALTER TABLE engagement_entries ADD COLUMN client_performance text;

-- +goose Down
ALTER TABLE engagement_entries DROP COLUMN client_performance;
