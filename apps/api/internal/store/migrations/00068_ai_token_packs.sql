-- +goose Up
-- One-time AI token packs bought through Checkout (payment mode). Each adds its tokens to the workspace's model token
-- allowance for the month, in the workspace's time zone, it was paid in; what is left lapses with that month. The
-- Checkout Session id makes a redelivered webhook add nothing.
CREATE TABLE ai_token_packs (
    checkout_session_id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
    tokens bigint NOT NULL CHECK (tokens > 0),
    created_at timestamptz NOT NULL
);
CREATE INDEX ai_token_packs_workspace_period ON ai_token_packs (workspace_id, period);

-- +goose Down
DROP TABLE ai_token_packs;
