-- +goose Up
CREATE TABLE heidi_conversations (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,32}$'),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, user_id, id)
);
CREATE TABLE heidi_messages (
    position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id text NOT NULL UNIQUE,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    conversation_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    FOREIGN KEY (workspace_id, user_id, conversation_id)
      REFERENCES heidi_conversations(workspace_id, user_id, id) ON DELETE CASCADE
);
CREATE INDEX heidi_messages_conversation ON heidi_messages(workspace_id, user_id, conversation_id, position);
CREATE TABLE heidi_confirmations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    conversation_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('log_entry', 'select_engagement')),
    payload jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (workspace_id, user_id, conversation_id)
      REFERENCES heidi_conversations(workspace_id, user_id, id) ON DELETE CASCADE,
    UNIQUE (workspace_id, user_id, conversation_id)
);
CREATE TABLE heidi_usage (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
    tokens_used bigint NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
    uncertain boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, period)
);
-- +goose Down
DROP TABLE heidi_usage, heidi_confirmations, heidi_messages, heidi_conversations;
