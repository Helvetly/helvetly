-- +goose Up
-- When the person finished or skipped the welcome (docs/auth-contract.md); null until then, so people
-- who signed up before this see it once too.
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;

-- +goose Down
ALTER TABLE users DROP COLUMN onboarded_at;
