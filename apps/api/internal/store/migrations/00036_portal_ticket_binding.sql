-- A ticket is bound to the browser that chose (00035 accepted it from any browser, so a link of one's own ticket could
-- sign someone else in as oneself). Choosing now only records the client (client_id, workspace_id, the cookie still
-- held); the chosen workspace's own address then sets a random state in its own host-only cookie and sends the browser
-- back to the shared portal, whose choice cookie turns the choice into a ticket bound to that state (binding_hash).
-- Only a request carrying both the ticket and that state's cookie sees or redeems it. Rows are single-use and
-- short-lived, so the table is made again rather than altered.

-- +goose Up
DROP TABLE portal_sign_in_choices;
CREATE TABLE portal_sign_in_choices (
    id           text PRIMARY KEY,
    token_hash   text UNIQUE,
    csrf_token   text NOT NULL,
    email        text NOT NULL CHECK (email = lower(email)),
    client_id    text REFERENCES clients (id) ON DELETE CASCADE,
    workspace_id text REFERENCES workspaces (id) ON DELETE CASCADE,
    ticket_hash  text UNIQUE,
    binding_hash text,
    created_at   timestamptz NOT NULL,
    expires_at   timestamptz NOT NULL,
    CHECK ((token_hash IS NULL) <> (ticket_hash IS NULL)),
    CHECK ((client_id IS NULL) = (workspace_id IS NULL)),
    CHECK ((ticket_hash IS NULL) = (binding_hash IS NULL)),
    CHECK (ticket_hash IS NULL OR client_id IS NOT NULL)
);
CREATE INDEX portal_sign_in_choices_expires ON portal_sign_in_choices (expires_at);

-- +goose Down
DROP TABLE portal_sign_in_choices;
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
