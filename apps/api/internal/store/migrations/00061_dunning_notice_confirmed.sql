-- A reminder is recorded before its email goes (the intent, holding its invoice and level so no run sends it twice)
-- and confirmed once the mail server took it (audit F07). One left unconfirmed went out or may have (the connection
-- dropped after the message, or the process stopped): it is never sent again by itself. Earlier notices were sent.

-- +goose Up
ALTER TABLE dunning_notices ADD COLUMN confirmed boolean NOT NULL DEFAULT true;

-- +goose Down
ALTER TABLE dunning_notices DROP COLUMN confirmed;
