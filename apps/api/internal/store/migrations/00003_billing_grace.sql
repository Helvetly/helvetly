-- Failed renewals: a plan works until its paid end plus the billing grace (plan_expires_at; NULL = not known yet,
-- the subscription's status alone decides). seats_changed_at: when the membership last changed, the date a seat
-- change is prorated from.

-- +goose Up
ALTER TABLE workspace_billing
    ADD COLUMN plan_expires_at timestamp with time zone,
    ADD COLUMN seats_changed_at timestamp with time zone;

-- +goose Down
ALTER TABLE workspace_billing DROP COLUMN plan_expires_at, DROP COLUMN seats_changed_at;
