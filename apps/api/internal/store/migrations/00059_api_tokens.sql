-- +goose Up
-- Personal access tokens (docs/api-tokens-contract.md): one person in one workspace, read or write. Only the
-- SHA-256 of the secret is stored; prefix is its first characters, shown so a person recognises it.
CREATE TABLE api_tokens (
    id           text PRIMARY KEY,
    user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    scope        text NOT NULL CHECK (scope IN ('read', 'write')),
    token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    prefix       text NOT NULL,
    created_at   timestamptz NOT NULL,
    expires_at   timestamptz,
    last_used_at timestamptz
);
CREATE INDEX api_tokens_user ON api_tokens (user_id);
CREATE INDEX api_tokens_workspace ON api_tokens (workspace_id);

-- +goose Down
DROP TABLE api_tokens;
