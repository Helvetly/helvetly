-- A member's own signature for contracts (templates/signature.go): an image they drew or uploaded, kept as a private
-- workspace object (never a document, never public), and the place they sign at (none: the workspace's city). When a
-- contract written from a quote is saved, emailed or sent for signature, it is printed on the contractor's side with
-- the place and the day. Leaving the workspace drops it.

-- +goose Up
CREATE TABLE member_signatures (
    workspace_id text NOT NULL,
    user_id      text NOT NULL,
    object_key   text,
    content_type text,
    sha256       text,
    place        text,
    updated_at   timestamp with time zone NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE member_signatures;
