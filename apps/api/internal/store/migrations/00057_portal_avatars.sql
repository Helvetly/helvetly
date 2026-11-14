-- +goose Up
-- A client portal login's photo (docs/portal-contract.md): one per client and portal address, kept in the client's
-- workspace, so no workspace stores or serves another tenant's file. The object lives in storage at object_key.
CREATE TABLE portal_avatars (
    client_id    text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    email        text NOT NULL CHECK (email = lower(email)),
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    object_key   text NOT NULL,
    content_type text NOT NULL,
    size         bigint NOT NULL,
    sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    updated_at   timestamptz NOT NULL,
    PRIMARY KEY (client_id, email)
);
CREATE INDEX portal_avatars_workspace ON portal_avatars (workspace_id);

-- +goose Down
DROP TABLE portal_avatars;
