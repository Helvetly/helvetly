-- +goose Up
-- The key figures moved from GET /api/v1/dashboard (tag Dashboard) to GET /api/v1/reports/key-figures (tag Reports),
-- so a token scope names "reports" now (docs/api-tokens-contract.md).
UPDATE api_tokens SET scopes = array_replace(array_replace(scopes, 'read:dashboard', 'read:reports'), 'write:dashboard', 'write:reports')
WHERE scopes && ARRAY['read:dashboard', 'write:dashboard'];

-- +goose Down
UPDATE api_tokens SET scopes = array_replace(array_replace(scopes, 'read:reports', 'read:dashboard'), 'write:reports', 'write:dashboard')
WHERE scopes && ARRAY['read:reports', 'write:reports'];
