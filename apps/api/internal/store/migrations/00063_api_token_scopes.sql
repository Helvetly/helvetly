-- +goose Up
-- API tokens get granular scopes (docs/api-tokens-contract.md): a list of "read:<resource>" / "write:<resource>",
-- with "*" for every resource. An existing read token keeps reading everything, a write token also writes.
ALTER TABLE api_tokens ADD COLUMN scopes text[];
UPDATE api_tokens SET scopes = CASE scope WHEN 'write' THEN ARRAY['read:*', 'write:*'] ELSE ARRAY['read:*'] END;
ALTER TABLE api_tokens
    ALTER COLUMN scopes SET NOT NULL,
    ADD CONSTRAINT api_tokens_scopes CHECK (cardinality(scopes) > 0),
    DROP COLUMN scope;

-- +goose Down
-- Any write permission becomes a write token, anything else a read token.
ALTER TABLE api_tokens ADD COLUMN scope text;
UPDATE api_tokens SET scope = CASE WHEN EXISTS (SELECT 1 FROM unnest(scopes) s WHERE s LIKE 'write:%') THEN 'write' ELSE 'read' END;
ALTER TABLE api_tokens
    ALTER COLUMN scope SET NOT NULL,
    ADD CONSTRAINT api_tokens_scope_check CHECK (scope IN ('read', 'write')),
    DROP COLUMN scopes;
