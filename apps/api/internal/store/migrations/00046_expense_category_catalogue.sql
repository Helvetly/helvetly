-- Expense categories become a translated catalogue: a category keeps the catalogue key it was made from (preset,
-- cleared once someone renames it) and the VAT treatment it usually has. Older workspaces' categories that match an
-- entry by name and account take its key, and the entries they lack are added, active, unless a category already has
-- the name. Workspaces without categories get the whole catalogue when they first list them (SeedExpenseCategories).

-- +goose Up
ALTER TABLE expense_categories
    ADD COLUMN preset text,
    ADD COLUMN vat_treatment text CHECK (vat_treatment IN ('standard', 'reduced', 'lodging', 'exempt', 'none'));
CREATE UNIQUE INDEX expense_categories_preset ON expense_categories (workspace_id, preset) WHERE preset IS NOT NULL;

-- The same entries as store.CategoryPresets (expense_categories_migration_test.go compares them).
CREATE TEMPORARY TABLE category_presets (key text, name text, account text, vat text) ON COMMIT DROP;
INSERT INTO category_presets VALUES
    ('materials', 'Materials & goods', '4000', 'standard'),
    ('goods_resale', 'Goods for resale', '4200', 'standard'),
    ('subcontractors', 'Subcontractors', '4400', 'standard'),
    ('staff_other', 'Other staff costs', '5800', 'standard'),
    ('training', 'Training', '5810', 'standard'),
    ('staff_expenses', 'Expense allowances', '5820', 'standard'),
    ('rent', 'Rent & premises', '6000', 'exempt'),
    ('premises_ancillary', 'Ancillary premises costs', '6030', 'standard'),
    ('cleaning', 'Cleaning', '6040', 'standard'),
    ('repairs', 'Repairs & maintenance', '6100', 'standard'),
    ('equipment_leasing', 'Equipment leasing', '6105', 'standard'),
    ('vehicles', 'Vehicles & transport', '6200', 'standard'),
    ('fuel', 'Fuel', '6210', 'standard'),
    ('vehicle_insurance', 'Vehicle insurance', '6220', 'none'),
    ('vehicle_tax', 'Vehicle tax & fees', '6230', 'none'),
    ('vehicle_leasing', 'Vehicle leasing', '6260', 'standard'),
    ('freight', 'Freight & delivery', '6280', 'standard'),
    ('insurance', 'Insurance & fees', '6300', 'none'),
    ('duties_permits', 'Duties, fees & permits', '6360', 'none'),
    ('energy', 'Energy & waste', '6400', 'standard'),
    ('waste', 'Waste disposal', '6460', 'standard'),
    ('office', 'Office & administration', '6500', 'standard'),
    ('telecom', 'Phone & internet', '6510', 'standard'),
    ('postage', 'Postage', '6513', 'standard'),
    ('memberships', 'Memberships', '6520', 'none'),
    ('donations', 'Donations', '6520', 'none'),
    ('professional_fees', 'Legal & accounting fees', '6530', 'standard'),
    ('software_saas', 'IT & software', '6570', 'standard'),
    ('it_services', 'IT services', '6570', 'standard'),
    ('hardware_small', 'Small hardware', '6570', 'standard'),
    ('marketing', 'Marketing & advertising', '6600', 'standard'),
    ('gifts', 'Business gifts', '6620', 'standard'),
    ('trade_fairs', 'Trade fairs & events', '6660', 'standard'),
    ('travel', 'Travel', '6640', 'standard'),
    ('lodging', 'Lodging', '6640', 'lodging'),
    ('meals_entertainment', 'Meals & entertainment', '6641', 'standard'),
    ('other_operating', 'Other operating costs', '6700', 'standard'),
    ('interest', 'Interest', '6900', 'none'),
    ('bank_fees', 'Bank charges', '6940', 'none'),
    ('direct_taxes', 'Direct taxes', '8900', 'none');

UPDATE expense_categories c SET preset = p.key, vat_treatment = p.vat
FROM category_presets p
WHERE c.preset IS NULL AND lower(c.name) = lower(p.name) AND c.account_code = p.account;

INSERT INTO expense_categories (id, workspace_id, name, account_code, preset, vat_treatment, created_at, updated_at)
SELECT 'exc_' || replace(gen_random_uuid()::text, '-', ''), w.workspace_id, p.name, p.account, p.key, p.vat, now(), now()
FROM (SELECT DISTINCT workspace_id FROM expense_categories) w
CROSS JOIN category_presets p
WHERE NOT EXISTS (SELECT 1 FROM expense_categories o
    WHERE o.workspace_id = w.workspace_id AND (o.preset = p.key OR lower(o.name) = lower(p.name)))
ON CONFLICT DO NOTHING;

-- +goose Down
DROP INDEX expense_categories_preset;
ALTER TABLE expense_categories DROP COLUMN vat_treatment, DROP COLUMN preset;
