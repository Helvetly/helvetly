-- Heidi and AI import use the AI model by default (disclosed in the privacy policy), so the per-workspace switch and
-- its history are gone.

-- +goose Up
DROP TABLE workspace_ai_consents;

-- +goose Down
CREATE TABLE workspace_ai_consents (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    granted boolean NOT NULL,
    user_id text NOT NULL REFERENCES users(id),
    at timestamp with time zone NOT NULL
);
CREATE INDEX workspace_ai_consents_latest ON workspace_ai_consents USING btree (workspace_id, id DESC);
