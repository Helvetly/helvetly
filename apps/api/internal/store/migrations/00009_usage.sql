-- Offer v2 (stage B): durable usage of the monthly limits. Every counted operation is one row, keyed by the
-- workspace, the limit and the operation's own id, so a retry finds its row instead of counting again; params_hash
-- tells a retry from another operation reusing the id. period is the UTC calendar month the operation was admitted
-- in, fixed then: an operation settled after the month ends still counts in its own month. reserved is held for an
-- operation whose effect is not known yet (an external call), consumed is what it used; a month's usage is both
-- summed. Rows are never deleted with the records they counted: deleting an expense gives no allowance back.
-- No customer holds earlier usage, so nothing is backfilled: counting starts with this migration.

-- +goose Up
CREATE TABLE usage_events (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    resource     text NOT NULL,
    operation    text NOT NULL,
    params_hash  text NOT NULL,
    period       text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
    reserved     bigint NOT NULL CHECK (reserved >= 0),
    consumed     bigint NOT NULL CHECK (consumed >= 0),
    created_at   timestamp with time zone NOT NULL,
    settled_at   timestamp with time zone,
    PRIMARY KEY (workspace_id, resource, operation)
);

CREATE INDEX usage_events_period ON usage_events (workspace_id, resource, period);

-- +goose Down
DROP TABLE usage_events;
