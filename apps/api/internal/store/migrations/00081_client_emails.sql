-- Client emails in one place: an optional footer under every branded client email, and switches for the automatic
-- emails that had none (portal invitations when a client's portal is turned on, session reminders to clients).
-- Both switches start on, as these emails went out before.

-- +goose Up
ALTER TABLE workspaces
    ADD COLUMN email_footer text NOT NULL DEFAULT '',
    ADD COLUMN portal_invitations boolean NOT NULL DEFAULT true,
    ADD COLUMN session_reminders boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE workspaces
    DROP COLUMN email_footer,
    DROP COLUMN portal_invitations,
    DROP COLUMN session_reminders;
