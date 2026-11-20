-- Clients sign in only at their supplier's own portal address (/w/<slug>/ or its own domain): the shared portal's
-- sign-in, its account choice and the one-time tickets of 00035 are gone (never released), and so is their table.

-- +goose Up
DROP TABLE portal_sign_in_choices;

-- +goose Down
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
