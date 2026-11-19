-- +goose Up
-- A Swiss company client found in the federal UID register: the UID it was found under (CHE-123.456.789) and when.
-- Informational only: a client the register doesn't know is saved all the same, just without the mark.
ALTER TABLE clients
    ADD COLUMN verified_uid text CHECK (verified_uid ~ '^CHE-[0-9]{3}\.[0-9]{3}\.[0-9]{3}$'),
    ADD COLUMN uid_verified_at timestamptz,
    ADD CONSTRAINT clients_uid_verified_together CHECK ((verified_uid IS NULL) = (uid_verified_at IS NULL));

-- +goose Down
ALTER TABLE clients DROP CONSTRAINT clients_uid_verified_together, DROP COLUMN uid_verified_at, DROP COLUMN verified_uid;
