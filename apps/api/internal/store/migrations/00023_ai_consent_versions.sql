-- +goose Up
-- The AI-use notice version each approval or withdrawal was given for (internal/ainotice). Earlier rows stay NULL:
-- they are kept as history and never count as approval of the notice in force.
ALTER TABLE workspace_ai_consents ADD COLUMN version text;
ALTER TABLE workspace_ai_consents ADD CONSTRAINT workspace_ai_consents_version_check CHECK (NOT granted OR version IS NOT NULL) NOT VALID;

-- +goose Down
ALTER TABLE workspace_ai_consents DROP COLUMN version;
