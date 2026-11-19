-- +goose Up
-- A note on how the client did in a logged delivery. Since 00031 the client sees it in the portal, and it reaches invoices only per entry, opted in.
ALTER TABLE engagement_entries ADD COLUMN client_performance text;

-- +goose Down
ALTER TABLE engagement_entries DROP COLUMN client_performance;
