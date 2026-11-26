-- +goose Up
CREATE TABLE digest_deliveries (
    workspace_id text NOT NULL,
    occurrence text NOT NULL,
    user_id text NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'uncertain', 'accepted')),
    message jsonb,
    PRIMARY KEY (workspace_id, occurrence, user_id),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE
);
CREATE INDEX digest_deliveries_pending ON digest_deliveries(workspace_id) WHERE state = 'pending';

-- +goose Down
DROP TABLE digest_deliveries;
