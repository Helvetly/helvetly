-- +goose Up
-- The time zone becomes a setting; 'UTC' was the default nobody chose, and the app used Swiss time until now.
UPDATE workspaces SET timezone = 'Europe/Zurich' WHERE timezone = 'UTC';

-- +goose Down
SELECT 1;
