-- +goose Up
-- Permission scopes narrow what a member may do (internal/permissions); owners and admins keep NULL (everything).
ALTER TABLE workspace_members ADD COLUMN scopes text[];
ALTER TABLE workspace_invitations ADD COLUMN scopes text[];
UPDATE workspace_members SET scopes = '{"*:*"}' WHERE role = 'member';
UPDATE workspace_invitations SET scopes = '{"*:*"}' WHERE role = 'member';

-- +goose Down
ALTER TABLE workspace_invitations DROP COLUMN scopes;
ALTER TABLE workspace_members DROP COLUMN scopes;
