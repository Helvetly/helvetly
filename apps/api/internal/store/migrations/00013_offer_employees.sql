-- Offer helvetly-v1: the one published offer. It is offer v2's terms (00007) with the Employees module (feature
-- employees) on the Business plan only, with no employee cap, under a plain first version id. v2 never had a paying
-- customer, so it is not kept beside v1: every workspace, its own values and every Checkout move to v1, and v2's rows
-- go. The checksum leaves the id out, so it identifies these terms under any id. Later changes publish helvetly-v2.

-- +goose Up
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document)
SELECT 'helvetly-v1', schema_version, '472c540d6ecf641f86447f7bd1bf0397066bf8567ca5d607057e751abfb08a43', now(),
    jsonb_insert(
        jsonb_insert(jsonb_set(document, '{offer_id}', '"helvetly-v1"'), '{records,-1}',
            '{"key": "employees", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "disabled"}}}',
            true),
        '{public_pricing,comparison_rows,-1}',
        '{"key": "employees", "label_en": "Employees and payroll register", "note_en": "Staff records, employee documents and a payroll register you fill in or import. No payroll calculation, payslips or filings.", "feature_keys": ["employees"], "limit_keys": []}',
        true)
FROM offer_versions WHERE id = 'helvetly-2026-11-v2';

INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position)
SELECT 'employees', 'access', 'boolean', 'workspace', NULL, '{}', true, max(position) + 1 FROM limits;

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT 'helvetly-v1', plan_id, limit_key, state, value, per_additional_paid_seat
FROM limit_plans WHERE offer_id = 'helvetly-2026-11-v2'
UNION ALL
SELECT 'helvetly-v1', p, 'employees', CASE p WHEN 'business' THEN 'enabled' ELSE 'disabled' END, NULL, 0
FROM unnest(ARRAY['basic', 'pro', 'business']) p;

UPDATE limit_workspaces SET offer_id = 'helvetly-v1' WHERE offer_id = 'helvetly-2026-11-v2';
UPDATE workspace_billing SET offer_id = 'helvetly-v1' WHERE offer_id = 'helvetly-2026-11-v2';
UPDATE billing_checkouts SET offer_id = 'helvetly-v1' WHERE offer_id = 'helvetly-2026-11-v2';

-- Published rows are immutable by trigger; folding v2 into v1 is the one place that removes them.
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
DELETE FROM limit_plans WHERE offer_id = 'helvetly-2026-11-v2';
DELETE FROM offer_versions WHERE id = 'helvetly-2026-11-v2';
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;

INSERT INTO offer_audit (actor, action, target, before, after, reason)
SELECT 'migration 00013', 'offer.publish', id,
    jsonb_build_object('offer_id', 'helvetly-2026-11-v2', 'checksum', '011183b1d4f288ef7cb68b77baab9b396e0ba499447dfc00e82ac8dc4c1ce2fb'),
    jsonb_build_object('offer_id', id, 'checksum', checksum),
    'Offer flattened to helvetly-v1 with the Employees module on Business (v2 had no customers), approved by the owner on 2026-11-16'
FROM offer_versions WHERE id = 'helvetly-v1';

-- +goose Down
-- v2 comes back from v1 without the Employees module; its document is v1's without the two employees entries.
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document)
SELECT 'helvetly-2026-11-v2', schema_version, '011183b1d4f288ef7cb68b77baab9b396e0ba499447dfc00e82ac8dc4c1ce2fb', now(),
    jsonb_set(jsonb_set(jsonb_set(document, '{offer_id}', '"helvetly-2026-11-v2"'),
        '{records}', (SELECT jsonb_agg(r ORDER BY n) FROM jsonb_array_elements(document->'records') WITH ORDINALITY e(r, n)
            WHERE r->>'key' <> 'employees')),
        '{public_pricing,comparison_rows}', (SELECT jsonb_agg(r ORDER BY n)
            FROM jsonb_array_elements(document->'public_pricing'->'comparison_rows') WITH ORDINALITY e(r, n) WHERE r->>'key' <> 'employees'))
FROM offer_versions WHERE id = 'helvetly-v1';
INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT 'helvetly-2026-11-v2', plan_id, limit_key, state, value, per_additional_paid_seat
FROM limit_plans WHERE offer_id = 'helvetly-v1' AND limit_key <> 'employees';
DELETE FROM limit_workspaces WHERE offer_id = 'helvetly-v1' AND limit_key = 'employees';
UPDATE limit_workspaces SET offer_id = 'helvetly-2026-11-v2' WHERE offer_id = 'helvetly-v1';
UPDATE workspace_billing SET offer_id = 'helvetly-2026-11-v2' WHERE offer_id = 'helvetly-v1';
UPDATE billing_checkouts SET offer_id = 'helvetly-2026-11-v2' WHERE offer_id = 'helvetly-v1';
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
DELETE FROM limit_plans WHERE offer_id = 'helvetly-v1';
DELETE FROM limits WHERE key = 'employees';
DELETE FROM offer_versions WHERE id = 'helvetly-v1';
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
