-- The one-time AI suggestion of a workspace name during onboarding. The primary key is the single use: one row per
-- workspace, inserted before the model is asked, so a reload, a retry or two tabs can never make a second call. It is
-- a complimentary call outside the plan's token pool (heidi_usage, ai_calls), with its own small record of cost.
-- The per-person daily cap lives in its own tiny ledger, name_suggestion_uses: it holds no company data and no workspace
-- reference, so deleting a workspace (which removes its suggestion row) cannot reset a person's count. Rows older than a
-- week are pruned when a new use is taken. It goes with the person's account (cascade), which never blocks closing it.

-- +goose Up
CREATE TABLE workspace_name_suggestions (
    workspace_id  text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    requested_by  text NOT NULL,
    company_name  text NOT NULL,
    consented_at  timestamp with time zone NOT NULL,
    -- reserved: the model is being asked; done: a suggestion is stored; failed: the provider answered but nothing
    -- usable came back; unaccounted: the outcome is unknown. All but done keep the use spent.
    status        text NOT NULL CHECK (status = ANY (ARRAY['reserved'::text, 'done'::text, 'failed'::text, 'unaccounted'::text])),
    suggestion    text NOT NULL DEFAULT '',
    rate_card     text NOT NULL,
    model         text NOT NULL,
    input_tokens  bigint,
    output_tokens bigint,
    cost_micros   bigint,
    created_at    timestamp with time zone NOT NULL,
    settled_at    timestamp with time zone
);

CREATE TABLE name_suggestion_uses (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    requested_by text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   timestamp with time zone NOT NULL
);
CREATE INDEX name_suggestion_uses_person ON name_suggestion_uses (requested_by, created_at);

-- +goose Down
DROP TABLE name_suggestion_uses;
DROP TABLE workspace_name_suggestions;
