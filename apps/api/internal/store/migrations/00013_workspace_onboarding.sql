-- +goose Up
-- The welcome sets up a new workspace (docs/auth-contract.md): it belongs to the workspace, not the
-- person, so people invited into a workspace never see it. Workspaces that exist already are set up.
ALTER TABLE workspaces ADD COLUMN onboarded_at timestamptz;
UPDATE workspaces SET onboarded_at = created_at;
ALTER TABLE users DROP COLUMN onboarded_at;

-- +goose Down
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;
ALTER TABLE workspaces DROP COLUMN onboarded_at;
