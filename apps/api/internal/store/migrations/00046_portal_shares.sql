-- +goose Up
-- Client portal (docs/portal-contract.md): documents shared with a client and the client's pending change of its own details.
CREATE TABLE document_shares (
    document_id  text        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    client_id    text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    workspace_id text        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    shared_by    text        REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL,
    PRIMARY KEY (document_id, client_id)
);
CREATE INDEX document_shares_client ON document_shares (workspace_id, client_id, created_at DESC);

CREATE TABLE client_change_requests (
    id           text        PRIMARY KEY,
    workspace_id text        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    client_id    text        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    contact_id   text        REFERENCES client_contacts (id) ON DELETE SET NULL,
    fields       jsonb       NOT NULL,
    status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at   timestamptz NOT NULL,
    decided_at   timestamptz,
    decided_by   text        REFERENCES users (id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX client_change_requests_pending ON client_change_requests (client_id) WHERE status = 'pending';

-- +goose Down
DROP TABLE client_change_requests;
DROP TABLE document_shares;
