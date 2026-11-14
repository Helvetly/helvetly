-- +goose Up
-- Dunning (docs/invoices-contract.md "Dunning"): a pause per invoice, an opt-out per client and one row per notice
-- sent; the primary key makes each level of an invoice go out once, also with several instances running the job.
ALTER TABLE invoices ADD COLUMN dunning_paused boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN dunning_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE dunning_notices (
    workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    invoice_id    text NOT NULL REFERENCES invoices (id),
    level         integer NOT NULL CHECK (level BETWEEN 1 AND 3),
    levels        integer NOT NULL CHECK (levels BETWEEN level AND 3), -- the configured levels when sent: names the title
    sent_at       timestamptz NOT NULL,
    sent_on       date NOT NULL,                                       -- the workspace's civil date of sent_at
    open_amount   bigint NOT NULL,
    fee           bigint NOT NULL,
    interest      bigint NOT NULL,
    interest_rate integer NOT NULL,                                    -- hundredths of a percent a year, 0 = none
    interest_from date,                                                -- first day of interest, NULL = none
    total         bigint NOT NULL,
    email         text NOT NULL,
    sent_by       text REFERENCES users (id) ON DELETE SET NULL,       -- NULL: the hourly job
    PRIMARY KEY (invoice_id, level)
);
CREATE INDEX dunning_notices_recent ON dunning_notices (workspace_id, sent_at);

-- +goose Down
DROP TABLE dunning_notices;
ALTER TABLE clients DROP COLUMN dunning_enabled;
ALTER TABLE invoices DROP COLUMN dunning_paused;
