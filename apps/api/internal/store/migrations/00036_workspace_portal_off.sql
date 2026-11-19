-- The client portal of a whole workspace can be turned off: nobody signs in, sessions end, no invitations go out.
-- Each client's own portal switch stays as it is and counts again once the workspace turns the portal back on.

-- +goose Up
ALTER TABLE workspaces ADD COLUMN portal_off boolean DEFAULT false NOT NULL;

-- +goose Down
ALTER TABLE workspaces DROP COLUMN portal_off;
