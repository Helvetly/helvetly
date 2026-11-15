-- Model calls are reserved before they are made: tokens and their cost in micro-USD, both against the month of
-- heidi_usage the call was admitted in. ai_calls keeps each call with its usage breakdown and the rate card it was
-- priced by; a call whose cost the provider did not break down stays cost_pending, reserved at its maximum.

-- +goose Up
ALTER TABLE heidi_usage
    ADD COLUMN tokens_reserved      bigint NOT NULL DEFAULT 0 CHECK (tokens_reserved >= 0),
    ADD COLUMN cost_micros          bigint NOT NULL DEFAULT 0 CHECK (cost_micros >= 0),
    ADD COLUMN cost_reserved_micros bigint NOT NULL DEFAULT 0 CHECK (cost_reserved_micros >= 0);

CREATE TABLE ai_calls (
    id                  text PRIMARY KEY,
    workspace_id        text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    period              text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
    kind                text NOT NULL,
    operation           text NOT NULL,
    step                text NOT NULL,
    call_group          text NOT NULL DEFAULT '',
    -- reserved: in flight; settled: tokens and cost known; cost_pending: tokens known, cost not broken down;
    -- uncertain: outcome unknown, both reservations kept and the month blocked until an operator reconciles.
    status              text NOT NULL CHECK (status = ANY (ARRAY['reserved'::text, 'settled'::text, 'cost_pending'::text, 'uncertain'::text])),
    rate_card           text NOT NULL,
    model               text NOT NULL,
    tier                text NOT NULL,
    region              text NOT NULL,
    reserved_tokens     bigint NOT NULL CHECK (reserved_tokens >= 0),
    reserved_micros     bigint NOT NULL CHECK (reserved_micros >= 0),
    input_tokens        bigint,
    cached_input_tokens bigint,
    output_tokens       bigint,
    reasoning_tokens    bigint,
    total_tokens        bigint,
    cost_micros         bigint,
    reported_model      text NOT NULL DEFAULT '',
    reported_tier       text NOT NULL DEFAULT '',
    request_id          text NOT NULL DEFAULT '',
    created_at          timestamp with time zone NOT NULL,
    settled_at          timestamp with time zone
);

-- One provider call in flight per workspace, across months.
CREATE UNIQUE INDEX ai_calls_in_flight ON ai_calls (workspace_id) WHERE status = 'reserved';
CREATE INDEX ai_calls_operation ON ai_calls (workspace_id, operation);
CREATE INDEX ai_calls_group ON ai_calls (workspace_id, call_group) WHERE call_group <> '';

-- +goose Down
DROP TABLE ai_calls;
ALTER TABLE heidi_usage DROP COLUMN tokens_reserved, DROP COLUMN cost_micros, DROP COLUMN cost_reserved_micros;
