-- An address that is the portal login of several clients chooses one after its code on the shared portal's sign-in
-- (PORTAL_URL/login). Until then it holds a choice, never a session: token_hash is its cookie (NULL once chosen),
-- bound to the verified address and to no workspace. Choosing turns it into a one-time ticket (ticket_hash) for one
-- client, which that workspace's own portal address redeems for its own session: a cookie is host-only, and the
-- workspace's address may be its own domain. Rows are single-use and short-lived.

-- +goose Up
CREATE TABLE portal_sign_in_choices (
    id           text PRIMARY KEY,
    token_hash   text UNIQUE,
    csrf_token   text NOT NULL,
    email        text NOT NULL CHECK (email = lower(email)),
    ticket_hash  text UNIQUE,
    client_id    text REFERENCES clients (id) ON DELETE CASCADE,
    workspace_id text REFERENCES workspaces (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL,
    expires_at   timestamptz NOT NULL,
    CHECK ((token_hash IS NULL) <> (ticket_hash IS NULL)),
    CHECK ((ticket_hash IS NULL) = (client_id IS NULL) AND (client_id IS NULL) = (workspace_id IS NULL))
);
CREATE INDEX portal_sign_in_choices_expires ON portal_sign_in_choices (expires_at);

-- +goose Down
DROP TABLE portal_sign_in_choices;
