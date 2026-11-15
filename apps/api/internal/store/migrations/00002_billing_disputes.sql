-- Chargebacks and refunds: a pack's tokens taken back, and the disputes a workspace's payments are in.

-- +goose Up
ALTER TABLE ai_token_packs
    ADD COLUMN revoked bigint DEFAULT 0 NOT NULL,
    ADD COLUMN revoked_at timestamp with time zone,
    ADD CONSTRAINT ai_token_packs_revoked_check CHECK (((revoked >= 0) AND (revoked <= tokens)));

CREATE TABLE billing_disputes (
    id text NOT NULL,
    workspace_id text NOT NULL,
    status text NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY billing_disputes
    ADD CONSTRAINT billing_disputes_pkey PRIMARY KEY (id);

CREATE INDEX billing_disputes_workspace ON billing_disputes USING btree (workspace_id);

ALTER TABLE ONLY billing_disputes
    ADD CONSTRAINT billing_disputes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- +goose Down
DROP TABLE billing_disputes;
ALTER TABLE ai_token_packs DROP COLUMN revoked, DROP COLUMN revoked_at;
