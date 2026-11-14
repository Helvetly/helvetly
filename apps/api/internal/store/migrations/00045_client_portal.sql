-- +goose Up
-- Client portal (docs/portal-contract.md): who may sign in as a client's contact, and their sessions.
ALTER TABLE clients ADD COLUMN portal_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE client_contacts ADD COLUMN portal_access boolean NOT NULL DEFAULT false;

CREATE TABLE portal_sessions (
    id             text PRIMARY KEY,
    token_hash     text NOT NULL UNIQUE, -- only the SHA-256 of the cookie token
    csrf_token     text NOT NULL,
    contact_id     text NOT NULL REFERENCES client_contacts (id) ON DELETE CASCADE,
    client_id      text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    workspace_id   text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    created_at     timestamptz NOT NULL,
    expires_at     timestamptz NOT NULL,
    last_active_at timestamptz NOT NULL
);
CREATE INDEX portal_sessions_client ON portal_sessions (client_id);
CREATE INDEX portal_sessions_contact ON portal_sessions (contact_id);

-- +goose Down
DROP TABLE portal_sessions;
ALTER TABLE client_contacts DROP COLUMN portal_access;
ALTER TABLE clients DROP COLUMN portal_enabled;
