-- +goose Up
-- Invoices issued in another system and brought in by an import (docs/imports-contract.md): they keep their own number
-- (never from invoice_counters, so seq stays NULL) and their legal original is the uploaded Document. An import record
-- can be skipped by the person (a number conflict they chose not to overwrite).
ALTER TABLE invoices
    ADD COLUMN origin text NOT NULL DEFAULT 'helvetly' CHECK (origin IN ('helvetly', 'imported')),
    ADD COLUMN source_document_id text REFERENCES documents (id),
    ADD CONSTRAINT invoices_imported_original CHECK (origin = 'helvetly' OR status = 'draft' OR source_document_id IS NOT NULL);

ALTER TABLE import_records DROP CONSTRAINT import_records_status_check,
    ADD CONSTRAINT import_records_status_check CHECK (status IN ('pending', 'created', 'failed', 'skipped'));

-- +goose Down
UPDATE import_records SET status = 'pending' WHERE status = 'skipped';
ALTER TABLE import_records DROP CONSTRAINT import_records_status_check,
    ADD CONSTRAINT import_records_status_check CHECK (status IN ('pending', 'created', 'failed'));
ALTER TABLE invoices DROP CONSTRAINT invoices_imported_original, DROP COLUMN source_document_id, DROP COLUMN origin;
