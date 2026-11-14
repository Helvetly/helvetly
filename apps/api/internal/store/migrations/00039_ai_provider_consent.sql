-- +goose Up
-- Append-only history of a workspace's consent to send Heidi content to the external AI provider (nDSG/GDPR);
-- the latest row is the current state, and no row means not granted.
CREATE TABLE workspace_ai_consents (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id),
    granted      boolean NOT NULL,
    user_id      text NOT NULL REFERENCES users (id),
    at           timestamptz NOT NULL
);
CREATE INDEX workspace_ai_consents_latest ON workspace_ai_consents (workspace_id, id DESC);

-- +goose Down
DROP TABLE workspace_ai_consents;
