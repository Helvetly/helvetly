-- +goose Up
-- Documents get tags. AI filing tags a new upload and files it into a folder once its uploader's AI approval allows;
-- document_filings is its queue and what it changed, so a person can undo it.
ALTER TABLE documents ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX documents_tags ON documents USING gin (tags) WHERE deleted_at IS NULL;

CREATE TABLE document_filings (
    document_id    text PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
    workspace_id   text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- uploaded to the top level: the file may be moved; uploaded into a folder: only tagged
    may_move       boolean NOT NULL,
    status         text NOT NULL CHECK (status IN ('queued', 'filed', 'skipped', 'undone')),
    attempts       integer NOT NULL DEFAULT 0,
    -- when a queued filing is next due; a claim pushes it ahead by its lease
    due_at         timestamp with time zone NOT NULL,
    from_folder_id text,
    folder_id      text,
    created_folder boolean NOT NULL DEFAULT false,
    -- the tags filing added (not those the file already had)
    tags           text[] NOT NULL DEFAULT '{}',
    created_at     timestamp with time zone NOT NULL,
    finished_at    timestamp with time zone
);
CREATE INDEX document_filings_due ON document_filings (due_at) WHERE status = 'queued';

-- +goose Down
DROP TABLE document_filings;
ALTER TABLE documents DROP COLUMN tags;
