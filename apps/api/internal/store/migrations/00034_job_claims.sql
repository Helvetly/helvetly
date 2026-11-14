-- +goose Up
-- One digest without engagement notices per workspace and local day, claimed by whichever instance inserts it first.
CREATE TABLE digest_days (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    day          date NOT NULL,
    PRIMARY KEY (workspace_id, day)
);
-- The instance that sets it sends a plan partial; a claim older than 15 minutes is a crashed send and may be taken.
ALTER TABLE invoices ADD COLUMN send_claimed_at timestamptz;

-- +goose Down
ALTER TABLE invoices DROP COLUMN send_claimed_at;
DROP TABLE digest_days;
