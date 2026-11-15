-- Plan limits as Staqly keeps them, ready for an admin panel: a default per limit (limits), a value per plan where it
-- differs (limit_plans) and a value per workspace where an operator set one (limit_workspaces), which replaces the
-- plan's. -1 = unlimited; a feature (api_access) is 1 (on) or 0 (off). Plans themselves (names, prices) stay in code.
-- The existing plan_limits rows move over as they are; the defaults are Basic's.

-- +goose Up
CREATE TABLE limits (
    key         text PRIMARY KEY,
    value       bigint NOT NULL CHECK (value >= -1),
    description text NOT NULL DEFAULT '',
    updated_at  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE limit_plans (
    limit_key  text NOT NULL REFERENCES limits (key) ON DELETE CASCADE,
    plan_id    text NOT NULL CHECK (plan_id = ANY (ARRAY['basic'::text, 'pro'::text, 'business'::text])),
    value      bigint NOT NULL CHECK (value >= -1),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (limit_key, plan_id)
);

CREATE TABLE limit_workspaces (
    limit_key    text NOT NULL REFERENCES limits (key) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    value        bigint NOT NULL CHECK (value >= -1),
    note         text NOT NULL DEFAULT '',
    updated_at   timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, limit_key)
);

INSERT INTO limits (key, value, description)
SELECT p.limit_key, COALESCE(p.max_value, -1), d.description
FROM plan_limits p
JOIN (VALUES
    ('members', 'Members besides the owner on the earlier flat prices (per-seat subscriptions have no cap)'),
    ('clients', 'Clients not deleted'),
    ('invoices_per_month', 'Invoices (not credit notes) created per calendar month'),
    ('expenses_per_month', 'Expenses created per calendar month'),
    ('products', 'Catalogue entries not deleted (archived ones too)'),
    ('engagements', 'Engagements not cancelled and not ended'),
    ('signatures_per_month', 'Signature requests sent per calendar month'),
    ('storage_bytes', 'Documents and expense receipts, in bytes'),
    ('ai_tokens_per_month', 'Model tokens Heidi and the AI import use per calendar month')
) AS d (key, description) ON d.key = p.limit_key
WHERE p.plan = 'basic';

INSERT INTO limit_plans (limit_key, plan_id, value)
SELECT p.limit_key, p.plan, COALESCE(p.max_value, -1)
FROM plan_limits p JOIN limits l ON l.key = p.limit_key
WHERE p.plan <> 'basic' AND COALESCE(p.max_value, -1) <> l.value;

INSERT INTO limits (key, value, description) VALUES
    ('api_access', 0, 'Creating personal API tokens (1 on, 0 off)');
INSERT INTO limit_plans (limit_key, plan_id, value) VALUES
    ('api_access', 'pro', 1),
    ('api_access', 'business', 1);

DROP TABLE plan_limits;

-- +goose Down
CREATE TABLE plan_limits (
    plan text NOT NULL,
    limit_key text NOT NULL,
    max_value bigint,
    CONSTRAINT plan_limits_limit_key_check CHECK ((limit_key = ANY (ARRAY['members'::text, 'clients'::text, 'invoices_per_month'::text, 'expenses_per_month'::text, 'products'::text, 'engagements'::text, 'signatures_per_month'::text, 'storage_bytes'::text, 'ai_tokens_per_month'::text]))),
    CONSTRAINT plan_limits_max_value_check CHECK ((max_value >= 0)),
    CONSTRAINT plan_limits_plan_check CHECK ((plan = ANY (ARRAY['basic'::text, 'pro'::text, 'business'::text]))),
    PRIMARY KEY (plan, limit_key)
);
INSERT INTO plan_limits (plan, limit_key, max_value)
SELECT p.plan, l.key, NULLIF(COALESCE(lp.value, l.value), -1)
FROM limits l
CROSS JOIN (VALUES ('basic'), ('pro'), ('business')) AS p (plan)
LEFT JOIN limit_plans lp ON lp.limit_key = l.key AND lp.plan_id = p.plan
WHERE l.key <> 'api_access';
DROP TABLE limit_workspaces, limit_plans, limits;
