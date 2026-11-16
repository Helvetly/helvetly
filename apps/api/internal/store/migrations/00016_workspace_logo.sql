-- The workspace's own square logo (sidebar, workspace switcher), separate from the document logo kept in the
-- invoice settings. Nullable: no backfill and never copied from the document logo.

-- +goose Up
ALTER TABLE workspaces ADD COLUMN logo_file_id text;

-- +goose Down
ALTER TABLE workspaces DROP COLUMN logo_file_id;
