-- +goose Up
-- Staged uploads: files uploaded but not yet placed. Documents' Upload stages every file first and files it once the
-- person chooses "Just upload" or applies the AI's grouping; an import keeps its source files here while it is read and
-- reviewed. A staged file is no Document: no list, search, group, count, share, export or Heidi answer sees it. Its
-- object is counted in stored_objects like any other, and the object is deleted (releasing the bytes) on cancel, when
-- its import ends, or 24 hours after the upload by a job. id is the Document id the file becomes.
CREATE TABLE staged_uploads (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('documents', 'import')),
    batch_id text NOT NULL,
    name text NOT NULL,
    size bigint NOT NULL CHECK (size >= 0),
    content_type text NOT NULL,
    sha256 text NOT NULL,
    object_key text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL
);
CREATE INDEX staged_uploads_batch ON staged_uploads (workspace_id, user_id, batch_id);
CREATE INDEX staged_uploads_created ON staged_uploads (created_at);

-- +goose Down
DROP TABLE staged_uploads;
