-- Offer v3: offer v2 with the Employees module (feature employees), on the Business plan only, with no employee cap.
-- Published offers never change, so v3 is a new version: v2's document with one more access record and one more
-- comparison row, the same prices, trial and allowances (the trial's access plan is Business, so a trial includes it).
-- Every workspace on v2 moves to v3 with its own values, as the terms only grow; a Checkout opened on v2 still settles
-- on v2, whose rights have no employees value (the module then answers entitlements_unavailable for that workspace).

-- +goose Up
INSERT INTO offer_versions (id, schema_version, checksum, published_at, document)
SELECT 'helvetly-2026-11-v3', schema_version, '472c540d6ecf641f86447f7bd1bf0397066bf8567ca5d607057e751abfb08a43', now(),
    jsonb_insert(
        jsonb_insert(jsonb_set(document, '{offer_id}', '"helvetly-2026-11-v3"'), '{records,-1}',
            '{"key": "employees", "type": "access", "unit": "boolean", "scope": "workspace", "period": null, "values": {"basic": {"state": "disabled"}, "business": {"state": "enabled"}, "pro": {"state": "disabled"}}}',
            true),
        '{public_pricing,comparison_rows,-1}',
        '{"key": "employees", "label_en": "Employees and payroll register", "note_en": "Staff records, employee documents and a payroll register you fill in or import. No payroll calculation, payslips or filings.", "feature_keys": ["employees"], "limit_keys": []}',
        true)
FROM offer_versions WHERE id = 'helvetly-2026-11-v2';

INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position)
SELECT 'employees', 'access', 'boolean', 'workspace', NULL, '{}', true, max(position) + 1 FROM limits;

INSERT INTO limit_plans (offer_id, plan_id, limit_key, state, value, per_additional_paid_seat)
SELECT 'helvetly-2026-11-v3', plan_id, limit_key, state, value, per_additional_paid_seat
FROM limit_plans WHERE offer_id = 'helvetly-2026-11-v2'
UNION ALL
SELECT 'helvetly-2026-11-v3', p, 'employees', CASE p WHEN 'business' THEN 'enabled' ELSE 'disabled' END, NULL, 0
FROM unnest(ARRAY['basic', 'pro', 'business']) p;

INSERT INTO limit_workspaces (limit_key, workspace_id, offer_id, state, value, expires_at, set_by, reason, updated_at)
SELECT limit_key, workspace_id, 'helvetly-2026-11-v3', state, value, expires_at, set_by, reason, updated_at
FROM limit_workspaces WHERE offer_id = 'helvetly-2026-11-v2';

UPDATE workspace_billing SET offer_id = 'helvetly-2026-11-v3' WHERE offer_id = 'helvetly-2026-11-v2';

INSERT INTO offer_audit (actor, action, target, before, after, reason)
SELECT 'migration 00012', 'offer.publish', id,
    (SELECT jsonb_build_object('offer_id', v.id, 'checksum', v.checksum) FROM offer_versions v WHERE v.id = 'helvetly-2026-11-v2'),
    jsonb_build_object('offer_id', id, 'checksum', checksum),
    'Employees module on Business, approved by the owner on 2026-11-16'
FROM offer_versions WHERE id = 'helvetly-2026-11-v3';

-- +goose Down
UPDATE workspace_billing SET offer_id = 'helvetly-2026-11-v2' WHERE offer_id = 'helvetly-2026-11-v3';
-- Published rows are immutable by trigger; a rollback is the one place that removes them.
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
ALTER TABLE offer_versions DISABLE TRIGGER offer_versions_immutable;
DELETE FROM limit_workspaces WHERE offer_id = 'helvetly-2026-11-v3';
DELETE FROM limit_plans WHERE offer_id = 'helvetly-2026-11-v3';
DELETE FROM limits WHERE key = 'employees';
DELETE FROM offer_versions WHERE id = 'helvetly-2026-11-v3';
ALTER TABLE offer_versions ENABLE TRIGGER offer_versions_immutable;
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
