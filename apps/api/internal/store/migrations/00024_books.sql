-- +goose Up
-- Books (internal/books, docs/books-contract.md): the financial audit log, closed months and self-billing agreements.

-- Append-only, one hash chain per workspace: hash = sha256(prev_hash || canonical JSON), see store.LogEvent.
CREATE TABLE financial_events (
    workspace_id text   NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    seq          bigint NOT NULL,
    kind         text   NOT NULL,
    subject_type text   NOT NULL,
    subject_id   text   NOT NULL,
    actor_id     text, -- not a reference: the trail outlives the person
    at           timestamptz NOT NULL,
    payload      jsonb  NOT NULL DEFAULT '{}',
    prev_hash    bytea  NOT NULL, -- empty on the first event
    hash         bytea  NOT NULL,
    PRIMARY KEY (workspace_id, seq)
);

-- +goose StatementBegin
CREATE FUNCTION financial_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- Deleting a whole workspace sets helvetly.purge for its transaction; nothing else may change the trail.
    IF TG_OP = 'DELETE' AND current_setting('helvetly.purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'financial_events is append-only';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER financial_events_append_only BEFORE UPDATE OR DELETE ON financial_events
    FOR EACH ROW EXECUTE FUNCTION financial_events_append_only();

CREATE TABLE closed_periods (
    workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    month        text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    closed_at    timestamptz NOT NULL,
    closed_by    text REFERENCES users (id) ON DELETE SET NULL,
    PRIMARY KEY (workspace_id, month)
);

CREATE TABLE self_billing_agreements (
    id            text PRIMARY KEY,
    workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    client_id     text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
    starts_on     date NOT NULL,
    ends_on       date CHECK (ends_on >= starts_on),
    accepted_at   timestamptz,
    accepted_by   text,
    note          text,
    first_used_at timestamptz,
    created_at    timestamptz NOT NULL
);
CREATE INDEX self_billing_agreements_client ON self_billing_agreements (workspace_id, client_id, starts_on);

-- +goose Down
DROP TABLE self_billing_agreements, closed_periods, financial_events;
DROP FUNCTION financial_events_append_only();
