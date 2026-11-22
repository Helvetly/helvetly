-- Where a client's answer to the workspace's email goes (Reply-To); NULL: the company email of the invoice settings.

-- +goose Up
ALTER TABLE workspaces ADD COLUMN reply_to_email text;

-- +goose Down
ALTER TABLE workspaces DROP COLUMN reply_to_email;
