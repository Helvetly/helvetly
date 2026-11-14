-- +goose Up
-- Plans are Basic, Pro and Business; there is no free plan (a workspace without a live subscription is locked).
ALTER TABLE workspace_billing DROP CONSTRAINT workspace_billing_plan_check;
UPDATE workspace_billing SET plan = 'basic' WHERE plan = 'standard';
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_plan_check CHECK (plan IN ('', 'basic', 'pro', 'business'));
-- The subscription's discount as billing read it from Stripe (code, amount, duration, end); null when none.
ALTER TABLE workspace_billing ADD COLUMN discount jsonb;

-- +goose Down
ALTER TABLE workspace_billing DROP COLUMN discount;
ALTER TABLE workspace_billing DROP CONSTRAINT workspace_billing_plan_check;
UPDATE workspace_billing SET plan = 'pro' WHERE plan = 'business';
UPDATE workspace_billing SET plan = 'standard' WHERE plan = 'basic';
ALTER TABLE workspace_billing ADD CONSTRAINT workspace_billing_plan_check CHECK (plan IN ('', 'standard', 'pro'));
