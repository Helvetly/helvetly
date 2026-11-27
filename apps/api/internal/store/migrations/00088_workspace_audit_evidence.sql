-- +goose Up
-- Derived readings of a general document. A changed original or extractor version needs a new reading.
CREATE TABLE workspace_audit_evidence (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    language text NOT NULL,
    fingerprint text NOT NULL,
    status text NOT NULL CHECK (status IN ('read','unsupported','oversize','missing','integrity')),
    facts jsonb NOT NULL,
    checked_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, document_id, language)
);

-- A lease survives a process interruption without charging twice for concurrent clicks.
CREATE TABLE workspace_audit_claims (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    language text NOT NULL,
    token text NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, document_id, language)
);

-- +goose Down
DROP TABLE workspace_audit_claims;
DROP TABLE workspace_audit_evidence;
