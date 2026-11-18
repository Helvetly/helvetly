-- +goose Up
-- Optional details a person can show on an invoice or quote. client_number_display: NULL prints the client's own
-- number (as before), '' prints none, other text prints instead. contract_reference is BT-12; contract_document_id
-- links a document of the workspace and is never printed. Existing rows keep NULLs, so issued PDFs and XML stay as
-- they were. No foreign key: purging a trashed document must never touch an issued invoice.
ALTER TABLE invoices
    ADD COLUMN client_number_display text CHECK (char_length(client_number_display) <= 40),
    ADD COLUMN contract_reference text CHECK (char_length(contract_reference) <= 100),
    ADD COLUMN contract_document_id text;
ALTER TABLE quotes
    ADD COLUMN client_number_display text CHECK (char_length(client_number_display) <= 40),
    ADD COLUMN contract_reference text CHECK (char_length(contract_reference) <= 100),
    ADD COLUMN contract_document_id text;

-- +goose Down
ALTER TABLE quotes DROP COLUMN client_number_display, DROP COLUMN contract_reference, DROP COLUMN contract_document_id;
ALTER TABLE invoices DROP COLUMN client_number_display, DROP COLUMN contract_reference, DROP COLUMN contract_document_id;
