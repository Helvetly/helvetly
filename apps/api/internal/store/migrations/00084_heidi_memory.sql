-- +goose Up
CREATE TABLE heidi_memory (
    workspace_id text NOT NULL,
    user_id text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    reply_style text NOT NULL DEFAULT 'auto' CHECK (reply_style IN ('auto', 'brief', 'detailed')),
    topics jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(topics) = 'object'),
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE heidi_memory;
