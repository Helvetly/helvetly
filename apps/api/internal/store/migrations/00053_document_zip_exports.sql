-- A member's ZIP of a Documents view too big to stream (documents/zip_exports.go): queued as pending, built by a
-- background loop (one at a time per workspace, claimed for a lease), stored under workspaces/<id>/exports/ and
-- deleted with its row 7 days after it is ready. Never a document and never counted as storage.

-- +goose Up
CREATE TABLE document_zip_exports (
    id            text PRIMARY KEY,
    workspace_id  text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query         text NOT NULL,
    zone          text NOT NULL,
    name          text NOT NULL,
    status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
    attempts      integer NOT NULL DEFAULT 0,
    claimed_until timestamp with time zone,
    object_key    text,
    files         integer NOT NULL DEFAULT 0,
    bytes         bigint NOT NULL DEFAULT 0,
    created_at    timestamp with time zone NOT NULL,
    finished_at   timestamp with time zone,
    expires_at    timestamp with time zone
);

CREATE INDEX document_zip_exports_pending ON document_zip_exports (created_at) WHERE status = 'pending';
CREATE INDEX document_zip_exports_member ON document_zip_exports (workspace_id, user_id, created_at);

-- +goose Down
DROP TABLE document_zip_exports;
