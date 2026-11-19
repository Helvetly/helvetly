-- +goose Up
-- Why a provider call failed (rate_limited, config, server, timeout, incomplete:max_output_tokens, stale, …), so an
-- operator reconciling a month or answering a support question sees the cause next to the call's usage.
ALTER TABLE ai_calls ADD COLUMN failure text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE ai_calls DROP COLUMN failure;
