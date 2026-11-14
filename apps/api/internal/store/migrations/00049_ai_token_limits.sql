-- +goose Up
-- The monthly model token allowance (Heidi and the AI import, counted in heidi_usage) is a plan limit, no longer a
-- server setting (HEIDI_MONTHLY_TOKENS). Every plan has a ceiling: model calls cost money per token.
ALTER TABLE plan_limits DROP CONSTRAINT plan_limits_limit_key_check;
ALTER TABLE plan_limits ADD CONSTRAINT plan_limits_limit_key_check CHECK (limit_key IN ('members', 'clients',
    'invoices_per_month', 'expenses_per_month', 'products', 'engagements', 'signatures_per_month', 'storage_bytes',
    'ai_tokens_per_month'));
INSERT INTO plan_limits (plan, limit_key, max_value) VALUES
    ('basic', 'ai_tokens_per_month', 1000000),
    ('pro', 'ai_tokens_per_month', 5000000),
    ('business', 'ai_tokens_per_month', 20000000);

-- +goose Down
DELETE FROM plan_limits WHERE limit_key = 'ai_tokens_per_month';
ALTER TABLE plan_limits DROP CONSTRAINT plan_limits_limit_key_check;
ALTER TABLE plan_limits ADD CONSTRAINT plan_limits_limit_key_check CHECK (limit_key IN ('members', 'clients',
    'invoices_per_month', 'expenses_per_month', 'products', 'engagements', 'signatures_per_month', 'storage_bytes'));
