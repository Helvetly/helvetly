-- +goose Up
-- People, their workspaces and how they sign in (internal/auth).

CREATE TABLE users (
    id         text PRIMARY KEY,
    -- The verified address the person first signed in with; the address is the person.
    email      text NOT NULL UNIQUE,
    name       text NOT NULL DEFAULT '',
    avatar_url text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

-- A verified way in: ('google', Google's sub) or ('email', the address a code reached).
CREATE TABLE user_identities (
    provider   text NOT NULL CHECK (provider IN ('google', 'email')),
    subject    text NOT NULL,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    email      text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (provider, subject)
);
CREATE INDEX user_identities_user ON user_identities (user_id);

CREATE TABLE workspaces (
    id         text PRIMARY KEY,
    name       text NOT NULL,
    timezone   text NOT NULL DEFAULT 'UTC', -- IANA name
    created_at timestamptz NOT NULL
);

CREATE TABLE workspace_members (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role         text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at   timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user ON workspace_members (user_id);

-- A signed-in browser, in one workspace. Only the SHA-256 of the cookie's token is stored.
CREATE TABLE sessions (
    id           text PRIMARY KEY,
    token_hash   text NOT NULL UNIQUE,
    csrf_token   text NOT NULL,
    user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL,
    expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- Sign-in codes: only sha256(id:code) is stored; single use, a few tries, short-lived, purged after a day.
CREATE TABLE email_codes (
    id         text PRIMARY KEY,
    email      text NOT NULL,
    code_hash  text NOT NULL,
    attempts   integer NOT NULL DEFAULT 0,
    client     text NOT NULL, -- keyed hash of the asker's address, never the address
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);
CREATE INDEX email_codes_email ON email_codes (email, created_at);

CREATE TABLE passkeys (
    id            text PRIMARY KEY,
    user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    credential_id text NOT NULL UNIQUE, -- base64url
    name          text NOT NULL,
    credential    jsonb NOT NULL,       -- go-webauthn Credential (public key, sign counter, flags)
    created_at    timestamptz NOT NULL,
    last_used_at  timestamptz
);
CREATE INDEX passkeys_user ON passkeys (user_id);

-- One WebAuthn ceremony, taken (deleted) exactly once.
CREATE TABLE passkey_challenges (
    id         text PRIMARY KEY,
    purpose    text NOT NULL CHECK (purpose IN ('register', 'sign_in')),
    user_id    text REFERENCES users (id) ON DELETE CASCADE, -- the person registering; NULL to sign in
    session    jsonb NOT NULL,                                -- go-webauthn SessionData
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX passkey_challenges_created ON passkey_challenges (created_at);

-- +goose Down
DROP TABLE passkey_challenges, passkeys, email_codes, sessions, workspace_members, workspaces, user_identities, users;
