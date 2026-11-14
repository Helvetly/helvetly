-- +goose Up
-- {"<event>": {"email": bool, "in_app": bool}}; an event left out is on for both.
ALTER TABLE users ADD COLUMN notification_prefs jsonb NOT NULL DEFAULT '{}';

-- One row per recipient, written in the transaction of the change. emailed_at: the email went out, or was skipped
-- (claimed before sending, so at most once); set at insert when the person has the email off.
CREATE TABLE notifications (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id text        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id      text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    event        text        NOT NULL,
    data         jsonb       NOT NULL DEFAULT '{}',
    in_app       boolean     NOT NULL,
    created_at   timestamptz NOT NULL,
    read_at      timestamptz,
    emailed_at   timestamptz
);
CREATE INDEX notifications_inbox ON notifications (user_id, workspace_id, id DESC) WHERE in_app;
CREATE INDEX notifications_email_due ON notifications (created_at) WHERE emailed_at IS NULL;

-- +goose Down
DROP TABLE notifications;
ALTER TABLE users DROP COLUMN notification_prefs;
