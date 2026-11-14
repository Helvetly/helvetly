-- +goose Up
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE sessions ADD COLUMN user_agent text NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN ip text NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN last_active_at timestamptz;
UPDATE sessions SET last_active_at = created_at;
ALTER TABLE sessions ALTER COLUMN last_active_at SET NOT NULL;
ALTER TABLE sessions ALTER COLUMN last_active_at SET DEFAULT now();

CREATE TABLE account_two_factor (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret text NOT NULL,
    pending_secret text,
    pending_expires_at timestamptz,
    enabled boolean NOT NULL DEFAULT false,
    last_step bigint NOT NULL DEFAULT -1
);
CREATE TABLE account_recovery_codes (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash text NOT NULL,
    PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE account_login_challenges (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    next_path text NOT NULL DEFAULT '/',
    attempts integer NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL
);
CREATE INDEX account_login_challenges_expires ON account_login_challenges(expires_at);

-- A request authenticated before account closure must not recreate membership or credentials afterward.
-- +goose StatementBegin
CREATE FUNCTION require_active_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
    PERFORM 1 FROM users WHERE id = NEW.user_id AND deleted_at IS NULL FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account is not active' USING ERRCODE = '23514', CONSTRAINT = 'active_account_reference';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER workspace_member_active_account BEFORE INSERT OR UPDATE OF user_id ON workspace_members FOR EACH ROW EXECUTE FUNCTION require_active_account();
CREATE TRIGGER identity_active_account BEFORE INSERT OR UPDATE OF user_id ON user_identities FOR EACH ROW EXECUTE FUNCTION require_active_account();
CREATE TRIGGER session_active_account BEFORE INSERT OR UPDATE OF user_id ON sessions FOR EACH ROW EXECUTE FUNCTION require_active_account();
CREATE TRIGGER passkey_active_account BEFORE INSERT OR UPDATE OF user_id ON passkeys FOR EACH ROW EXECUTE FUNCTION require_active_account();
CREATE TRIGGER passkey_challenge_active_account BEFORE INSERT OR UPDATE OF user_id ON passkey_challenges FOR EACH ROW EXECUTE FUNCTION require_active_account();
CREATE TRIGGER two_factor_active_account BEFORE INSERT OR UPDATE OF user_id ON account_two_factor FOR EACH ROW EXECUTE FUNCTION require_active_account();
CREATE TRIGGER recovery_code_active_account BEFORE INSERT OR UPDATE OF user_id ON account_recovery_codes FOR EACH ROW EXECUTE FUNCTION require_active_account();
CREATE TRIGGER login_challenge_active_account BEFORE INSERT OR UPDATE OF user_id ON account_login_challenges FOR EACH ROW EXECUTE FUNCTION require_active_account();

-- +goose Down
DROP TRIGGER workspace_member_active_account ON workspace_members;
DROP TRIGGER identity_active_account ON user_identities;
DROP TRIGGER session_active_account ON sessions;
DROP TRIGGER passkey_active_account ON passkeys;
DROP TRIGGER passkey_challenge_active_account ON passkey_challenges;
DROP TABLE account_login_challenges, account_recovery_codes, account_two_factor;
DROP FUNCTION require_active_account();
ALTER TABLE sessions DROP COLUMN last_active_at, DROP COLUMN ip, DROP COLUMN user_agent;
ALTER TABLE users DROP COLUMN deleted_at;
