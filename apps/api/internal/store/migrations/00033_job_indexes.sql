-- +goose Up
-- The hourly instalments job (DueReminders, unsent plan partials) reads only open scheduled invoices and plan partials.
CREATE INDEX invoices_open_scheduled ON invoices (id) WHERE status = 'open' AND instalment_interval IS NOT NULL;
CREATE INDEX invoices_open_plan ON invoices (plan_id) WHERE status = 'open' AND plan_id IS NOT NULL;
-- Each sign-in deletes the expired sessions.
CREATE INDEX sessions_expires ON sessions (expires_at);

-- +goose Down
DROP INDEX sessions_expires, invoices_open_plan, invoices_open_scheduled;
