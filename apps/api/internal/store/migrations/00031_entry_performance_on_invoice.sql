-- +goose Up
-- Client performance is now shown to the client in the portal; on invoices only per entry, when the owner opts in.
ALTER TABLE engagement_entries ADD COLUMN client_performance_on_invoice boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE engagement_entries DROP COLUMN client_performance_on_invoice;
