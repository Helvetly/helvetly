-- A workspace's own wording for the email that sends a document, one per document kind and language.
-- No row means the built-in text.

-- +goose Up
CREATE TABLE email_templates (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind IN ('invoice', 'credit_note', 'proforma', 'quote')),
    language     text NOT NULL CHECK (language IN ('de', 'fr', 'it', 'en')),
    subject      text NOT NULL,
    body         text NOT NULL,
    updated_at   timestamptz NOT NULL,
    updated_by   text NOT NULL DEFAULT '',
    PRIMARY KEY (workspace_id, kind, language)
);

-- +goose Down
DROP TABLE email_templates;
