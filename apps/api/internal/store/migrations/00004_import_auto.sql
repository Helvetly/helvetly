-- Imports that work out what each file is: a batch of kind 'auto' holds records of several kinds, and each file keeps
-- the document type the model recognised.

-- +goose Up
ALTER TABLE import_batches DROP CONSTRAINT import_batches_kind_check,
    ADD CONSTRAINT import_batches_kind_check CHECK ((kind = ANY (ARRAY['clients'::text, 'products'::text, 'expenses'::text, 'invoices'::text, 'engagements'::text, 'auto'::text])));
ALTER TABLE import_records ADD COLUMN kind text;
ALTER TABLE import_files ADD COLUMN document_type text;

-- +goose Down
DELETE FROM import_batches WHERE kind = 'auto';
ALTER TABLE import_files DROP COLUMN document_type;
ALTER TABLE import_records DROP COLUMN kind;
ALTER TABLE import_batches DROP CONSTRAINT import_batches_kind_check,
    ADD CONSTRAINT import_batches_kind_check CHECK ((kind = ANY (ARRAY['clients'::text, 'products'::text, 'expenses'::text, 'invoices'::text, 'engagements'::text])));
