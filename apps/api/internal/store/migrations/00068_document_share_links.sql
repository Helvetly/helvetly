-- +goose Up
ALTER TABLE document_shares ADD COLUMN expires_at timestamptz;

CREATE TABLE document_share_links (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    single_use boolean NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz,
    used_at timestamptz
);
CREATE INDEX document_share_links_document ON document_share_links (document_id, created_at DESC);

-- +goose Down
DROP TABLE document_share_links;
ALTER TABLE document_shares DROP COLUMN expires_at;
