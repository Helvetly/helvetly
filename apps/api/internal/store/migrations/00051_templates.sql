-- +goose Up
-- Templates (docs/templates-contract.md): a PDF from Documents, read not copied, with boxes placed on its pages.
-- Signing roles and fields are replaced as a whole on every save, so they are kept as JSON with the template.
CREATE TABLE templates (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id),
    name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    description  text CHECK (char_length(description) <= 500),
    document_id  text REFERENCES documents (id) ON DELETE SET NULL, -- null once the PDF is deleted forever
    signers      jsonb NOT NULL,
    fields       jsonb NOT NULL,
    used_count   integer NOT NULL DEFAULT 0,
    last_used_at timestamptz,
    created_at   timestamptz NOT NULL,
    updated_at   timestamptz NOT NULL
);
CREATE INDEX templates_workspace ON templates (workspace_id, updated_at DESC);
CREATE INDEX templates_document ON templates (document_id);

-- +goose Down
DROP TABLE templates;
