-- +goose Up
-- Removing a member now deletes their API tokens; tokens of people removed earlier are deleted here, so they
-- cannot come back to life if that person is invited again.
DELETE FROM api_tokens t
WHERE NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = t.workspace_id AND m.user_id = t.user_id);

-- +goose Down
-- The deleted tokens are not restored: their holders were no longer members.
