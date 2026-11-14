-- +goose Up
-- Folders a person starred: personal, so per user; they go with the folder when it is deleted forever.
CREATE TABLE document_folder_stars (
    user_id      text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    folder_id    text        NOT NULL REFERENCES document_folders (id) ON DELETE CASCADE,
    workspace_id text        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL,
    PRIMARY KEY (user_id, folder_id)
);

-- +goose Down
DROP TABLE document_folder_stars;
