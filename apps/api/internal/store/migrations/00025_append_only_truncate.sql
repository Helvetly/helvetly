-- +goose Up
-- The audit trails refuse TRUNCATE too: row triggers do not fire on it (the functions raise for any TG_OP but a purge DELETE).
CREATE TRIGGER financial_events_no_truncate BEFORE TRUNCATE ON financial_events
    FOR EACH STATEMENT EXECUTE FUNCTION financial_events_append_only();
CREATE TRIGGER signature_events_no_truncate BEFORE TRUNCATE ON signature_events
    FOR EACH STATEMENT EXECUTE FUNCTION signature_events_append_only();

-- +goose Down
DROP TRIGGER signature_events_no_truncate ON signature_events;
DROP TRIGGER financial_events_no_truncate ON financial_events;
