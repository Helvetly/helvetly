-- +goose Up
-- Which account each posting role uses in the derived ledger (docs/ledger-contract.md); no row = the KMU defaults.
CREATE TABLE ledger_settings (
    workspace_id text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    accounts     jsonb NOT NULL,
    updated_by   text REFERENCES users (id) ON DELETE SET NULL,
    updated_at   timestamptz NOT NULL
);

-- +goose Down
DROP TABLE ledger_settings;
