-- Each sent revision of a quote, kept as it was sent: the quote's JSON (snapshot) and its PDF (pdf_key, also filed as
-- a document). Written with the send; only the answer to it (outcome, outcome_at, outcome_by, reason) is set later,
-- once. Revisions sent before this table are filled in at start (quotes.BackfillRevisions): the PDF where the object
-- is still stored and no snapshot, except for the current revision, which a sent quote still holds unchanged.

-- +goose Up
CREATE TABLE quote_revisions (
    workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    quote_id     text NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    revision     integer NOT NULL CHECK (revision >= 1),
    sent_at      timestamp with time zone,
    sent_to      text[] NOT NULL DEFAULT '{}',
    outcome      text CHECK (outcome IN ('accepted', 'declined', 'expired')),
    outcome_at   timestamp with time zone,
    outcome_by   text CHECK (outcome_by IN ('staff', 'client')),
    reason       text,
    snapshot     jsonb,
    pdf_key      text,
    created_at   timestamp with time zone NOT NULL,
    PRIMARY KEY (quote_id, revision)
);

CREATE INDEX quote_revisions_workspace ON quote_revisions (workspace_id);
CREATE INDEX quote_revisions_pdf ON quote_revisions (pdf_key) WHERE pdf_key IS NOT NULL;

-- +goose StatementBegin
CREATE FUNCTION quote_revisions_as_sent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
        OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
        OR NEW.sent_to IS DISTINCT FROM OLD.sent_to OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
        OR NEW.pdf_key IS DISTINCT FROM OLD.pdf_key OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR (OLD.outcome IS NOT NULL AND (NEW.outcome IS DISTINCT FROM OLD.outcome
            OR NEW.outcome_at IS DISTINCT FROM OLD.outcome_at OR NEW.outcome_by IS DISTINCT FROM OLD.outcome_by
            OR NEW.reason IS DISTINCT FROM OLD.reason)) THEN
        RAISE EXCEPTION 'quote_revisions: a sent revision is kept as it was sent';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER quote_revisions_as_sent BEFORE UPDATE ON quote_revisions FOR EACH ROW EXECUTE FUNCTION quote_revisions_as_sent();

-- +goose Down
DROP TABLE quote_revisions;
DROP FUNCTION quote_revisions_as_sent();
