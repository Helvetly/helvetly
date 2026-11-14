-- +goose Up
-- Problem reports and feature ideas for the Helvetly team (docs/feedback-contract.md): not workspace data.
CREATE TABLE product_feedback (
    id           text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces (id),
    user_id      text NOT NULL REFERENCES users (id),
    kind         text NOT NULL CHECK (kind IN ('problem', 'feature')),
    description  text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 5000),
    page_path    text NOT NULL,
    created_at   timestamptz NOT NULL,
    emailed_at   timestamptz
);
CREATE INDEX product_feedback_user ON product_feedback (user_id, created_at);

CREATE TABLE product_feedback_files (
    feedback_id  text NOT NULL REFERENCES product_feedback (id) ON DELETE CASCADE,
    position     integer NOT NULL CHECK (position BETWEEN 0 AND 4),
    object_key   text NOT NULL,
    content_type text NOT NULL,
    size         bigint NOT NULL,
    sha256       text NOT NULL,
    PRIMARY KEY (feedback_id, position),
    UNIQUE (feedback_id, sha256)
);

-- +goose Down
DROP TABLE product_feedback_files;
DROP TABLE product_feedback;
