-- "View as client" (portal/preview.go, clients/portal_preview.go): a member opens a client's portal read-only. A link
-- is one use and lives 5 minutes, kept only as the SHA-256 of its token; the session it opens is the client's portal
-- session with preview_by set to the member, read-only and at most 30 minutes long.

-- +goose Up
CREATE TABLE portal_preview_links (
    token_hash   text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    client_id    text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   timestamp with time zone NOT NULL,
    expires_at   timestamp with time zone NOT NULL
);

ALTER TABLE portal_sessions ADD COLUMN preview_by text REFERENCES users(id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE portal_sessions DROP COLUMN preview_by;
DROP TABLE portal_preview_links;
