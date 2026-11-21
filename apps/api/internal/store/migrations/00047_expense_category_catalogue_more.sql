-- The catalogue grows by the accounts a Swiss small business books most besides the first ones: wages and social
-- insurances, insurances, depreciation, payment fees and more. Workspaces that already have categories get each new
-- entry, active, unless they hold its key or a category of its name (theirs is never renamed or given the key).
-- Workspaces without categories get the whole catalogue when they first list them (SeedExpenseCategories).

-- +goose Up
-- The entries store.CategoryPresets added after 00046 (expense_categories_migration_test.go compares them).
CREATE TEMPORARY TABLE category_presets_more (key text, name text, account text, vat text) ON COMMIT DROP;
INSERT INTO category_presets_more VALUES
    ('wages', 'Wages & salaries', '5000', 'none'),
    ('temp_staff', 'Temporary staff', '5900', 'standard'),
    ('social_security', 'Social security (AHV/IV/EO/ALV)', '5700', 'none'),
    ('family_allowances', 'Family allowance fund (FAK)', '5710', 'none'),
    ('pension_bvg', 'Pension fund (BVG)', '5720', 'none'),
    ('accident_insurance', 'Accident insurance (UVG)', '5730', 'none'),
    ('sickness_insurance', 'Sickness benefit insurance (KTG)', '5740', 'none'),
    ('recruiting', 'Recruiting', '5800', 'standard'),
    ('staff_meals', 'Staff meals & events', '5840', 'standard'),
    ('customs', 'Customs & import duties', '4070', 'none'),
    ('tools', 'Tools & small equipment', '6100', 'standard'),
    ('home_office', 'Home office share', '6000', 'none'),
    ('vehicle_repairs', 'Vehicle repairs & service', '6200', 'standard'),
    ('property_insurance', 'Property insurance', '6300', 'none'),
    ('liability_insurance', 'Liability insurance', '6300', 'none'),
    ('office_supplies', 'Office supplies', '6500', 'standard'),
    ('books_subscriptions', 'Books & subscriptions', '6500', 'reduced'),
    ('consulting', 'Consulting', '6530', 'standard'),
    ('audit', 'Audit & board', '6540', 'standard'),
    ('web_hosting', 'Web hosting & domains', '6570', 'standard'),
    ('public_transport', 'Public transport & taxis', '6640', 'standard'),
    ('entertainment', 'Client entertainment', '6642', 'standard'),
    ('licences', 'Licences & royalties', '6700', 'standard'),
    ('depreciation', 'Depreciation', '6800', 'none'),
    ('payment_fees', 'Payment provider fees', '6940', 'none');

INSERT INTO expense_categories (id, workspace_id, name, account_code, preset, vat_treatment, created_at, updated_at)
SELECT 'exc_' || replace(gen_random_uuid()::text, '-', ''), w.workspace_id, p.name, p.account, p.key, p.vat, now(), now()
FROM (SELECT DISTINCT workspace_id FROM expense_categories) w
CROSS JOIN category_presets_more p
WHERE NOT EXISTS (SELECT 1 FROM expense_categories o
    WHERE o.workspace_id = w.workspace_id AND (o.preset = p.key OR lower(o.name) = lower(p.name)))
ON CONFLICT DO NOTHING;

-- +goose Down
-- The added categories stay: expenses, their items and document folders may already point at them.
SELECT 1;
