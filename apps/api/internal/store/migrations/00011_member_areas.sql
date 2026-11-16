-- Members' access areas: the single "settings" area becomes invoice-settings, vat-return, ledger, periods, audit-log
-- and workspace, and personal API tokens get their own "api" area.
--
-- A grant of the old area at any level becomes view of every new one: its edits were refused by role anyway, so
-- nobody gains a right they did not have. Every member keeps the API tokens they could create before (read:api,
-- unless a wildcard already covers it). The former "accountant" preset was only a scope list, it reads as custom.

-- +goose Up
-- +goose StatementBegin
CREATE FUNCTION split_settings_scopes(scopes text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT array_agg(DISTINCT s ORDER BY s) FROM (
        SELECT unnest(CASE WHEN split_part(x, ':', 2) = 'settings'
            THEN ARRAY['read:invoice-settings', 'read:vat-return', 'read:ledger', 'read:periods', 'read:audit-log',
                'read:workspace']
            ELSE ARRAY[x] END) AS s
        FROM unnest(scopes) AS x
        UNION ALL
        SELECT 'read:api' WHERE NOT scopes && ARRAY['read:*', 'write:*', '*:*']
    ) t
$$;
-- +goose StatementEnd
UPDATE workspace_members SET scopes = split_settings_scopes(scopes) WHERE role = 'member' AND scopes IS NOT NULL;
UPDATE workspace_invitations SET scopes = split_settings_scopes(scopes) WHERE role = 'member' AND scopes IS NOT NULL;
DROP FUNCTION split_settings_scopes(text[]);

-- +goose Down
-- +goose StatementBegin
CREATE FUNCTION join_settings_scopes(scopes text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT coalesce(array_agg(DISTINCT s ORDER BY s), '{}') FROM (
        SELECT CASE WHEN split_part(x, ':', 2) IN ('invoice-settings', 'vat-return', 'ledger', 'periods', 'audit-log',
            'workspace') THEN 'read:settings' ELSE x END AS s
        FROM unnest(scopes) AS x
        WHERE split_part(x, ':', 2) <> 'api'
    ) t
$$;
-- +goose StatementEnd
UPDATE workspace_members SET scopes = join_settings_scopes(scopes) WHERE role = 'member' AND scopes IS NOT NULL;
UPDATE workspace_invitations SET scopes = join_settings_scopes(scopes) WHERE role = 'member' AND scopes IS NOT NULL;
DROP FUNCTION join_settings_scopes(text[]);
