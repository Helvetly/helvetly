-- The operator's Telegram bot answers questions in the admin chat (internal/admintelegram). admin_bot_lease names the
-- one instance that polls Telegram (two run at once during a blue/green deploy, and Telegram answers 409 to a second
-- poller) and keeps the last update offset it confirmed. operator_ai_usage counts the model tokens and cost of the
-- bot's free-text questions per UTC day: the operator's own small daily cap, never a workspace's pools.

-- +goose Up
CREATE TABLE admin_bot_lease (
    id            boolean PRIMARY KEY DEFAULT true CHECK (id),
    holder        text NOT NULL,
    until         timestamptz NOT NULL,
    update_offset bigint NOT NULL DEFAULT 0
);

CREATE TABLE operator_ai_usage (
    day         date PRIMARY KEY,
    tokens      bigint NOT NULL DEFAULT 0 CHECK (tokens >= 0),
    cost_micros bigint NOT NULL DEFAULT 0 CHECK (cost_micros >= 0)
);

-- +goose Down
DROP TABLE operator_ai_usage;
DROP TABLE admin_bot_lease;
