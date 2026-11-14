-- +goose Up
-- once_key: an event a job may see again (an invoice overdue, a period to file, a limit nearly reached) is written once
-- per person; Notify skips recipients who already have a notification with the key.
ALTER TABLE notifications ADD COLUMN once_key text;
CREATE UNIQUE INDEX notifications_once ON notifications (user_id, workspace_id, once_key) WHERE once_key IS NOT NULL;
-- The bell's unread count and the category filter.
CREATE INDEX notifications_unread ON notifications (user_id, workspace_id) WHERE in_app AND read_at IS NULL;

-- +goose Down
DROP INDEX notifications_unread;
DROP INDEX notifications_once;
ALTER TABLE notifications DROP COLUMN once_key;
