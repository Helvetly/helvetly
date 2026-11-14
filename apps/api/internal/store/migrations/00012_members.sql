-- +goose Up
-- Invitations to join a workspace; only the SHA-256 of the link's token is stored.
CREATE TABLE workspace_invitations (
    id           text        PRIMARY KEY,
    workspace_id text        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    email        text        NOT NULL,
    role         text        NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    token_hash   text        NOT NULL UNIQUE,
    invited_by   text        REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL,
    expires_at   timestamptz NOT NULL,
    accepted_at  timestamptz,
    accepted_by  text        REFERENCES users (id) ON DELETE SET NULL,
    revoked_at   timestamptz
);
-- One open invitation per address and workspace.
CREATE UNIQUE INDEX workspace_invitations_open ON workspace_invitations (workspace_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX workspace_invitations_email ON workspace_invitations (email);

-- +goose Down
DROP TABLE workspace_invitations;
