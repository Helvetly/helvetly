-- +goose Up
-- What each plan allows, seeded here and read by billing at startup; change a value with a new migration.
-- max_value NULL is unlimited. Basic is for one person or a pair, Pro for a growing team, Business has no
-- ceilings: each cap sits where a business that outgrows it also outgrows the plan's price.
CREATE TABLE plan_limits (
    plan      text NOT NULL CHECK (plan IN ('basic', 'pro', 'business')),
    limit_key text NOT NULL CHECK (limit_key IN ('members', 'clients', 'invoices_per_month', 'expenses_per_month',
        'products', 'engagements', 'signatures_per_month', 'storage_bytes')),
    max_value bigint CHECK (max_value >= 0),
    PRIMARY KEY (plan, limit_key)
);

INSERT INTO plan_limits (plan, limit_key, max_value) VALUES
    ('basic', 'members', 2),
    ('basic', 'clients', 50),
    ('basic', 'invoices_per_month', 30),
    ('basic', 'expenses_per_month', 60),
    ('basic', 'products', 25),
    ('basic', 'engagements', 3),
    ('basic', 'signatures_per_month', 5),
    ('basic', 'storage_bytes', 5368709120),      -- 5 GB
    ('pro', 'members', 10),
    ('pro', 'clients', 1000),
    ('pro', 'invoices_per_month', 300),
    ('pro', 'expenses_per_month', 600),
    ('pro', 'products', 500),
    ('pro', 'engagements', 50),
    ('pro', 'signatures_per_month', 50),
    ('pro', 'storage_bytes', 107374182400),      -- 100 GB
    ('business', 'members', NULL),
    ('business', 'clients', NULL),
    ('business', 'invoices_per_month', NULL),
    ('business', 'expenses_per_month', NULL),
    ('business', 'products', NULL),
    ('business', 'engagements', NULL),
    ('business', 'signatures_per_month', NULL),
    ('business', 'storage_bytes', 1099511627776); -- 1 TB

-- +goose Down
DROP TABLE plan_limits;
