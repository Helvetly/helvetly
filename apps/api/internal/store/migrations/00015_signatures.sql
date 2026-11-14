-- +goose Up
-- Contracts for signature (internal/signatures, docs/signatures-contract.md): a frozen copy of a PDF sent to
-- signers by email; only the SHA-256 of each signing link's token is stored.
CREATE TABLE signature_requests (
    id              text PRIMARY KEY,
    workspace_id    text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    document_id     text REFERENCES documents (id) ON DELETE SET NULL, -- the source file
    folder_id       text REFERENCES document_folders (id) ON DELETE SET NULL, -- where the finished PDF goes
    title           text NOT NULL,
    message         text,
    signing_order   text NOT NULL CHECK (signing_order IN ('parallel', 'sequential')),
    status          text NOT NULL CHECK (status IN ('pending', 'completed', 'declined', 'revoked')),
    original_key    text NOT NULL,
    original_sha256 text NOT NULL,
    page_count      int  NOT NULL,
    signed_document_id text REFERENCES documents (id) ON DELETE SET NULL,
    final_sha256    text,
    expires_at      timestamptz NOT NULL,
    created_by      text REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL,
    updated_at      timestamptz NOT NULL,
    completed_at    timestamptz
);
CREATE INDEX signature_requests_workspace ON signature_requests (workspace_id, created_at DESC);
CREATE INDEX signature_requests_document ON signature_requests (document_id);

CREATE TABLE signature_signers (
    id             text PRIMARY KEY,
    request_id     text NOT NULL REFERENCES signature_requests (id) ON DELETE CASCADE,
    position       int  NOT NULL,
    name           text NOT NULL,
    email          text NOT NULL,
    token_hash     text UNIQUE, -- null until it is their turn
    sent_at        timestamptz,
    viewed_at      timestamptz,
    viewed_ip      text,
    viewed_ua      text,
    signed_at      timestamptz,
    signed_ip      text,
    signed_ua      text,
    signature_method text CHECK (signature_method IN ('typed', 'drawn')),
    signature_png  bytea,
    declined_at    timestamptz,
    decline_reason text,
    UNIQUE (request_id, position)
);

CREATE TABLE signature_fields (
    id         text PRIMARY KEY,
    request_id text NOT NULL REFERENCES signature_requests (id) ON DELETE CASCADE,
    signer_id  text NOT NULL REFERENCES signature_signers (id) ON DELETE CASCADE,
    position   int  NOT NULL, -- the order they were placed in
    page       int  NOT NULL CHECK (page >= 1),
    kind       text NOT NULL CHECK (kind IN ('signature', 'date', 'name', 'text')),
    x          double precision NOT NULL CHECK (x >= 0 AND x <= 1),
    y          double precision NOT NULL CHECK (y >= 0 AND y <= 1),
    w          double precision NOT NULL CHECK (w >= 0.01 AND x + w <= 1.000001),
    h          double precision NOT NULL CHECK (h >= 0.01 AND y + h <= 1.000001),
    label      text,
    value      text
);
CREATE INDEX signature_fields_request ON signature_fields (request_id, position);

-- The audit trail: append-only, each row's hash chained to the one before it in the same request.
CREATE TABLE signature_events (
    request_id text   NOT NULL REFERENCES signature_requests (id) ON DELETE CASCADE,
    seq        int    NOT NULL,
    type       text   NOT NULL,
    signer_id  text,
    at         timestamptz NOT NULL,
    ip         text,
    user_agent text,
    data       jsonb  NOT NULL DEFAULT '{}',
    hash       text   NOT NULL,
    PRIMARY KEY (request_id, seq)
);

-- +goose StatementBegin
CREATE FUNCTION signature_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- Deleting a whole workspace sets helvetly.purge for its transaction; nothing else may change the trail.
    IF TG_OP = 'DELETE' AND current_setting('helvetly.purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'signature_events is append-only';
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER signature_events_append_only BEFORE UPDATE OR DELETE ON signature_events
    FOR EACH ROW EXECUTE FUNCTION signature_events_append_only();

-- A signed contract is a document linked to its request (a business record).
ALTER TABLE document_links DROP CONSTRAINT document_links_target_type_check;
ALTER TABLE document_links ADD CONSTRAINT document_links_target_type_check
    CHECK (target_type IN ('client', 'invoice', 'expense', 'signature'));

-- +goose Down
DELETE FROM document_links WHERE target_type = 'signature';
ALTER TABLE document_links DROP CONSTRAINT document_links_target_type_check;
ALTER TABLE document_links ADD CONSTRAINT document_links_target_type_check
    CHECK (target_type IN ('client', 'invoice', 'expense'));
DROP TABLE signature_events, signature_fields, signature_signers, signature_requests;
DROP FUNCTION signature_events_append_only();
