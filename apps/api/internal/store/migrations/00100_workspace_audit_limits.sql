-- +goose Up
INSERT INTO limits (key, kind, unit, scope, period, requires_features, allow_unlimited, position, description)
SELECT 'workspace_audit', 'access', 'boolean', 'workspace', NULL, '{}'::text[], true, p + 1,
    'AI audit of workspace records and document originals'
FROM (SELECT max(position) AS p FROM limits) positions
UNION ALL
SELECT 'workspace_audits_per_month', 'period_counter', 'audit_run', 'workspace', 'calendar_month_utc',
    '{workspace_audit}'::text[], true, p + 2, 'AI audit runs started per UTC calendar month'
FROM (SELECT max(position) AS p FROM limits) positions;

-- +goose Down
ALTER TABLE limit_plans DISABLE TRIGGER limit_plans_immutable;
DELETE FROM limit_workspaces WHERE limit_key IN ('workspace_audit', 'workspace_audits_per_month');
DELETE FROM limit_plans WHERE limit_key IN ('workspace_audit', 'workspace_audits_per_month');
ALTER TABLE limit_plans ENABLE TRIGGER limit_plans_immutable;
DELETE FROM limits WHERE key IN ('workspace_audit', 'workspace_audits_per_month');
